import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  diffAssignments,
  EKON_SCHEMA_VERSION,
  type EkonAssignment,
  type EkonImportBatch,
  type EkonBatchTotals,
  type EkonPeriod,
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
 * - `createPendingBatch`: guarda los metadatos del lote (nombre, hash, periodos,
 *   cobertura, totales) sin tocar el estado vigente. Reimportar el mismo
 *   contenido no duplica (hash).
 * - `activateBatch`: calcula el diff contra las asignaciones vigentes, escribe
 *   solo lo cambiado y las revisiones, y marca `completed`. Idempotente y
 *   reintentable: un fallo a mitad deja el lote sin `completed`, y reejecutar
 *   recalcula el diff sobre el estado actual.
 *
 * Decisión técnica: NO se persiste el snapshot crudo de las ~21 mil filas del
 * archivo en Firestore. Escribir el archivo completo (≈11 MiB normalizados)
 * superaba el límite de tamaño de escritura y hacía frágil la importación. La
 * trazabilidad se conserva con los metadatos del lote (nombre, hash, totales,
 * periodos), las asignaciones vigentes y el historial de revisiones; el archivo
 * de origen sigue siendo el registro crudo definitivo.
 *
 * Conciliación y fallback consumen SOLO lotes completados.
 */

const BATCHES = 'ekonImportBatches';

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
  /** Total de filas leídas (solo para los totales; las filas no se persisten). */
  rowCount: number;
  detectedPeriods: readonly EkonPeriod[];
  coverage: { min: string | null; max: string | null };
  warnings: readonly string[];
  actor: Actor;
}

/**
 * Crea un lote en estado `pending_confirmation` con sus metadatos. No toca el
 * estado vigente hasta que se active. Devuelve el id del lote. Es una sola
 * escritura pequeña (no persiste el archivo crudo, ver nota del módulo).
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
    totals: emptyTotals(input.rowCount),
    warnings: input.warnings.slice(),
    schemaVersion: EKON_SCHEMA_VERSION,
  };
  await setDoc(ref, metadata);
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

/** Lee un lote por id. */
export async function getBatch(
  batchId: string,
): Promise<EkonBatchSummary | null> {
  const snap = await getDoc(doc(db(), BATCHES, batchId));
  return snap.exists()
    ? { id: snap.id, ...(snap.data() as Omit<EkonImportBatch, 'id'>) }
    : null;
}
