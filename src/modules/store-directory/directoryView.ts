import { foldText, type StoreDirectoryEntry } from '@/domain/stores';

export type LocationFilter = 'all' | 'gps' | 'no-gps' | 'no-postal';

export interface DirectoryFilters {
  search: string;
  status: 'all' | 'active' | 'inactive';
  state: string;
  zone: string;
  location: LocationFilter;
}

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = {
  search: '',
  status: 'all',
  state: '',
  zone: '',
  location: 'all',
};

/** Filtra el directorio por texto libre, estatus, estado, zona y ubicación. */
export function filterDirectory<T extends StoreDirectoryEntry>(
  entries: readonly T[],
  filters: DirectoryFilters,
): T[] {
  const q = foldText(filters.search);
  return entries.filter((e) => {
    if (filters.status !== 'all' && e.status !== filters.status) return false;
    if (filters.state && e.state !== filters.state) return false;
    if (filters.zone && e.zone !== filters.zone) return false;
    if (filters.location === 'gps' && e.lat === null) return false;
    if (filters.location === 'no-gps' && e.lat !== null) return false;
    if (filters.location === 'no-postal' && e.postalCode !== null) return false;
    if (q === '') return true;
    return foldText(
      [
        e.storeNumber,
        e.name,
        e.municipality,
        e.neighborhood,
        e.postalCode ?? '',
      ].join(' '),
    ).includes(q);
  });
}

export interface DirectorySummary {
  total: number;
  active: number;
  withGps: number;
  withoutGps: number;
  withoutPostalCode: number;
  states: number;
}

/** Totales del encabezado. `withoutGps` cuenta solo tiendas activas. */
export function summarizeDirectory(
  entries: readonly StoreDirectoryEntry[],
): DirectorySummary {
  const active = entries.filter((e) => e.status === 'active');
  return {
    total: entries.length,
    active: active.length,
    withGps: entries.filter((e) => e.lat !== null).length,
    withoutGps: active.filter((e) => e.lat === null).length,
    withoutPostalCode: active.filter((e) => e.postalCode === null).length,
    states: new Set(entries.map((e) => e.state).filter(Boolean)).size,
  };
}

/** Texto corto de la fuente de ubicación. */
export function locationLabel(entry: StoreDirectoryEntry): string {
  if (entry.lat === null) return 'Sin coordenadas';
  return entry.coordinateSource === 'manual' ? 'GPS manual' : 'GPS Ekon';
}

/** Enlace a Google Maps para verificar una coordenada a simple vista. */
export function mapsUrl(entry: StoreDirectoryEntry): string | null {
  if (entry.lat === null || entry.lng === null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${entry.lat},${entry.lng}`;
}
