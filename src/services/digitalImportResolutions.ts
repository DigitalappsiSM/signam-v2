import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { DigitalImportResolution } from '@/domain/digital-operations';
const NAME = 'digitalImportResolutions';
function database() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}
export async function saveDigitalResolutions(
  values: readonly DigitalImportResolution[],
) {
  await Promise.all(
    values.map((v) => setDoc(doc(database(), NAME, `${v.batchId}-${v.id}`), v)),
  );
}
export async function listDigitalResolutions() {
  const s = await getDocs(collection(database(), NAME));
  return s.docs.map((d) => d.data() as DigitalImportResolution);
}
