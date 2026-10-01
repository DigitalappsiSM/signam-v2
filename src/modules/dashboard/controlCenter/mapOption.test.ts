import { describe, expect, it } from 'vitest';
import { MEXICAN_STATES } from '@/domain/stores';
import geo from './mexico-states.json';
import { controlPalette } from './palette';
import { buildMapOption, stateValue, type MapView } from './mapOption';
import type { ControlCenterModel, MapStore } from './mapModel';

const store = (over: Partial<MapStore>): MapStore => ({
  storeNumber: '901',
  name: 'L <PRUEBA>',
  state: 'Nuevo León',
  zone: 'Noreste',
  municipality: 'MONTERREY',
  coord: [-100.3, 25.67],
  active: true,
  campaigns: { institutional: 2, provider: 5, unknown: 0 },
  totalCampaigns: 7,
  screens: 4,
  incidents: [],
  cameras: { total: 1, alerting: 0 },
  ots: 1200,
  ...over,
});

const MODEL: ControlCenterModel = {
  stores: [
    store({}),
    store({ storeNumber: '902', coord: null }),
    store({
      storeNumber: '903',
      campaigns: { institutional: 0, provider: 0, unknown: 0 },
      totalCampaigns: 0,
      incidents: [
        {
          id: 'odoo-1',
          kind: 'support',
          source: 'odoo',
          storeNumber: '903',
          title: 'Pantalla apagada',
          detail: '',
          ageHours: 90,
          severity: 'critical',
          url: null,
          ticketId: 1,
          stage: 'Nuevo',
          assignee: '',
        },
      ],
    }),
  ],
  states: [
    {
      state: 'Nuevo León',
      stores: 3,
      institutional: 4,
      provider: 10,
      campaigns: 14,
      incidents: { support: 1, content: 0, camera: 0, other: 0 },
      incidentTotal: 1,
      ots: 3600,
    },
  ],
  incidents: [],
  unlocated: [],
  withoutCoordinates: 1,
};

const VIEW: MapView = {
  layer: 'campaigns',
  campaignFilter: 'all',
  incidentFilter: 'all',
  focusStore: null,
};

type SeriesLike = { name?: string; id?: string; data?: unknown[] };
const series = (view: MapView) =>
  buildMapOption(MODEL, view, controlPalette('dark'), {
    center: [0, 0],
    zoom: 1,
  }).series as SeriesLike[];

describe('mapa del Centro de Control', () => {
  it('el GeoJSON trae exactamente los 32 estados canónicos', () => {
    const names = (
      geo as { features: { properties: { name: string } }[] }
    ).features.map((f) => f.properties.name);
    expect([...names].sort()).toEqual([...MEXICAN_STATES].sort());
  });

  it('capa campañas: burbujas de marcas y Liverpool, sin tiendas sin GPS', () => {
    const s = series(VIEW);
    expect(s.find((x) => x.name === 'Marcas')?.data).toHaveLength(1);
    expect(s.find((x) => x.name === 'Liverpool')?.data).toHaveLength(1);
    expect(s.find((x) => x.name === 'Sin campañas')?.data).toHaveLength(1);
    const onlyBrand = series({ ...VIEW, campaignFilter: 'brand' });
    expect(onlyBrand.some((x) => x.name === 'Liverpool')).toBe(false);
  });

  it('capa incidencias: resalta la crítica y el foco del navegador', () => {
    const s = series({ ...VIEW, layer: 'incidents', focusStore: '903' });
    expect(s.find((x) => x.name === 'Incidencias')?.data).toHaveLength(2);
    expect(s.find((x) => x.id === 'focus')?.data).toHaveLength(1);
  });

  it('el coroplético usa la métrica de la capa y su filtro', () => {
    expect(stateValue(MODEL, VIEW).get('Nuevo León')).toBe(14);
    expect(
      stateValue(MODEL, { ...VIEW, campaignFilter: 'liverpool' }).get(
        'Nuevo León',
      ),
    ).toBe(4);
    expect(
      stateValue(MODEL, {
        ...VIEW,
        layer: 'incidents',
        incidentFilter: 'content',
      }).get('Nuevo León'),
    ).toBe(0);
    expect(
      stateValue(MODEL, { ...VIEW, layer: 'audience' }).get('Nuevo León'),
    ).toBe(3600);
  });

  it('escapa los nombres de tienda en el tooltip', () => {
    const option = buildMapOption(MODEL, VIEW, controlPalette('light'), {
      center: [0, 0],
      zoom: 1,
    }) as { tooltip: { formatter: (p: unknown) => string } };
    const html = option.tooltip.formatter({
      name: 'L <PRUEBA>',
      data: { storeNumber: '901' },
    });
    expect(html).toContain('L &lt;PRUEBA&gt;');
    expect(html).not.toContain('<PRUEBA>');
  });
});
