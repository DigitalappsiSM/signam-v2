import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import { getFirebase } from './firebase';
import { safeDocId } from '@/domain/ekon';
import type { StoredEkonAssignment } from '@/domain/ekon';
import { writeInChunks } from './batchWrite';

/**
 * Persistencia de las asignaciones Ekon vigentes (colección `ekonAssignments`).
 *
 * Colección SEPARADA de `campaigns`, del catálogo y del seguimiento. El id del
 * documento se deriva de la llave estable de la asignación (`safeDocId(key)`),
 * de modo que reimportar produce upserts idempotentes sobre el mismo documento.
 * Las asignaciones `No incluida` se conservan con `active:false` (no se borran).
 */

const COLLECTION = 'ekonAssignments';

/**
 * Documento persistido: la asignación más un espejo ASCII del número Ekon
 * (`campaignNumber`). Firestore no admite rutas de campo con caracteres no ASCII
 * (la `ñ` de `campaña`) en `where()`, así que se consulta por este campo.
 */
type EkonAssignmentDoc = StoredEkonAssignment & { campaignNumber: string };

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee TODAS las asignaciones (base para el diff de una importación). */
export async function listAllAssignments(): Promise<StoredEkonAssignment[]> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.docs.map((d) => d.data() as StoredEkonAssignment);
}

/**
 * Lee las asignaciones VIGENTES (activas, sin conflicto) de un número Ekon.
 * Usa un índice `campaña + active`. El filtro de conflicto se aplica en memoria
 * (los conflictos se guardan con `active:false`, así que ya quedan excluidos).
 */
export async function listActiveAssignmentsByEkonNumber(
  ekonNumber: string,
): Promise<StoredEkonAssignment[]> {
  const q = query(
    collection(db(), COLLECTION),
    where('campaignNumber', '==', String(ekonNumber)),
    where('active', '==', true),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => d.data() as StoredEkonAssignment)
    .filter((a) => !a.conflict);
}

/**
 * Lee las asignaciones que explican una conciliación: vigentes más conflictos
 * pendientes. Las `No incluida` permanecen fuera; un conflicto se entrega al
 * motor solo para bloquear y explicar el resultado, nunca como dato válido.
 */
export async function listReconciliationAssignmentsByEkonNumber(
  ekonNumber: string,
): Promise<StoredEkonAssignment[]> {
  const q = query(
    collection(db(), COLLECTION),
    where('campaignNumber', '==', String(ekonNumber)),
  );
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => d.data() as StoredEkonAssignment)
    .filter((a) => a.active || Boolean(a.conflict));
}

/**
 * Escribe (upsert) el conjunto de asignaciones en lotes segmentados por debajo
 * del límite de Firestore. Idempotente por `safeDocId(key)`. Reintentable: si
 * falla a mitad, reejecutar recalcula el diff y reaplica solo lo pendiente.
 */
export async function upsertAssignments(
  assignments: readonly StoredEkonAssignment[],
): Promise<number> {
  const database = db();
  return writeInChunks(
    database,
    assignments,
    (a) => doc(database, COLLECTION, safeDocId(a.key)),
    (a): EkonAssignmentDoc => ({ ...a, campaignNumber: a.campaña }),
  );
}
