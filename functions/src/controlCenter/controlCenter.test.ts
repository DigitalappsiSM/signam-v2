import { beforeEach, describe, expect, it, vi } from 'vitest';
const call = vi.hoisted(() => vi.fn());
const health = vi.hoisted(() => vi.fn());
vi.mock('../quividi/odooTickets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../quividi/odooTickets')>()),
  odooCall: call,
}));
vi.mock('../quividi/healthOverview', () => ({
  buildCameraHealthOverview: health,
}));
vi.mock('../quividi', () => ({
  CAMERA_HEALTH_ALERT_COLLECTION: 'alerts',
  CAMERA_HEALTH_ALERT_STATE_COLLECTION: 'state',
}));
const collections = vi.hoisted(
  () => new Map<string, { id: string; data: () => unknown }[]>(),
);
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: (name: string) => ({
      get: async () => ({ docs: collections.get(name) ?? [] }),
    }),
  }),
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
import { overview, resetControlCenterCache } from './index';
import { isOpenStage, storeFromTicket } from './snapshot';
import type { ControlCenterSnapshot } from './snapshot';

const run = overview as unknown as (request: {
  auth?: { token: { role?: string } };
}) => Promise<ControlCenterSnapshot>;

function odooFixture() {
  call.mockImplementation(async (_key, model) => {
    if (model === 'helpdesk.team') return [{ id: 6, name: 'Liverpool' }];
    if (model === 'helpdesk.tag')
      return [
        { id: 1, name: '[Soporte]' },
        { id: 2, name: '[CAMARAS]' },
      ];
    if (model === 'helpdesk.ticket')
      return [
        {
          id: 10,
          name: 'Pantalla apagada',
          team_id: [6, 'Liverpool'],
          partner_id: [50, 'Liverpool, 078 - Guadalajara'],
          stage_id: [1, 'En progreso'],
          tag_ids: [1],
          description: '<p>Solicitante: Persona X</p>',
          create_date: '2026-09-29 10:00:00',
          active: true,
        },
        {
          id: 11,
          name: 'Cámara sin OTS',
          team_id: [6, 'Liverpool'],
          partner_id: [9, 'Persona'],
          stage_id: [2, 'Resuelto'],
          tag_ids: [2],
          description: '',
          create_date: '2026-09-28 10:00:00',
          active: true,
        },
        {
          id: 12,
          name: 'Ticket archivado que conserva etapa abierta',
          team_id: [6, 'Liverpool'],
          partner_id: [51, 'Liverpool, 901 - Monterrey'],
          stage_id: [1, 'En progreso'],
          tag_ids: [1],
          description: '',
          create_date: '2026-09-27 10:00:00',
          active: false,
        },
      ];
    return [];
  });
}

beforeEach(() => {
  collections.clear();
  collections.set('screens', [
    {
      id: 's1',
      data: () => ({
        original: { 'Numero de Tienda': '78', 'Nombre de tienda': 'Gdl' },
        metadata: {
          active: true,
          calendarSupport: 'VIDEO WALL CRIUS',
          quividiLocationId: 5001,
          measurementPointId: 'LIV-78-CRIUS-P1',
        },
      }),
    },
  ]);
  collections.set('quividiCameraTicketState', [
    {
      id: 'LIV-78-CRIUS-P1',
      data: () => ({ ticketId: 18777, ticketStatus: 'created' }),
    },
  ]);
  call.mockReset();
  health.mockReset();
  resetControlCenterCache();
  health.mockResolvedValue({
    latestDate: '2026-09-29',
    cameras: [
      {
        monitored: true,
        locationId: 5001,
        storeNumber: '078',
        storeName: 'Guadalajara',
        support: 'VIDEO WALL CRIUS',
        currentStatus: 'no_ots',
        severity: 'critical',
        latestDate: '2026-09-29',
        consecutiveDays: 2,
        coreOts: 0,
        ticketId: null,
      },
      { monitored: false, storeNumber: '1' },
    ],
  });
});

describe('Centro de Control (callable)', () => {
  it('exige sesión y no consulta nada sin ella', async () => {
    await expect(run({})).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(call).not.toHaveBeenCalled();
  });

  it('el rol comercial lee tickets abiertos y cámaras, sin datos personales', async () => {
    odooFixture();
    const result = await run({ auth: { token: { role: 'commercial' } } });
    expect(result.tickets).toHaveLength(1);
    expect(result.tickets?.[0]).toEqual({
      id: 10,
      title: 'Pantalla apagada',
      category: 'Soporte',
      storeNumber: '78',
      storeLabel: '078 - Guadalajara',
      stage: 'En progreso',
      assignee: 'Sin asignar',
      createdAt: '2026-09-29 10:00:00',
      url: 'https://in-storemedia.odoo.com/odoo/helpdesk/6/tickets/10',
    });
    expect(JSON.stringify(result)).not.toContain('Persona X');
    expect(result.cameras).toEqual([
      expect.objectContaining({
        locationId: 5001,
        storeNumber: '78',
        status: 'no_ots',
        ticketId: 18777,
      }),
    ]);
    expect(
      call.mock.calls.every(([, , method]) => method === 'search_read'),
    ).toBe(true);
    const ticketCall = call.mock.calls.find(
      ([, model]) => model === 'helpdesk.ticket',
    );
    expect(ticketCall?.[3]).toMatchObject({
      context: { active_test: true },
      domain: expect.arrayContaining([['active', '=', true]]),
      fields: expect.arrayContaining(['active']),
    });
    expect(result.tickets?.some((ticket) => ticket.id === 12)).toBe(false);
  });

  it('si Odoo falla, devuelve cámaras y un aviso en lugar de romper', async () => {
    call.mockRejectedValue(new Error('down'));
    const result = await run({ auth: { token: { role: 'viewer' } } });
    expect(result.tickets).toBeNull();
    expect(result.cameras).toHaveLength(1);
    expect(result.warnings[0]).toContain('Odoo');
  });

  it('cachea una lectura completa', async () => {
    odooFixture();
    await run({ auth: { token: { role: 'admin' } } });
    const calls = call.mock.calls.length;
    await run({ auth: { token: { role: 'admin' } } });
    expect(call.mock.calls.length).toBe(calls);
  });
});

describe('proyección de tickets', () => {
  it('distingue etapas abiertas de cerradas o canceladas', () => {
    expect(isOpenStage('Nuevo')).toBe(true);
    expect(isOpenStage('En espera de tienda')).toBe(true);
    expect(isOpenStage('Resuelto')).toBe(false);
    expect(isOpenStage('Cancelado')).toBe(false);
    // La API JSON-2 devuelve la etapa en inglés aunque Odoo muestre «Cancelada».
    expect(isOpenStage('Canceled')).toBe(false);
    expect(isOpenStage('Solved')).toBe(false);
  });

  it('lee la tienda de la descripción o del contacto de sucursal', () => {
    expect(storeFromTicket('Tienda: 199 - Toreo', '').storeNumber).toBe('199');
    expect(storeFromTicket('', 'Liverpool, 005 - Perisur').storeNumber).toBe(
      '5',
    );
    expect(storeFromTicket('', 'Persona')).toEqual({
      storeNumber: null,
      storeLabel: null,
    });
  });
});
