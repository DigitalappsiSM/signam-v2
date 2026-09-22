import { describe, expect, it } from 'vitest';
import {
  compactChips,
  formatFilterDate,
  formatFilterSearch,
} from './filterChips';

describe('filterChips', () => {
  it('descarta los filtros no aplicados', () => {
    const noop = () => {};
    const chips = compactChips([
      false,
      { key: 'a', label: 'A', value: '1', onRemove: noop },
      null,
      undefined,
      { key: 'b', label: 'B', value: '2', onRemove: noop },
    ]);
    expect(chips.map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('muestra las fechas civiles como dd/mm/aaaa', () => {
    expect(formatFilterDate('2026-09-01')).toBe('01/09/2026');
    expect(formatFilterDate('otro')).toBe('otro');
  });

  it('recorta y entrecomilla la búsqueda', () => {
    expect(formatFilterSearch('  nike ')).toBe('“nike”');
  });
});
