import { describe, expect, it } from 'vitest';
import {
  MAX_AUDIT_DAYS,
  consistencyFor,
  isValidAuditRange,
  type RawPointDay,
} from './commercialAudit';
import type { CommercialDailyRow } from './commercialRollup';

function raw(ots: number, measured = true): RawPointDay {
  return {
    locationId: 1,
    pointId: 'LIV-004-MUPI-P1',
    ots,
    effectiveOts: 0,
    watchers: 0,
    attentionSeconds: 0,
    dwellSeconds: 0,
    measured,
    otsMeasured: measured,
    viewersMeasured: measured,
  };
}

function rollup(ots: number, status: CommercialDailyRow['status'] = 'measured') {
  return { ots, status } as CommercialDailyRow;
}

describe('isValidAuditRange', () => {
  it('acepta un rango real dentro del tope', () => {
    expect(isValidAuditRange('2026-03-01', '2026-03-31')).toBe(true);
    expect(isValidAuditRange('2026-03-01', '2026-03-01')).toBe(true);
  });

  it('acepta exactamente MAX_AUDIT_DAYS días y rechaza uno más', () => {
    expect(MAX_AUDIT_DAYS).toBe(93);
    expect(isValidAuditRange('2026-01-01', '2026-04-03')).toBe(true);
    expect(isValidAuditRange('2026-01-01', '2026-04-04')).toBe(false);
  });

  it('rechaza rangos gigantes, invertidos o con fechas inexistentes', () => {
    expect(isValidAuditRange('0000-01-01', '9999-12-31')).toBe(false);
    expect(isValidAuditRange('2026-03-02', '2026-03-01')).toBe(false);
    expect(isValidAuditRange('2026-02-30', '2026-03-01')).toBe(false);
    expect(isValidAuditRange('2026-3-1', '2026-03-05')).toBe(false);
  });
});

describe('consistencyFor', () => {
  it('crudo sin rollup es «pendiente», no una discrepancia', () => {
    expect(consistencyFor([raw(7482)], null, false)).toBe('pending-rollup');
  });

  it('sin crudo ni rollup: sin datos', () => {
    expect(consistencyFor([raw(0, false)], null, false)).toBe('no-data');
  });

  it('rollup guardado: cuadra o no con el crudo recombinado', () => {
    expect(consistencyFor([raw(7482)], rollup(7482), false)).toBe('ok');
    expect(consistencyFor([raw(7482)], rollup(7000), false)).toBe('mismatch');
  });

  it('rollup guardado como «sin medición» pero ya hay crudo: discrepancia', () => {
    expect(consistencyFor([raw(7482)], rollup(0, 'missing'), false)).toBe(
      'mismatch',
    );
  });
});
