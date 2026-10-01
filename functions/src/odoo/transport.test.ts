import { afterEach, describe, expect, it, vi } from 'vitest';
import { odooCall } from '../quividi/odooTickets';

afterEach(() => vi.unstubAllGlobals());
describe('errores seguros de API Odoo', () => {
  it.each([
    [401, { message: 'Invalid apikey: private-secret' }, 'odoo-auth'],
    [403, { message: 'private record' }, 'odoo-access'],
    [
      400,
      { name: 'odoo.exceptions.AccessError', message: 'private record' },
      'odoo-access',
    ],
    [400, { message: 'Invalid language code: es_MX' }, 'odoo-language'],
    [400, { message: 'private traceback' }, 'odoo-request'],
    [503, { message: 'private server info' }, 'odoo-unavailable'],
  ])(
    'clasifica HTTP %s sin exponer su cuerpo',
    async (status, body, reason) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify(body), { status: Number(status) }),
          ),
      );
      const error = await odooCall(
        'test-key',
        'helpdesk.team',
        'search_read',
        {},
      ).catch((cause) => cause);
      expect(error).toMatchObject({ status, reason, model: 'helpdesk.team' });
      expect(error.message).not.toMatch(/private|es_MX|test-key/);
      expect(JSON.stringify(error)).not.toContain('private');
    },
  );
});
