import {
  compareStoreNumbers,
  normalizeStoreNumber,
  type StoreDirectoryEntry,
} from './directory';

/** Campos comparables de una ficha (todo menos la llave). */
export const DIRECTORY_FIELDS = [
  'name',
  'status',
  'street',
  'neighborhood',
  'municipality',
  'state',
  'zone',
  'postalCode',
  'lat',
  'lng',
  'coordinateSource',
] as const;

export type DirectoryField = (typeof DIRECTORY_FIELDS)[number];

export interface DirectoryChange {
  storeNumber: string;
  before: StoreDirectoryEntry;
  after: StoreDirectoryEntry;
  fields: DirectoryField[];
}

export interface DirectoryDiff {
  created: StoreDirectoryEntry[];
  changed: DirectoryChange[];
  unchanged: StoreDirectoryEntry[];
  /** Tiendas guardadas que el archivo no trae. Se conservan: nunca se borran. */
  notInFile: StoreDirectoryEntry[];
}

/**
 * Fusiona lo importado sobre lo guardado sin perder información:
 * - un dato vacío en el archivo no borra uno guardado;
 * - unas coordenadas capturadas a mano (`manual`) no las pisa un archivo.
 */
export function mergeEntry(
  stored: StoreDirectoryEntry,
  incoming: StoreDirectoryEntry,
): StoreDirectoryEntry {
  const keepManualCoords =
    stored.coordinateSource === 'manual' && stored.lat !== null;
  const text = (a: string, b: string) => (b !== '' ? b : a);
  return {
    storeNumber: stored.storeNumber,
    name: text(stored.name, incoming.name),
    status: incoming.status,
    street: text(stored.street, incoming.street),
    neighborhood: text(stored.neighborhood, incoming.neighborhood),
    municipality: text(stored.municipality, incoming.municipality),
    state: incoming.state ?? stored.state,
    zone: incoming.zone ?? stored.zone,
    postalCode: incoming.postalCode ?? stored.postalCode,
    ...(keepManualCoords || incoming.lat === null
      ? {
          lat: stored.lat,
          lng: stored.lng,
          coordinateSource: stored.coordinateSource,
        }
      : {
          lat: incoming.lat,
          lng: incoming.lng,
          coordinateSource: incoming.coordinateSource,
        }),
  };
}

export function changedFields(
  a: StoreDirectoryEntry,
  b: StoreDirectoryEntry,
): DirectoryField[] {
  return DIRECTORY_FIELDS.filter((f) => a[f] !== b[f]);
}

/** Compara el directorio guardado contra el importado (ya fusionado). */
export function diffDirectory(
  stored: readonly StoreDirectoryEntry[],
  incoming: readonly StoreDirectoryEntry[],
): DirectoryDiff {
  const byNumber = new Map(stored.map((e) => [e.storeNumber, e]));
  const seen = new Set<string>();
  const diff: DirectoryDiff = {
    created: [],
    changed: [],
    unchanged: [],
    notInFile: [],
  };
  for (const entry of incoming) {
    seen.add(entry.storeNumber);
    const before = byNumber.get(entry.storeNumber);
    if (!before) {
      diff.created.push(entry);
      continue;
    }
    const after = mergeEntry(before, entry);
    const fields = changedFields(before, after);
    if (fields.length === 0) diff.unchanged.push(before);
    else
      diff.changed.push({
        storeNumber: entry.storeNumber,
        before,
        after,
        fields,
      });
  }
  diff.notInFile = stored
    .filter((e) => !seen.has(e.storeNumber))
    .sort((a, b) => compareStoreNumbers(a.storeNumber, b.storeNumber));
  return diff;
}

export interface CatalogCoverage {
  /** Tiendas con pantallas en el catálogo Admira que no están en el directorio. */
  catalogWithoutDirectory: {
    storeNumber: string;
    storeName: string;
    screens: number;
  }[];
  /** Tiendas activas del directorio sin ninguna pantalla activa en el catálogo. */
  directoryWithoutScreens: StoreDirectoryEntry[];
}

/**
 * Cruza el directorio contra las tiendas del catálogo de pantallas (solo
 * pantallas activas). Responde «¿falta alguna tienda?» en ambos sentidos.
 */
export function catalogCoverage(
  directory: readonly StoreDirectoryEntry[],
  screens: readonly {
    storeNumber: string;
    storeName: string;
    active: boolean;
  }[],
): CatalogCoverage {
  const inDirectory = new Set(directory.map((e) => e.storeNumber));
  const catalog = new Map<string, { storeName: string; screens: number }>();
  for (const s of screens) {
    if (!s.active) continue;
    const n = normalizeStoreNumber(s.storeNumber);
    if (n === '') continue;
    const prev = catalog.get(n);
    catalog.set(n, {
      storeName: prev?.storeName || s.storeName,
      screens: (prev?.screens ?? 0) + 1,
    });
  }
  return {
    catalogWithoutDirectory: [...catalog]
      .filter(([n]) => !inDirectory.has(n))
      .map(([storeNumber, v]) => ({ storeNumber, ...v }))
      .sort((a, b) => compareStoreNumbers(a.storeNumber, b.storeNumber)),
    directoryWithoutScreens: directory.filter(
      (e) => e.status === 'active' && !catalog.has(e.storeNumber),
    ),
  };
}
