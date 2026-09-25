import { describe, expect, it } from 'vitest';
import {
  cameraTicketSubject,
  createOrReuseCameraTicket,
  type OdooCall,
} from './odooTickets';

describe('Odoo camera tickets', () => {
  it('usa el Punto SIGNAM como referencia estable del asunto', () => {
    expect(cameraTicketSubject('LIV-199-CRIUS-P1')).toBe(
      '[CAMARAS][LIV-199-CRIUS-P1] Incidencia Quividi',
    );
  });

  it('reutiliza un ticket abierto del mismo punto', async () => {
    const call: OdooCall = async (model, method) => {
      if (model === 'helpdesk.ticket' && method === 'search_read') {
        return [{ id: 500, stage_id: [10, 'En progreso'] }];
      }
      if (model === 'helpdesk.stage' && method === 'search_read') {
        return [{ id: 10, fold: false }];
      }
      throw new Error(`Unexpected ${model}.${method}`);
    };
    const result = await createOrReuseCameraTicket(call, {
      measurementPointId: 'LIV-199-CRIUS-P1',
      alertId: '201__2026-09-24',
      locationId: 201,
      locationName: 'TOREO-1',
      storeNumber: '199',
      storeName: 'L TOREO',
      support: 'VIDEO WALL CRIUS',
      healthStatus: 'no_ots',
      latestDate: '2026-09-24',
      coreMeasuredHours: 11,
      expectedCoreHours: 11,
      coreOts: 0,
      dispatchMode: 'automatic',
    });
    expect(result).toMatchObject({ ticketId: 500, reused: true });
  });

  it('crea ticket cuando no existe uno abierto', async () => {
    const calls: string[] = [];
    const call: OdooCall = async (model, method) => {
      calls.push(`${model}.${method}`);
      if (model === 'helpdesk.ticket' && method === 'search_read') return [];
      if (model === 'res.partner' && method === 'search_read') {
        return [{ id: 433, name: '199 - L TOREO', parent_id: [80, 'Liverpool'] }];
      }
      if (model === 'helpdesk.tag' && method === 'search_read') {
        return [{ id: 70, name: 'camaras' }];
      }
      if (model === 'helpdesk.ticket' && method === 'create') return [501];
      throw new Error(`Unexpected ${model}.${method}`);
    };
    const result = await createOrReuseCameraTicket(call, {
      measurementPointId: 'LIV-199-CRIUS-P1',
      alertId: '201__2026-09-24',
      locationId: 201,
      locationName: 'TOREO-1',
      storeNumber: '199',
      storeName: 'L TOREO',
      support: 'VIDEO WALL CRIUS',
      healthStatus: 'no_ots',
      latestDate: '2026-09-24',
      coreMeasuredHours: 11,
      expectedCoreHours: 11,
      coreOts: 0,
      dispatchMode: 'automatic',
    });
    expect(result).toMatchObject({ ticketId: 501, reused: false });
    expect(calls).toContain('helpdesk.ticket.create');
  });
});
