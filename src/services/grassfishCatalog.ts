import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import {
  GRASSFISH_IMPORT_LIMIT,
  type GrassfishPlayer,
} from '@/domain/grassfish';
import { getFirebase } from './firebase';

const COLLECTION = 'grassfishPlayers';

function database() {
  const firebase = getFirebase();
  if (!firebase) throw new Error('Firebase no está configurado.');
  return firebase.db;
}

export async function listGrassfishPlayers(): Promise<GrassfishPlayer[]> {
  const snapshot = await getDocs(collection(database(), COLLECTION));
  return snapshot.docs
    .map((entry) => entry.data() as GrassfishPlayer)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function saveGrassfishPlayers(
  players: readonly GrassfishPlayer[],
) {
  if (players.length > GRASSFISH_IMPORT_LIMIT) {
    throw new Error('El archivo excede el límite de la importación.');
  }
  const db = database();
  const batch = writeBatch(db);
  for (const player of players) {
    batch.set(doc(db, COLLECTION, player.boxId), player);
  }
  await batch.commit();
}

export async function validateChedrauiLocations(locationIds: number[]) {
  const firebase = getFirebase();
  if (!firebase) throw new Error('Firebase no está configurado.');
  const validate = httpsCallable<
    { locationIds: number[] },
    { missingLocationIds: number[] }
  >(firebase.functions, 'quividi-validateChedrauiLocations');
  const result = await validate({ locationIds });
  return result.data.missingLocationIds;
}
