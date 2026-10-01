import { describe, expect, it } from 'vitest';
import type { StoreDirectoryEntry } from '@/domain/stores';
import type {
  ControlCenterCamera,
  ControlCenterTicket,
} from '@/services/controlCenter';
import type { OccupancyCampaign, StoreOccupancy } from '../occupancyModel';
import type { AdmiraScreen } from '@/domain';
import {
  buildControlCenterModel,
  hoursSince,
  storesWithActiveSupports,
  ticketSeverity,
  worstSeverity,
} from './mapModel';

const NOW = new Date('2026-10-01T12:00:00Z');

const dir = (over: Partial<StoreDirectoryEntry>): StoreDirectoryEntry => ({
  storeNumber: '901',
  name: 'L PRUEBA NORTE',
  status: 'active',
  street: '',
  neighborhood: '',
  municipality: 'MONTERREY',
  state: 'Nuevo León',
  zone: 'Noreste',
  postalCode: '64000',
  lat: 25.67,
  lng: -100.3,
  coordinateSource: 'ekon',
  ...over,
});

const camp = (
  id: string,
  classification: OccupancyCampaign['classification'],
): OccupancyCampaign => ({
  campaignId: id,
  campaignName: id,
  campaignNameKey: id,
  classification,
  startDate: null,
  endDate: null,
});

const occ = (
  storeNumber: string,
  institutional: number,
  provider: number,
): StoreOccupancy => ({
  storeNumber,
  storeName: '',
  peakConcurrentCampaigns: 0,
  distinctCampaigns: institutional + provider,
  campaignDays: 0,
  classification: { institutional, provider, unknown: 0 },
  distinctSupports: 0,
  physicalScreens: 4,
  // Ids estables: la misma campaña en varias tiendas comparte id.
  campaigns: [
    ...Array.from({ length: institutional }, (_, i) =>
      camp(`i-${i}`, 'institutional'),
    ),
    ...Array.from({ length: provider }, (_, i) => camp(`p-${i}`, 'provider')),
  ],
});

const ticket = (over: Partial<ControlCenterTicket>): ControlCenterTicket => ({
  id: 1,
  title: 'Pantalla apagada',
  category: 'Soporte',
  storeNumber: '901',
  storeLabel: '901 - Prueba',
  stage: 'Nuevo',
  assignee: 'Soporte',
  createdAt: '2026-10-01 10:00:00',
  url: 'https://odoo/1',
  ...over,
});

const camera = (over: Partial<ControlCenterCamera>): ControlCenterCamera => ({
  locationId: 1,
  storeNumber: '901',
  storeName: 'Prueba',
  support: 'VIDEO WALL',
  status: 'normal',
  severity: 'none',
  latestDate: '2026-09-30',
  consecutiveDays: 0,
  coreOts: 1200,
  ticketId: null,
  ...over,
});

