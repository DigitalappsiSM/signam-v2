import { collection, doc, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/domain/digital-operations';
export async function saveDigitalExportSnapshot(
  batchId: string,
  fileName: string,
  periodIds: readonly string[],
  actor: Actor,
) {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  const record = {
    batchId,
    fileName,
    periodIds: [...periodIds],
    format: 'xlsx',
    createdAt: Date.now(),
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    schemaVersion: 1,
  };
  await setDoc(doc(collection(fb.db, 'digitalReportExports')), record);
  return record;
}
