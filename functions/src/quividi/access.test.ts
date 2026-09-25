import { describe, expect, it } from 'vitest';
import {
  QUIVIDI_FORCE_REFRESH_ROLES,
  QUIVIDI_HEALTH_REFRESH_ROLES,
  QUIVIDI_OPERATIONS_ROLES,
  QUIVIDI_REPORT_ROLES,
  canForceRefreshQuividi,
  canRefreshQuividiHealth,
  canReportQuividi,
  canUseQuividiOperations,
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
    expect(roleFromClaims({ role: 'commercial' })).toBe('commercial');
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

describe('canUseQuividiOperations', () => {
  it('excluye a Comercial de catálogo y salud de cámaras', () => {
    expect(canUseQuividiOperations('admin')).toBe(true);
    expect(canUseQuividiOperations('operator')).toBe(true);
    expect(canUseQuividiOperations('viewer')).toBe(true);
    expect(canUseQuividiOperations('commercial')).toBe(false);
    expect(QUIVIDI_OPERATIONS_ROLES).not.toContain('commercial');
  });
});

describe('canReportQuividi', () => {
  it('permite el informe a los cuatro roles', () => {
    expect(canReportQuividi('admin')).toBe(true);
    expect(canReportQuividi('operator')).toBe(true);
    expect(canReportQuividi('viewer')).toBe(true);
    expect(canReportQuividi('commercial')).toBe(true);
  });

  it('un token sin claim aprovisionado conserva el acceso', () => {
    expect(canReportQuividi(roleFromClaims(undefined))).toBe(true);
  });

  it('declara explícitamente los roles con la capacidad', () => {
    expect([...QUIVIDI_REPORT_ROLES].sort()).toEqual([
      'admin',
      'commercial',
      'operator',
      'viewer',
    ]);
  });
});

describe('canForceRefreshQuividi', () => {
  it('reserva el recálculo forzado a admin', () => {
    expect(canForceRefreshQuividi('admin')).toBe(true);
    expect(canForceRefreshQuividi('operator')).toBe(false);
    expect(canForceRefreshQuividi('viewer')).toBe(false);
    expect(canForceRefreshQuividi('commercial')).toBe(false);
  });

  it('un token sin claim aprovisionado no puede forzar el recálculo', () => {
    expect(canForceRefreshQuividi(roleFromClaims(undefined))).toBe(false);
    expect(canForceRefreshQuividi(roleFromClaims({ role: 'superadmin' }))).toBe(
      false,
    );
  });

  it('es más restrictivo que la consulta del informe', () => {
    expect(QUIVIDI_FORCE_REFRESH_ROLES).toEqual(['admin']);
    for (const role of QUIVIDI_FORCE_REFRESH_ROLES) {
      expect(QUIVIDI_REPORT_ROLES).toContain(role);
    }
  });
});


describe('canRefreshQuividiHealth', () => {
  it('permite refrescar salud a admin y operator, no a viewer/commercial', () => {
    expect(canRefreshQuividiHealth('admin')).toBe(true);
    expect(canRefreshQuividiHealth('operator')).toBe(true);
    expect(canRefreshQuividiHealth('viewer')).toBe(false);
    expect(canRefreshQuividiHealth('commercial')).toBe(false);
    expect(QUIVIDI_HEALTH_REFRESH_ROLES).toEqual(['admin', 'operator']);
  });
});
