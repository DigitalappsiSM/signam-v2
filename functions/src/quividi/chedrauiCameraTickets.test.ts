import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '../../tests/firestore';
import {
  chedrauiLastSeenMs,
  reconcileChedrauiCameraTickets,
} from './chedrauiCameraTickets';

const hour = 3_600_000;
const start = Date.parse('2026-11-20T12:00:00Z');
const camera = {
  boxId: 'BOX-A',
  player: 'Tienda A',
  camera: 1,
  locationId: 42,
  inNetwork: true,
  lastSeen: new Date(start).toISOString(),
};

afterEach(() => vi.unstubAllGlobals());

describe('tickets Chedraui OUT', () => {
  it('espera cuatro horas y mantiene un solo ticket hasta la recuperación', async () => {
    const created: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      const payload = JSON.parse(String(options.body));
      if (url.endsWith('/helpdesk.team/search_read')) {
        expect(payload.domain).toEqual([['name', '=', 'Chedraui']]);
        return Response.json([{ id: 27, name: 'Chedraui' }]);
      }
      if (url.endsWith('/helpdesk.ticket/search_read')) {
        expect(payload.domain[0]).toEqual(['team_id', '=', 27]);
        return Response.json([]);
      }
      expect(url).toMatch(/helpdesk\.ticket\/create$/);
      created.push(payload.vals_list[0]);
      return Response.json([created.length]);
    });
    const db = fakeFirestore() as unknown as Firestore;
    vi.stubGlobal('fetch', fetchMock);
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [camera],
      start + 4 * hour - 1,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [camera],
      start + 4 * hour,
    );
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [camera],
      start + 5 * hour,
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: '[Camaras] Soporte: Mupi Digital',
      team_id: 27,
    });
    expect(created[0]?.description).toContain('Location ID 42');
    const recovered = {
      ...camera,
      lastSeen: new Date(start + 6 * hour).toISOString(),
    };
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [recovered],
      start + 6 * hour,
    );
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [recovered],
      start + 10 * hour,
    );
    expect(created).toHaveLength(2);
  });

  it('da margen a ambas zonas horarias si Quividi omite el desfase', () => {
    expect(chedrauiLastSeenMs('2026-11-20T12:00:00', start + 4 * hour)).toBe(
      start + 6 * hour,
    );
    expect(chedrauiLastSeenMs('2026-11-20T12:00:00Z', start + 4 * hour)).toBe(
      start,
    );
    expect(chedrauiLastSeenMs(null, start)).toBeNull();
  });

  it('abre tras observar cuatro horas sin cambios cuando la señal no indica zona horaria', async () => {
    const db = fakeFirestore() as unknown as Firestore;
    const read = { ...camera, lastSeen: '2026-11-20T12:00:00' };
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/helpdesk.team/')
        ? Response.json([{ id: 27, name: 'Chedraui' }])
        : url.endsWith('/create')
          ? Response.json([91])
          : Response.json([]),
    );
    vi.stubGlobal('fetch', fetchMock);
    await reconcileChedrauiCameraTickets(db, 'synthetic', [read], start);
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [read],
      start + 4 * hour - 1,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await reconcileChedrauiCameraTickets(
      db,
      'synthetic',
      [read],
      start + 4 * hour,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('adopta un folio que Odoo ya creó aunque la respuesta anterior se perdiera', async () => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requests.push(url);
      return url.includes('/helpdesk.team/')
        ? Response.json([{ id: 27, name: 'Chedraui' }])
        : Response.json([{ id: 91 }]);
    });
    const db = fakeFirestore();
    await reconcileChedrauiCameraTickets(
      db as unknown as Firestore,
      'synthetic',
      [camera],
      start + 4 * hour,
    );
    expect(requests).toHaveLength(2);
    expect(
      db.documents.get('quividiChedrauiCameraTicketState/42')?.ticketId,
    ).toBe(91);
  });
});
