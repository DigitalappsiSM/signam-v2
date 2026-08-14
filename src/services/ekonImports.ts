import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  diffAssignments,
  EKON_SCHEMA_VERSION,
  type EkonAssignment,
  type EkonImportBatch,
  type EkonBatchTotals,
  type EkonPeriod,
  type EkonRawRow,
  type StoredEkonAssignment,
} from '@/domain/ekon';
import { listAllAssignments, upsertAssignments } from './ekonAssignments';
import { appendRevisions } from './ekonRevisions';
import type { Actor } from '@/modules/admira-catalog/screenFactory';

/**
 * Orquestación de la importación Ekon (colección `ekonImportBatches`).
 *
 * Flujo por etapas con estados de lote (`parsing` → `pending_confirmation` →
 * `processing` → `completed` | `failed`):
 * - `createPendingBatch`: guarda metadatos + snapshot de filas (en chunks) sin
 *   tocar el estado vigente. Reimportar el mismo contenido no duplica (hash).
 * - `activateBatch`: calcula el diff contra las asignaciones vigentes, escribe
 *   solo lo cambiado y las revisiones, y marca `completed`. Idempotente y
 *   reintentable: un fallo a mitad deja el lote sin `completed`, y reejecutar
 *   recalcula el diff sobre el estado actual.
 *
 * Conciliación y fallback consumen SOLO lotes completados.
 */

const BATCHES = 'ekonImportBatches';
const ROW_CHUNKS = 'rowChunks';
const ROWS_PER_CHUNK = 300;
const CHUNK_LIMIT = 400;

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Snapshot mínimo del lote para el historial (sin las filas). */
export type EkonBatchSummary = EkonImportBatch;

/** Lee los lotes ordenados por fecha de creación (más reciente primero). */
export async function listBatches(): Promise<EkonBatchSummary[]> {
  const q = query(collection(db(), BATCHES), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<EkonImportBatch, 'id'>),
  }));
}

/** true si existe al menos un lote completado (requisito del fallback). */
export async function hasCompletedBatch(): Promise<boolean> {
  const q = query(
    collection(db(), BATCHES),
    where('status', '==', 'completed'),
  );
  const snapshot = await getDocs(q);
  return !snapshot.empty;
}

/**
 * Busca un lote COMPLETADO con el mismo hash de contenido y el mismo alcance
 * confirmado (idempotencia de reimportación idéntica). Devuelve el lote o null.
 */
export async function findCompletedBatchByHash(
  contentHash: string,
  confirmedPeriodIds: readonly string[],
): Promise<EkonBatchSummary | null> {
  const q = query(
    collection(db(), BATCHES),
    where('contentHash', '==', contentHash),
  );
  const snapshot = await getDocs(q);
  const wanted = [...confirmedPeriodIds].sort().join(',');
  const match = snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<EkonImportBatch, 'id'>) }))
    .find(
      (b) =>
        b.status === 'completed' &&
        [...b.confirmedPeriodIds].sort().join(',') === wanted,
    );
  return match ?? null;
}

export interface CreatePendingBatchInput {
  fileName: string;
  contentHash: string;
  rows: readonly EkonRawRow[];
  detectedPeriods: readonly EkonPeriod[];
  coverage: { min: string | null; max: string | null };
  warnings: readonly string[];
  actor: Actor;
}

/**
 * Crea un lote en estado `pending_confirmation` con el snapshot de filas. No
 * toca el estado vigente hasta que se active. Devuelve el id del lote.
 */
export async function createPendingBatch(
  input: CreatePendingBatchInput,
): Promise<string> {
  const database = db();
  const now = Date.now();
  const ref = doc(collection(database, BATCHES));

  const metadata: Omit<EkonImportBatch, 'id'> = {
    fileName: input.fileName,
    contentHash: input.contentHash,
    status: 'pending_confirmation',
    createdByUid: input.actor.uid,
    createdByEmail: input.actor.email,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    detectedPeriods: input.detectedPeriods.slice(),
    confirmedPeriodIds: [],
    coverage: input.coverage,
    totals: emptyTotals(input.rows.length),
    warnings: input.warnings.slice(),
    schemaVersion: EKON_SCHEMA_VERSION,
  };
  const first = writeBatch(database);
  first.set(ref, metadata);
  await first.commit();

  // Snapshot de filas en chunks para respetar el límite de tamaño de documento.
  const chunks: EkonRawRow[][] = [];
  for (let i = 0; i < input.rows.length; i += ROWS_PER_CHUNK) {
    chunks.push(input.rows.slice(i, i + ROWS_PER_CHUNK));
  }
  for (let i = 0; i < chunks.length; i += CHUNK_LIMIT) {
    const batch = writeBatch(database);
    for (let j = 0; j < chunks.slice(i, i + CHUNK_LIMIT).length; j += 1) {
      const index = i + j;
      batch.set(
        doc(
          database,
          BATCHES,
          ref.id,
          ROW_CHUNKS,
          String(index).padStart(5, '0'),
        ),
        {
          index,
          rows: chunks[index],
        },
      );
    }
    await batch.commit();
  }

  return ref.id;
}

