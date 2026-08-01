/**
 * Ordenamiento de tablas por columna (puro y reutilizable).
 *
 * Cada tabla define un mapa de "accesores" (columna → valor comparable) y
 * mantiene un `SortState`. Al pulsar un encabezado se alterna asc/desc con
 * `nextSortState`; `sortRows` devuelve una copia ordenada (estable) sin mutar.
 */

export type SortDir = 'asc' | 'desc';

export interface SortState {
  /** Clave de columna activa, o `null` para conservar el orden original. */
  key: string | null;
  dir: SortDir;
}

/** Valor comparable que devuelve un accesor de columna. */
export type SortValue = string | number;

export type Accessors<T> = Record<string, (row: T) => SortValue>;

/**
 * Siguiente estado al pulsar `key`: si ya estaba activa, alterna la dirección;
 * si no, la activa en ascendente.
 */
export function nextSortState(prev: SortState, key: string): SortState {
  if (prev.key === key) {
    return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key, dir: 'asc' };
}

/** Compara dos valores: números por magnitud, texto con locale español. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'es', { numeric: true });
}

/**
 * Copia ordenada de `rows` según `state`. Si no hay columna activa (o no tiene
 * accesor), devuelve una copia sin reordenar (orden original estable).
 */
export function sortRows<T>(
  rows: readonly T[],
  state: SortState,
  accessors: Accessors<T>,
): T[] {
  const out = [...rows];
  if (!state.key) return out;
  const accessor = accessors[state.key];
  if (!accessor) return out;
  const factor = state.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => factor * compareValues(accessor(a), accessor(b)));
}
