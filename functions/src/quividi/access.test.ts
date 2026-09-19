import { describe, expect, it } from 'vitest';
import {
  QUIVIDI_REPORT_ROLES,
  canReportQuividi,
  roleFromClaims,
} from './access';

/**
 * El reparto por rol del reporte Quividi debe seguir siendo el espejo exacto
 * de la capacidad `quividi.report` de `src/app/permissions.ts`.
 */

describe('roleFromClaims', () => {
  it('lee el rol del custom claim', () => {
    expect(roleFromClaims({ role: 'admin' })).toBe('admin');
    expect(roleFromClaims({ role: 'operator' })).toBe('operator');
    expect(roleFromClaims({ role: 'viewer' })).toBe('viewer');
  });

  it('nunca asume un rol mayor: sin claim o con basura cae en viewer', () => {
    expect(roleFromClaims(undefined)).toBe('viewer');
    expect(roleFromClaims({})).toBe('viewer');
    expect(roleFromClaims({ role: 'superadmin' })).toBe('viewer');
    expect(roleFromClaims({ role: 'ADMIN' })).toBe('viewer');
    expect(roleFromClaims({ role: 42 })).toBe('viewer');
    expect(roleFromClaims({ role: null })).toBe('viewer');
  });
});

describe('canReportQuividi', () => {
  it('permite el informe a los tres roles', () => {
    expect(canReportQuividi('admin')).toBe(true);
    expect(canReportQuividi('operator')).toBe(true);
    expect(canReportQuividi('viewer')).toBe(true);
  });

  it('un token sin claim aprovisionado conserva el acceso', () => {
    expect(canReportQuividi(roleFromClaims(undefined))).toBe(true);
  });

  it('declara explícitamente los roles con la capacidad', () => {
    expect([...QUIVIDI_REPORT_ROLES].sort()).toEqual([
      'admin',
      'operator',
      'viewer',
    ]);
  });
});
