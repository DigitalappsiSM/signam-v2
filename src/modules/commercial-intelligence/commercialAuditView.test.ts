import { describe, expect, it } from 'vitest';
import {
  consistencyLabel,
  pointLabel,
  statusLabel,
  zoneSplitLabel,
} from './commercialAuditView';

describe('statusLabel', () => {
  it('traduce cada estado del rollup', () => {
    expect(statusLabel('measured')).toBe('Medido');
    expect(statusLabel('partial')).toBe('Parcial');
    expect(statusLabel('missing')).toBe('Sin medición');
  });
});

describe('zoneSplitLabel', () => {
  it('distingue zona partida de combinación estándar', () => {
    expect(zoneSplitLabel(true)).toBe('Zona partida (suma)');
    expect(zoneSplitLabel(false)).toBe('Combinación estándar');
  });
});

describe('consistencyLabel', () => {
  it('traduce la bandera calculada por el backend sin reinterpretarla', () => {
    expect(consistencyLabel('ok')).toBe('Consistente');
    expect(consistencyLabel('mismatch')).toBe(
      'Revisar: no cuadra con el crudo',
    );
    expect(consistencyLabel('no-data')).toBe('Sin datos');
  });
});

describe('pointLabel', () => {
  it('usa el pointId de catálogo cuando existe', () => {
    expect(pointLabel('LIV-199-MUPI-P1', 0)).toBe('LIV-199-MUPI-P1');
  });

  it('sin pointId usa un rótulo neutro, nunca el Location ID', () => {
    expect(pointLabel(null, 1)).toBe('Punto 2');
  });
});
