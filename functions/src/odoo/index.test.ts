import { beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
vi.mock('../quividi/odooTickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../quividi/odooTickets')>()),
  odooCall: call,
}));
vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-secret' }),
}));
vi.mock('firebase-functions/v2/https', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('firebase-functions/v2/https')>();
  return {
    ...original,
    onCall: (_options: unknown, handler: unknown) => handler,
  };
});
import { overview } from './index';
import { OdooApiError } from '../quividi/odooTickets';
const run = overview as unknown as (request: {
  auth?: { token: { role: string } };
  data: { month: string };
}) => Promise<{
  tickets: {
    sla: string;
    firstResponseHours: number | null;
    store: string | null;
    policies: { name: string; status: string; targetStage: string }[];
  }[];
  warnings: string[];
}>;
beforeEach(() => {
  call.mockReset();
});
describe('lectura segura Odoo', () => {
  it('rechaza sin sesión y comercial antes de acceder a Odoo', async () => {
    await expect(run({ data: { month: '2026-09' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      run({
        auth: { token: { role: 'commercial' } },
        data: { month: '2026-09' },
      }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(call).not.toHaveBeenCalled();
  });
  it('acota equipo y mes México y advierte si SLA no es accesible', async () => {
    call.mockImplementation(async (_key, model, method, args) => {
      if (method === 'search_read') {
        expect(args.context).toEqual({ active_test: false });
        expect(args.context).not.toHaveProperty('lang');
      }
      if (model === 'helpdesk.team') return [{ id: 6, name: 'Liverpool' }];
      if (model === 'helpdesk.ticket' && method === 'fields_get')
        return Object.fromEntries(
          [
            'id',
            'name',
            'team_id',
            'partner_id',
            'user_id',
            'stage_id',
            'tag_ids',
            'description',
            'create_date',
            'first_response_hours',
          ].map((field) => [field, { type: 'test' }]),
        );
      if (model === 'helpdesk.ticket') {
        expect(args.domain).toEqual([
          ['team_id', 'in', [6]],
          ['create_date', '>=', '2026-09-01 06:00:00'],
          ['create_date', '<', '2026-10-01 06:00:00'],
        ]);
        return [
          {
            id: 1,
            name: 'Ticket',
            team_id: [6, 'Liverpool'],
            partner_id: [9, 'Persona'],
            stage_id: [1, 'Nuevo'],
            tag_ids: [],
            first_response_hours: 0,
          },
        ];
      }
      if (model === 'helpdesk.sla.status') throw new Error('denied');
      return [];
    });
    const result = await run({
      auth: { token: { role: 'viewer' } },
      data: { month: '2026-09' },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({
      sla: 'Sin dato',
      firstResponseHours: null,
      store: null,
    });
    expect(
      call.mock.calls.every(([, , method]) =>
        ['search_read', 'fields_get'].includes(method),
      ),
    ).toBe(true);
  });
  it('lee etapas objetivo de políticas sin mezclar ni perder resultados ante falta de permisos', async () => {
    let denied = false;
    call.mockImplementation(async (_key, model, method) => {
      if (model === 'helpdesk.team') return [{ id: 6, name: 'Liverpool' }];
      if (method === 'fields_get') {
        if (model === 'helpdesk.sla' && denied) throw new Error('denied');
        return Object.fromEntries(
          [
            'id',
            'name',
            'team_id',
            'partner_id',
            'user_id',
            'stage_id',
            'tag_ids',
            'description',
            'create_date',
            'ticket_id',
            'status',
            'sla_id',
          ].map((field) => [field, {}]),
        );
      }
      if (model === 'helpdesk.ticket')
        return [
          { id: 1, team_id: [6, 'Liverpool'], stage_id: [2, 'Resuelto'] },
        ];
      if (model === 'helpdesk.sla.status')
        return [
          {
            id: 1,
            ticket_id: [1, 'Ticket'],
            sla_id: [10, 'Primera respuesta'],
            status: 'failed',
          },
          {
            id: 2,
            ticket_id: [1, 'Ticket'],
            sla_id: [11, '48 horas'],
            status: 'reached',
          },
        ];
      if (model === 'helpdesk.sla')
        return [
          { id: 10, stage_id: [3, 'En progreso'] },
          { id: 11, stage_id: [2, 'Resuelto'] },
        ];
      return [];
    });
    const request = {
      auth: { token: { role: 'viewer' } },
      data: { month: '2026-09' },
    };
    const result = await run(request);
    expect(result.tickets[0]?.policies[1]).toMatchObject({
      targetStage: 'Resuelto',
      status: 'reached',
    });
    expect(result.tickets[0]?.sla).toBe('Incumplido');
    denied = true;
    const fallback = await run(request);
    expect(fallback.warnings).toHaveLength(1);
    expect(fallback.tickets[0]?.policies[0]).toMatchObject({
      name: 'Primera respuesta',
      status: 'failed',
    });
    expect(fallback.tickets[0]?.policies[1]?.targetStage).toBe('');
  });
  it('identifica errores de Odoo sin propagar cuerpos de respuesta', async () => {
    call.mockRejectedValue(
      new OdooApiError('helpdesk.team', 'search_read', 400, 'odoo-language'),
    );
    await expect(
      run({ auth: { token: { role: 'admin' } }, data: { month: '2026-09' } }),
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      details: {
        reason: 'odoo-language',
        model: 'helpdesk.team',
        httpStatus: 400,
      },
    });
  });
});
