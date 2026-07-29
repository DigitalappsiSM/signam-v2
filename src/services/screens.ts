import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  orderBy,
  query,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  bumpMetadata,
  newScreenMetadata,
  sanitizeOriginal,
  type Actor,
} from '@/modules/admira-catalog/screenFactory';

/**
 * Acceso a la colección `screens` (catálogo Admira) en Cloud Firestore.
 *
 * Los campos originales del maestro se guardan bajo `original` y los metadatos
 * de SIGNAM bajo `metadata`, sin mezclarse (ver dominio `AdmiraScreen`).
 */

const COLLECTION = 'screens';

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee todas las pantallas del catálogo, ordenadas por fecha de creación. */
export async function listScreens(): Promise<AdmiraScreen[]> {
  const q = query(collection(db(), COLLECTION), orderBy('metadata.createdAt'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AdmiraScreen, 'id'>),
  }));
}

/** Crea una pantalla nueva a partir de campos originales parciales. */
export async function createScreen(
  original: Partial<AdmiraScreenOriginal>,
  actor: Actor,
): Promise<string> {
  const now = Date.now();
  const ref = doc(collection(db(), COLLECTION));
  await setDoc(ref, {
    original: sanitizeOriginal(original),
    metadata: newScreenMetadata(actor, now),
  });
  return ref.id;
}

/** Actualiza los campos originales de una pantalla existente. */
export async function updateScreen(
  screen: AdmiraScreen,
  original: Partial<AdmiraScreenOriginal>,
  actor: Actor,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTION, screen.id), {
    original: sanitizeOriginal(original),
    metadata: bumpMetadata(screen.metadata, actor, Date.now()),
  });
}

/** Inactiva una pantalla registrando el motivo (no la elimina). */
export async function deactivateScreen(
  screen: AdmiraScreen,
  reason: string,
  actor: Actor,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTION, screen.id), {
    metadata: bumpMetadata(screen.metadata, actor, Date.now(), {
      active: false,
      deactivationReason: reason.trim(),
    }),
  });
}

/** Reactiva una pantalla previamente inactivada. */
export async function reactivateScreen(
  screen: AdmiraScreen,
  actor: Actor,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTION, screen.id), {
    metadata: bumpMetadata(screen.metadata, actor, Date.now(), {
      active: true,
      deactivationReason: null,
    }),
  });
}
