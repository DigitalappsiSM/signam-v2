import { describe, expect, it } from 'vitest';
import {
  consistencyLabel,
  hasPendingRollup,
  rawPointSummary,
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
    expect(consistencyLabel('pending-rollup')).toBe('Rollup pendiente');
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

describe('rawPointSummary', () => {
  const fmt = (value: number) => String(value);
  const base = { ots: 0, watchers: 229 };

  it('rotula la serie que no llegó como «sin medir», no como 0', () => {
    expect(
      rawPointSummary(
        { ...base, measured: true, otsMeasured: false, viewersMeasured: true },
        fmt,
      ),
    ).toBe('OTS sin medir · 229 watchers');
    expect(
      rawPointSummary(
        {
          ots: 7482,
          watchers: 0,
          measured: true,
          otsMeasured: true,
          viewersMeasured: false,
        },
        fmt,
      ),
    ).toBe('7482 OTS · watchers sin medir');
  });

  it('sin ninguna serie: «sin medición»', () => {
    expect(
      rawPointSummary(
        {
          ...base,
          measured: false,
          otsMeasured: false,
          viewersMeasured: false,
        },
        fmt,
      ),
    ).toBe('sin medición');
  });
});

describe('hasPendingRollup', () => {
  it('detecta días con crudo y sin rollup', () => {
    expect(hasPendingRollup([{ consistency: 'ok' }])).toBe(false);
    expect(
      hasPendingRollup([
        { consistency: 'ok' },
        { consistency: 'pending-rollup' },
      ]),
    ).toBe(true);
  });
});