describe('modelo del Centro de Control', () => {
  const model = buildControlCenterModel({
    now: NOW,
    supportedStores: new Set(['901', '902', '903']),
    directory: [
      dir({}),
      dir({
        storeNumber: '902',
        name: 'L SIN GPS',
        lat: null,
        lng: null,
        coordinateSource: null,
      }),
      dir({ storeNumber: '903', state: 'Jalisco', status: 'inactive' }),
    ],
    occupancy: [occ('0901', 2, 5), occ('902', 1, 0), occ('77', 3, 3)],
    tickets: [
      ticket({}),
      ticket({
        id: 2,
        category: 'Contenido',
        createdAt: '2026-09-27 12:00:00',
      }),
      ticket({ id: 3, storeNumber: null }),
      ticket({ id: 4, storeNumber: '555' }),
    ],
    cameras: [
      camera({}),
      camera({
        locationId: 2,
        support: 'MUPI',
        status: 'no_ots',
        consecutiveDays: 3,
      }),
      camera({
        locationId: 3,
        storeNumber: '902',
        status: 'partial_measurement',
        coreOts: 300,
      }),
    ],
  });
  const s901 = model.stores.find((s) => s.storeNumber === '901')!;
  const s902 = model.stores.find((s) => s.storeNumber === '902')!;

  it('separa campañas institucionales y de proveedor por tienda', () => {
    expect(s901.campaigns).toEqual({
      institutional: 2,
      provider: 5,
      unknown: 0,
    });
    expect(s901.totalCampaigns).toBe(7);
    expect(s901.coord).toEqual([-100.3, 25.67]);
  });

  it('une tickets de Odoo y alertas de cámara, ordenados por severidad', () => {
    expect(s901.incidents.map((i) => i.id)).toEqual([
      'odoo-2',
      'cam-2',
      'odoo-1',
    ]);
    expect(s901.incidents.map((i) => i.severity)).toEqual([
      'critical',
      'critical',
      'medium',
    ]);
    expect(s901.cameras).toEqual({ total: 2, alerting: 1 });
  });

  it('dos cámaras del mismo soporte son incidencias distintas', () => {
    const m = buildControlCenterModel({
      now: NOW,
      supportedStores: new Set(['901']),
      directory: [dir({})],
      occupancy: [],
      tickets: null,
      cameras: [
        camera({ locationId: 11, status: 'no_ots' }),
        camera({ locationId: 12, status: 'no_ots' }),
      ],
    });
    expect(m.incidents.map((i) => i.id).sort()).toEqual(['cam-11', 'cam-12']);
  });

  it('el OTS solo suma cámaras con medición', () => {
    expect(s901.ots).toBe(1200);
    expect(s902.ots).toBe(300);
    expect(model.stores.find((s) => s.storeNumber === '903')?.ots).toBeNull();
  });

  it('no inventa ubicación: sin coordenadas no hay punto pero sí cuenta', () => {
    expect(s902.coord).toBeNull();
    expect(model.withoutCoordinates).toBe(1);
    const nl = model.states.find((s) => s.state === 'Nuevo León')!;
    // i-0 está en 901 y 902: una campaña es una campaña, no se suma por tienda.
    expect(nl).toMatchObject({
      stores: 2,
      institutional: 2,
      provider: 5,
      campaigns: 7,
      incidentTotal: 4,
      ots: 1500,
    });
    expect(nl.incidents).toEqual({
      support: 1,
      content: 1,
      camera: 2,
      other: 0,
    });
  });

  it('el total nacional cuenta campañas distintas, no tienda × campaña', () => {
    // 901 (2+5), 902 (i-0 repetida) y 77 (i-0..2, p-0..2): 3 + 5 distintas.
    expect(model.campaignTotals).toEqual({
      institutional: 3,
      provider: 5,
      unknown: 0,
      total: 8,
    });
  });

  it('reporta tiendas con datos fuera del directorio y descarta tickets sin tienda', () => {
    expect(model.unlocated).toEqual(['77', '555']);
    expect(model.incidents.some((i) => i.id === 'odoo-3')).toBe(false);
  });

  it('solo evalúa tiendas del directorio con soportes en catálogo', () => {
    const m = buildControlCenterModel({
      now: NOW,
      supportedStores: new Set(['901']),
      directory: [
        dir({}),
        dir({ storeNumber: '904', name: 'L SIN PANTALLAS' }),
      ],
      occupancy: [occ('904', 1, 0)],
      tickets: null,
      cameras: null,
    });
    expect(m.stores.map((s) => s.storeNumber)).toEqual(['901']);
    expect(m.states[0]?.stores).toBe(1);
    // Datos de una tienda sin soportes nunca se pierden en silencio.
    expect(m.unlocated).toEqual(['904']);
  });

  it('sin Odoo ni cámaras sigue armando campañas', () => {
    const m = buildControlCenterModel({
      now: NOW,
      supportedStores: new Set(['901']),
      directory: [dir({})],
      occupancy: [occ('901', 1, 1)],
      tickets: null,
      cameras: null,
    });
    expect(m.incidents).toEqual([]);
    expect(m.stores[0]?.totalCampaigns).toBe(2);
  });
});

describe('tiendas con soportes', () => {
  const screen = (store: string, active: boolean): AdmiraScreen =>
    ({
      id: `${store}-${String(active)}`,
      original: { 'Numero de Tienda': store },
      metadata: { active },
    }) as unknown as AdmiraScreen;

  it('cuenta solo pantallas activas y normaliza el número de tienda', () => {
    const set = storesWithActiveSupports([
      screen('0901', true),
      screen('901', false),
      screen('905', false),
      screen('', true),
    ]);
    expect([...set]).toEqual(['901']);
  });
});

describe('reglas de severidad', () => {
  it('antigüedad del ticket', () => {
    expect(hoursSince('2026-10-01 10:00:00', NOW)).toBe(2);
    expect(hoursSince('basura', NOW)).toBe(0);
    expect(ticketSeverity(2)).toBe('medium');
    expect(ticketSeverity(30)).toBe('high');
    expect(ticketSeverity(80)).toBe('critical');
    expect(worstSeverity([])).toBeNull();
  });
});