export interface ActivateBatchInput {
  batchId: string;
  assignments: readonly EkonAssignment[];
  confirmedPeriodIds: readonly string[];
  totals: Partial<EkonBatchTotals>;
  actor: Actor;
}

export interface ActivateBatchResult {
  written: number;
  revisions: number;
  totals: EkonBatchTotals;
}

/**
 * Activa un lote: calcula el diff contra las asignaciones vigentes, persiste lo
 * cambiado y las revisiones, y marca el lote `completed`. Solo se escriben las
 * asignaciones con cambios reales (las `sin-cambios` no se reescriben).
 */
export async function activateBatch(
  input: ActivateBatchInput,
): Promise<ActivateBatchResult> {
  const database = db();
  const batchRef = doc(database, BATCHES, input.batchId);
  const now = Date.now();

  await updateDoc(batchRef, { status: 'processing', updatedAt: now });

  try {
    const previous = await listAllAssignments();
    const diff = diffAssignments(
      {
        previous,
        incoming: input.assignments,
        confirmedPeriods: new Set(input.confirmedPeriodIds),
        batchId: input.batchId,
      },
      now,
    );

    // Solo lo cambiado (evita reescribir decenas de miles de filas iguales).
    const changed: StoredEkonAssignment[] = diff.entries
      .filter((e) => e.state !== 'sin-cambios')
      .map((e) => e.after);
    const written = await upsertAssignments(changed);
    const revisions = await appendRevisions(
      diff.revisions,
      input.batchId,
      input.actor,
      now,
    );

    const totals: EkonBatchTotals = {
      ...emptyTotals(input.totals.totalRows ?? 0),
      ...input.totals,
      nuevas: diff.counts.nueva,
      modificadas: diff.counts.modificada,
      sinCambios: diff.counts['sin-cambios'],
      noIncluidas: diff.counts['no-incluida'],
      restauradas: diff.counts.restaurada,
      conflictos: diff.counts.conflicto,
    };

    await updateDoc(batchRef, {
      status: 'completed',
      completedAt: now,
      updatedAt: now,
      confirmedPeriodIds: [...input.confirmedPeriodIds],
      totals,
    });

    return { written, revisions, totals };
  } catch (error) {
    await updateDoc(batchRef, {
      status: 'failed',
      updatedAt: Date.now(),
    }).catch(() => {});
    throw error;
  }
}

function emptyTotals(totalRows: number): EkonBatchTotals {
  return {
    totalRows,
    validRows: 0,
    rejectedRows: 0,
    distinctCampaigns: 0,
    distinctLines: 0,
    distinctDeterminantes: 0,
    periods: 0,
    nuevas: 0,
    modificadas: 0,
    sinCambios: 0,
    noIncluidas: 0,
    restauradas: 0,
    conflictos: 0,
  };
}

/** Lee el snapshot de filas de un lote (reensamblando los chunks). */
export async function readBatchRows(batchId: string): Promise<EkonRawRow[]> {
  const snapshot = await getDocs(
    query(collection(db(), BATCHES, batchId, ROW_CHUNKS), orderBy('index')),
  );
  return snapshot.docs.flatMap(
    (d) => (d.data() as { rows: EkonRawRow[] }).rows,
  );
}

/** Lee un lote por id. */
export async function getBatch(
  batchId: string,
): Promise<EkonBatchSummary | null> {
  const snap = await getDoc(doc(db(), BATCHES, batchId));
  return snap.exists()
    ? { id: snap.id, ...(snap.data() as Omit<EkonImportBatch, 'id'>) }
    : null;
}
