import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { getFirebase } from './firebase';
import { writeInChunks } from './batchWrite';
import {
  canonicalState,
  canonicalZone,
  compareStoreNumbers,
  type StoreDirectoryEntry,
} from '@/domain/stores';
import type { Actor } from '@/modules/admira-catalog/screenFactory';

/**
 * Colección `storeDirectory/{storeNumber}`: ficha de ubicación por tienda.
 *
 * Es independiente de `screens`: el catálogo la consulta por número de tienda,
 * pero importar o editar el directorio nunca toca pantallas, campañas,
 * consolidaciones ni CSV. Las tiendas no se borran; se marcan inactivas.
 */

const COLLECTION = 'storeDirectory';

export interface StoredDirectoryEntry extends StoreDirectoryEntry {
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
}

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Convierte un documento a ficha, tolerando campos ausentes o corruptos. */
export function entryFromDoc(
  id: string,
  data: Record<string, unknown>,
): StoredDirectoryEntry {
  const lat = num(data.lat);
  const lng = num(data.lng);
  const hasCoords = lat !== null && lng !== null;
  const source = data.coordinateSource;
  return {
    storeNumber: str(data.storeNumber) || id,
    name: str(data.name),
    status: data.status === 'inactive' ? 'inactive' : 'active',
    street: str(data.street),
    neighborhood: str(data.neighborhood),
    municipality: str(data.municipality),
    state: canonicalState(str(data.state)),
    zone: canonicalZone(str(data.zone)),
    postalCode: /^\d{5}$/.test(str(data.postalCode))
      ? str(data.postalCode)
      : null,
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
    coordinateSource:
      hasCoords && (source === 'ekon' || source === 'manual') ? source : null,
    createdAt: num(data.createdAt) ?? 0,
    updatedAt: num(data.updatedAt) ?? 0,
    updatedBy: str(data.updatedBy),
  };
}

/** Lee el directorio completo, en orden natural de número de tienda. */
export async function listStoreDirectory(): Promise<StoredDirectoryEntry[]> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.docs
    .map((d) => entryFromDoc(d.id, d.data()))
    .sort((a, b) => compareStoreNumbers(a.storeNumber, b.storeNumber));
}

function toDoc(
  entry: StoreDirectoryEntry,
  actor: Actor,
  now: number,
  createdAt: number | undefined,
) {
  return {
    storeNumber: entry.storeNumber,
    name: entry.name,
    status: entry.status,
    street: entry.street,
    neighborhood: entry.neighborhood,
    municipality: entry.municipality,
    state: entry.state,
    zone: entry.zone,
    postalCode: entry.postalCode,
    lat: entry.lat,
    lng: entry.lng,
    coordinateSource: entry.coordinateSource,
    createdAt: createdAt ?? now,
    updatedAt: now,
    updatedBy: actor.email,
  };
}

/**
 * Guarda las fichas confirmadas por el usuario (nuevas y modificadas). Las
 * tiendas que el archivo no trae no se tocan. Idempotente y reintentable.
 */
export async function saveStoreDirectory(
  entries: readonly StoreDirectoryEntry[],
  existing: readonly StoredDirectoryEntry[],
  actor: Actor,
): Promise<number> {
  if (entries.length === 0) return 0;
  const database = db();
  const now = Date.now();
  const created = new Map(existing.map((e) => [e.storeNumber, e.createdAt]));
  return writeInChunks(
    database,
    entries,
    (e) => doc(database, COLLECTION, e.storeNumber),
    (e) => toDoc(e, actor, now, created.get(e.storeNumber)),
  );
}

/** Guarda la edición manual de una sola tienda. */
export async function saveStoreEntry(
  entry: StoreDirectoryEntry,
  previous: StoredDirectoryEntry | null,
  actor: Actor,
): Promise<void> {
  const now = Date.now();
  await setDoc(
    doc(db(), COLLECTION, entry.storeNumber),
    toDoc(entry, actor, now, previous?.createdAt),
  );
}
