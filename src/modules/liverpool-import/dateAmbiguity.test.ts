import { describe, it, expect } from 'vitest';
import {
  isAmbiguousDate,
  interpretDate,
  ambiguousInterpretations,
} from './dateAmbiguity';

describe('isAmbiguousDate', () => {
  it('es ambigua cuando ambos componentes son ≤ 12 y distintos', () => {
    expect(isAmbiguousDate('10/05/2026')).toBe(true);
    expect(isAmbiguousDate('5-10-2026')).toBe(true);
  });

  it('no es ambigua si un componente es > 12 (se sabe el orden)', () => {
    expect(isAmbiguousDate('13/05/2026')).toBe(false);
    expect(isAmbiguousDate('05/13/2026')).toBe(false);
  });

  it('no es ambigua si los componentes son iguales', () => {
    expect(isAmbiguousDate('05/05/2026')).toBe(false);
  });

  it('no es ambigua para ISO ni para valores no numéricos', () => {
    expect(isAmbiguousDate('2026-10-05')).toBe(false);
    expect(isAmbiguousDate('5-oct-2026')).toBe(false);
    expect(isAmbiguousDate('')).toBe(false);
  });
});

describe('interpretDate', () => {
  it('DMY interpreta día-primero; MDY mes-primero', () => {
    expect(interpretDate('10/05/2026', 'DMY')).toBe('2026-05-10');
    expect(interpretDate('10/05/2026', 'MDY')).toBe('2026-10-05');
  });

  it('completa el año de dos dígitos', () => {
    expect(interpretDate('05/10/26', 'MDY')).toBe('2026-05-10');
  });

  it('devuelve null si la fecha no es válida en ese orden', () => {
    // 31/04 no existe como día-primero (abril tiene 30 días).
    expect(interpretDate('31/04/2026', 'DMY')).toBeNull();
    // Pero mes-primero (04/31 → día 31) tampoco: abril no tiene 31.
    expect(interpretDate('31/04/2026', 'MDY')).toBeNull();
  });
});

describe('ambiguousInterpretations', () => {
  it('devuelve ambas lecturas', () => {
    expect(ambiguousInterpretations('10/05/2026')).toEqual({
      dmy: '2026-05-10',
      mdy: '2026-10-05',
    });
  });
});
