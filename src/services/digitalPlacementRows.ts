import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { DigitalPlacementRow } from '@/domain/digital-operations';
const NAME = 'digitalPlacementRows';
function database() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}
export async function listDigitalPlacementRows() {
  const s = await getDocs(collection(database(), NAME));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }) as DigitalPlacementRow);
}
export async function saveDigitalPlacementRows(
  rows: readonly DigitalPlacementRow[],
) {
  for (let i = 0; i < rows.length; i += 350)
    await Promise.all(
      rows
        .slice(i, i + 350)
        .map(({ id, ...data }) => setDoc(doc(database(), NAME, id), data)),
    );
}
