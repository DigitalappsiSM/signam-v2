import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  initialDigitalProfiles,
  type Actor,
  type DigitalSupportProfile,
} from '@/domain/digital-operations';
const NAME = 'digitalSupportCatalog';
function database() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}
export async function listDigitalProfiles() {
  const snapshot = await getDocs(collection(database(), NAME));
  return snapshot.docs.map(
    (item) => ({ id: item.id, ...item.data() }) as DigitalSupportProfile,
  );
}
export async function seedDigitalProfiles(actor: Actor) {
  const existing = await listDigitalProfiles();
  if (existing.length) return existing;
  const profiles = initialDigitalProfiles(actor);
  await Promise.all(
    profiles.map(({ id, ...data }) => setDoc(doc(database(), NAME, id), data)),
  );
  return profiles;
}
export async function saveDigitalProfile(
  profile: DigitalSupportProfile,
  actor: Actor,
) {
  const now = Date.now();
  await setDoc(doc(database(), NAME, profile.id), {
    ...profile,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  });
}
