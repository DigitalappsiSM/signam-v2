import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { EkonRevisionPlan } from '@/domain/ekon';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { writeInChunks } from './batchWrite';

/**
 * Historial de revisiones de asignaciones Ekon (colección `ekonRevisions`).
 *
 * Append-only: conserva snapshot anterior y nuevo, campos modificados, lote,
 * fecha, usuario y tipo de evento. Nunca se edita ni se borra desde el cliente.
 */

const COLLECTION = 'ekonRevisions';

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Agrega las revisiones de un lote en escrituras segmentadas (ops + bytes). */
export async function appendRevisions(
  plans: readonly EkonRevisionPlan[],
  batchId: string,
  actor: Actor,
  now = Date.now(),
): Promise<number> {
  const database = db();
  return writeInChunks(
    database,
    plans,
    () => doc(collection(database, COLLECTION)),
    (plan) => ({
      key: plan.key,
      batchId,
      event: plan.event,
      before: plan.before,
      after: plan.after,
      changedFields: plan.changedFields,
      at: now,
      byUid: actor.uid,
      byEmail: actor.email,
    }),
  );
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
