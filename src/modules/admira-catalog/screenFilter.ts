import type { AdmiraScreen } from '@/domain';

/** Filtro de estado para el catálogo. */
export type ScreenStatusFilter = 'all' | 'active' | 'inactive';

export interface ScreenFilters {
  /** Búsqueda de texto libre (case-insensitive) sobre los campos originales. */
  search: string;
  status: ScreenStatusFilter;
  /** Filtros exactos opcionales (valor vacío = sin filtro). */
  store: string;
  model: string;
  resolution: string;
}

export const EMPTY_FILTERS: ScreenFilters = {
  search: '',
  status: 'all',
  store: '',
  model: '',
  resolution: '',
};

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Devuelve los valores únicos (no vacíos) de un campo original, ordenados. */
export function uniqueValues(
  screens: readonly AdmiraScreen[],
  field: keyof AdmiraScreen['original'],
): string[] {
  const set = new Set<string>();
  for (const screen of screens) {
    const value = screen.original[field]?.trim();
    if (value) set.add(value);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

/**
 * Filtra las pantallas del catálogo por estado, filtros exactos y búsqueda de
 * texto. La búsqueda es tolerante a acentos y mayúsculas y recorre todos los
 * campos originales.
 */
export function filterScreens(
  screens: readonly AdmiraScreen[],
  filters: ScreenFilters,
): AdmiraScreen[] {
  const query = normalize(filters.search);

  return screens.filter((screen) => {
    if (filters.status === 'active' && !screen.metadata.active) return false;
    if (filters.status === 'inactive' && screen.metadata.active) return false;

    if (
      filters.store &&
      screen.original['Numero de Tienda'] !== filters.store
    ) {
      return false;
    }
    if (filters.model && screen.original.Modelo !== filters.model) {
      return false;
    }
    if (
      filters.resolution &&
      screen.original.RESOLUCION !== filters.resolution
    ) {
      return false;
    }

    if (query !== '') {
      const haystack = normalize(Object.values(screen.original).join(' '));
      if (!haystack.includes(query)) return false;
    }

    return true;
  });
}
