import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { EkonRevisionPlan } from '@/domain/ekon';
import type { Actor } from '@/modules/admira-catalog/screenFactory';

/**
 * Historial de revisiones de asignaciones Ekon (colección `ekonRevisions`).
 *
 * Append-only: conserva snapshot anterior y nuevo, campos modificados, lote,
 * fecha, usuario y tipo de evento. Nunca se edita ni se borra desde el cliente.
 */

const COLLECTION = 'ekonRevisions';
const BATCH_LIMIT = 400;

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Agrega las revisiones de un lote en escrituras segmentadas. */
export async function appendRevisions(
  plans: readonly EkonRevisionPlan[],
  batchId: string,
  actor: Actor,
  now = Date.now(),
): Promise<number> {
  const database = db();
  let written = 0;
  for (let i = 0; i < plans.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const plan of plans.slice(i, i + BATCH_LIMIT)) {
      const ref = doc(collection(database, COLLECTION));
      batch.set(ref, {
        key: plan.key,
        batchId,
        event: plan.event,
        before: plan.before,
        after: plan.after,
        changedFields: plan.changedFields,
        at: now,
        byUid: actor.uid,
        byEmail: actor.email,
      });
      written += 1;
    }
    await batch.commit();
  }
  return written;
}

/** Lee el historial de una asignación por su llave estable (para el detalle). */
export async function listRevisionsForKey(key: string) {
  const q = query(collection(db(), COLLECTION), where('key', '==', key));
  const snapshot = await getDocs(q);
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
    .sort(
      (a, b) =>
        Number((a as { at?: number }).at) - Number((b as { at?: number }).at),
    );
}
