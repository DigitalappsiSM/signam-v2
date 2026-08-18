import { collection, doc, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { DigitalDiffEntry } from '@/domain/digital-operations/operations';
import type { Actor } from '@/domain/digital-operations';
export async function saveDigitalRevisions(
  entries: readonly DigitalDiffEntry[],
  batchId: string,
  actor: Actor,
) {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  const now = Date.now();
  await Promise.all(
    entries
      .filter((e) => e.state !== 'sin-cambios')
      .map((e, i) =>
        setDoc(doc(collection(fb.db, 'digitalPlacementRevisions')), {
          batchId,
          state: e.state,
          rowId: e.after.id,
          before: e.before,
          after: e.after,
          createdAt: now,
          createdByUid: actor.uid,
          createdByEmail: actor.email,
          sequence: i,
        }),
      ),
  );
}
