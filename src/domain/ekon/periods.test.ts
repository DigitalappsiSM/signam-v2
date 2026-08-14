import { describe, expect, it } from 'vitest';
import { analyzePeriods, confirmedPeriodSet } from './periods';
import { parseEkonGrid } from './parse';
import { buildGrid } from './fixtures';

function rows(specs: Parameters<typeof buildGrid>[0]) {
  return parseEkonGrid(buildGrid(specs)).rows;
}

describe('analyzePeriods', () => {
  it('detecta periodos únicos y cobertura', () => {
    const analysis = analyzePeriods(
      rows([
        { 'ID Periodo': '32', 'Inicio periodo': 46231, 'Fin periodo': 46237 },
        {
          'ID Periodo': '32',
          'Inicio periodo': 46231,
          'Fin periodo': 46237,
          Determinante: '20',
        },
        {
          'ID Periodo': '33',
          'Inicio periodo': 46238,
          'Fin periodo': 46244,
          Determinante: '30',
        },
      ]),
    );
    expect(analysis.periods).toHaveLength(2);
    expect(analysis.coverage.min).toBe('2026-07-28');
    expect(analysis.coverage.max).toBe('2026-08-10');
    expect(analysis.gaps).toHaveLength(0);
  });

  it('detecta huecos entre periodos no contiguos', () => {
    const analysis = analyzePeriods(
      rows([
        { 'ID Periodo': '32', 'Inicio periodo': 46231, 'Fin periodo': 46237 },
        // Salta el periodo 33; el 34 empieza más tarde → hueco.
        {
          'ID Periodo': '34',
          'Inicio periodo': 46245,
          'Fin periodo': 46251,
          Determinante: '30',
        },
      ]),
    );
    expect(analysis.gaps).toHaveLength(1);
    expect(analysis.gaps[0]!.after.idPeriodo).toBe('32');
    expect(analysis.gaps[0]!.before.idPeriodo).toBe('34');
  });

  it('detecta un mismo ID de periodo con fechas incompatibles', () => {
    const analysis = analyzePeriods(
      rows([
        { 'ID Periodo': '32', 'Inicio periodo': 46231, 'Fin periodo': 46237 },
        {
          'ID Periodo': '32',
          'Inicio periodo': 46232,
          'Fin periodo': 46238,
          Determinante: '20',
        },
      ]),
    );
    expect(analysis.inconsistentPeriodIds).toContain('32');
  });

  it('confirmedPeriodSet: por defecto confirma todos; o solo los elegidos', () => {
    const detected = analyzePeriods(
      rows([
        { 'ID Periodo': '32', 'Inicio periodo': 46231, 'Fin periodo': 46237 },
        {
          'ID Periodo': '33',
          'Inicio periodo': 46238,
          'Fin periodo': 46244,
          Determinante: '30',
        },
      ]),
    ).periods;
    expect(confirmedPeriodSet(detected, null).size).toBe(2);
    const only32 = confirmedPeriodSet(detected, ['32']);
    expect(only32.has('32')).toBe(true);
    expect(only32.has('33')).toBe(false);
  });
});
