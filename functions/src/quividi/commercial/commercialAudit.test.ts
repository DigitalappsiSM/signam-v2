import { describe, expect, it } from 'vitest';
import { MAX_AUDIT_DAYS, isValidAuditRange } from './commercialAudit';

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
