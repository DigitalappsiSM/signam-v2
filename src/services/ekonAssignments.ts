import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import { safeDocId } from '@/domain/ekon';
import type { StoredEkonAssignment } from '@/domain/ekon';

/**
 * Persistencia de las asignaciones Ekon vigentes (colección `ekonAssignments`).
 *
 * Colección SEPARADA de `campaigns`, del catálogo y del seguimiento. El id del
 * documento se deriva de la llave estable de la asignación (`safeDocId(key)`),
 * de modo que reimportar produce upserts idempotentes sobre el mismo documento.
 * Las asignaciones `No incluida` se conservan con `active:false` (no se borran).
 */

const COLLECTION = 'ekonAssignments';
const BATCH_LIMIT = 400;

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
 * Escribe (upsert) el conjunto de asignaciones en lotes segmentados por debajo
 * del límite de Firestore. Idempotente por `safeDocId(key)`. Reintentable: si
 * falla a mitad, reejecutar recalcula el diff y reaplica solo lo pendiente.
 */
export async function upsertAssignments(
  assignments: readonly StoredEkonAssignment[],
): Promise<number> {
  const database = db();
  let written = 0;
  for (let i = 0; i < assignments.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const assignment of assignments.slice(i, i + BATCH_LIMIT)) {
      const docData: EkonAssignmentDoc = {
        ...assignment,
        campaignNumber: assignment.campaña,
      };
      batch.set(doc(database, COLLECTION, safeDocId(assignment.key)), docData);
      written += 1;
    }
    await batch.commit();
  }
  return written;
}
