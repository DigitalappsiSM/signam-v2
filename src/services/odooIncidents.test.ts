import { describe, expect, it } from 'vitest';
import { odooErrorMessage } from './odooIncidents';
describe('diagnóstico de incidencias Odoo', () => {
  it('distingue la credencial de integración de la sesión de SIGNAM', () => {
    expect(
      odooErrorMessage({
        code: 'functions/failed-precondition',
        details: { reason: 'odoo-auth' },
      }),
    ).toContain('credencial de integración');
    expect(odooErrorMessage({ code: 'functions/unauthenticated' })).toContain(
      'Tu sesión expiró',
    );
  });
  it('no presenta texto arbitrario del servidor al usuario', () => {
    expect(
      odooErrorMessage({
        code: 'unknown',
        message: 'private-secret',
        details: { reason: 'private-secret' },
      }),
    ).not.toContain('private-secret');
  });
});
