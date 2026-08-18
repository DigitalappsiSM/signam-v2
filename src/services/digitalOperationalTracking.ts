import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  addDigitalComment,
  cancelDigitalTracking,
  createDigitalTracking,
  reactivateDigitalTracking,
  updateDigitalCheck,
  type Actor,
  type DigitalCheckKey,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';
const NAME = 'digitalOperationalTracking';
function database() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}
export async function listDigitalTracking() {
  const s = await getDocs(collection(database(), NAME));
  return s.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as DigitalOperationalTracking,
  );
}
export async function ensureDigitalTracking(
  ids: readonly string[],
  actor: Actor,
) {
  await Promise.all(
    ids.map(async (id) => {
      const ref = doc(database(), NAME, id);
      if (!(await getDoc(ref)).exists())
        await setDoc(ref, createDigitalTracking(id, actor));
    }),
  );
}
async function mutate(
  id: string,
  actor: Actor,
  fn: (t: DigitalOperationalTracking) => DigitalOperationalTracking,
) {
  return runTransaction(database(), async (tx) => {
    const ref = doc(database(), NAME, id),
      snap = await tx.get(ref);
    const current = snap.exists()
      ? ({ id: snap.id, ...snap.data() } as DigitalOperationalTracking)
      : createDigitalTracking(id, actor);
    const next = fn(current);
    tx.set(ref, next);
    return next;
  });
}
export const setDigitalCheck = (
  id: string,
  key: DigitalCheckKey,
  value: boolean,
  actor: Actor,
) => mutate(id, actor, (t) => updateDigitalCheck(t, key, value, actor));
export const setDigitalLifecycle = (
  id: string,
  cancelled: boolean,
  reason: string,
  actor: Actor,
) =>
  mutate(id, actor, (t) =>
    cancelled
      ? cancelDigitalTracking(t, reason, actor)
      : reactivateDigitalTracking(t, actor),
  );
export const appendDigitalComment = (id: string, text: string, actor: Actor) =>
  mutate(id, actor, (t) => addDigitalComment(t, text, actor));
