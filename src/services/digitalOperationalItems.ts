import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { DigitalOperationalItem } from '@/domain/digital-operations';
const NAME = 'digitalOperationalItems';
function database() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}
export async function listDigitalOperationalItems() {
  const s = await getDocs(collection(database(), NAME));
  return s.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as DigitalOperationalItem,
  );
}
export async function saveDigitalOperationalItems(
  items: readonly DigitalOperationalItem[],
) {
  await Promise.all(
    items.map(({ id, ...data }) =>
      setDoc(doc(database(), NAME, id), data, { merge: true }),
    ),
  );
}
