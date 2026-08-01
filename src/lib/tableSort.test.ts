import { describe, it, expect } from 'vitest';
import {
  nextSortState,
  compareValues,
  sortRows,
  type SortState,
} from './tableSort';

describe('nextSortState', () => {
  it('activa una columna nueva en ascendente', () => {
    expect(nextSortState({ key: null, dir: 'asc' }, 'name')).toEqual({
      key: 'name',
      dir: 'asc',
    });
  });

  it('alterna la dirección si la columna ya estaba activa', () => {
    expect(nextSortState({ key: 'name', dir: 'asc' }, 'name')).toEqual({
      key: 'name',
      dir: 'desc',
    });
    expect(nextSortState({ key: 'name', dir: 'desc' }, 'name')).toEqual({
      key: 'name',
      dir: 'asc',
    });
  });

  it('cambia de columna reinicia a ascendente', () => {
    expect(nextSortState({ key: 'name', dir: 'desc' }, 'date')).toEqual({
      key: 'date',
      dir: 'asc',
    });
  });
});

describe('compareValues', () => {
  it('compara números por magnitud', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
  });
  it('compara texto con locale (numérico y acentos)', () => {
    expect(compareValues('a2', 'a10')).toBeLessThan(0);
    expect(compareValues('á', 'z')).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Beta', n: 2 },
    { name: 'alfa', n: 10 },
    { name: 'Gamma', n: 1 },
  ];
  const accessors = {
    name: (r: (typeof rows)[number]) => r.name,
    n: (r: (typeof rows)[number]) => r.n,
  };

  it('sin columna activa conserva el orden y no muta', () => {
    const state: SortState = { key: null, dir: 'asc' };
    const out = sortRows(rows, state, accessors);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });

  it('ordena texto ascendente ignorando mayúsculas', () => {
    const out = sortRows(rows, { key: 'name', dir: 'asc' }, accessors);
    expect(out.map((r) => r.name)).toEqual(['alfa', 'Beta', 'Gamma']);
  });

  it('ordena números descendente', () => {
    const out = sortRows(rows, { key: 'n', dir: 'desc' }, accessors);
    expect(out.map((r) => r.n)).toEqual([10, 2, 1]);
  });

  it('clave sin accesor conserva el orden', () => {
    const out = sortRows(rows, { key: 'zzz', dir: 'asc' }, accessors);
    expect(out.map((r) => r.name)).toEqual(['Beta', 'alfa', 'Gamma']);
  });
});
