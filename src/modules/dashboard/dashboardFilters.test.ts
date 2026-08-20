import { describe, it, expect } from 'vitest';
import { buildTrackingRows } from '@/modules/operational-tracking/trackingModel';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import { filterDashboardRows } from './dashboardFilters';
import type { DateRange } from './occupancyModel';

function campaign(over: Partial<StoredCampaign>): StoredCampaign {
  return {
    id: over.id ?? over.name ?? 'id',
    row: 1,
    name: over.name ?? 'CAMPAÑA',
    nameKey: over.nameKey ?? (over.name ?? 'campaña').toLowerCase(),
    signature: 'sig',
    tipo: over.tipo ?? '',
    vendidoPor: 'Liverpool',
    fechaInicio: over.fechaInicio ?? '2026-05-01',
    fechaFin: over.fechaFin ?? '2026-05-20',
    mes: 'Mayo',
    link: over.link ?? '',
    supports: over.supports ?? [],
    ...over,
  };
}

function support(o: {
  support?: string;
  owner?: CampaignSupport['owner'];
  stores?: { numero: string; nombre?: string }[];
}): CampaignSupport {
  return {
    support: o.support ?? 'PANTALLA',
    owner: o.owner ?? 'liverpool',
    stores: (o.stores ?? []).map((s) => ({
      numero: s.numero,
      nombre: s.nombre ?? '',
    })),
  };
}

function range(startIso: string, endIso: string): DateRange {
  const [ys, ms, ds] = startIso.split('-').map(Number);
  const [ye, me, de] = endIso.split('-').map(Number);
  return {
    start: new Date(Date.UTC(ys!, ms! - 1, ds!)),
    end: new Date(Date.UTC(ye!, me! - 1, de!)),
  };
}

const TODAY = new Date(Date.UTC(2026, 4, 10));

function rowsOf(campaigns: StoredCampaign[]) {
  return buildTrackingRows(campaigns, [], [], TODAY);
}

const base = {
  classification: 'all' as const,
  owner: 'all' as const,
  support: null,
  store: null,
  search: '',
};

describe('filterDashboardRows — periodo', () => {
  const rows = rowsOf([
    campaign({
      name: 'HISTORICA',
      fechaInicio: '2020-01-01',
      fechaFin: '2020-01-20',
    }),
    campaign({
      name: 'VIGENTE',
      fechaInicio: '2026-05-01',
      fechaFin: '2026-05-20',
    }),
  ]);

  it('excluye la campaña histórica cuando el periodo no intersecta su vigencia', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: range('2026-05-10', '2026-05-10'),
    });
    expect(out.map((r) => r.campaign.name)).toEqual(['VIGENTE']);
  });

  it('incluye la histórica cuando el periodo intersecta su vigencia', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: range('2020-01-01', '2020-12-31'),
    });
    expect(out.map((r) => r.campaign.name)).toEqual(['HISTORICA']);
  });

  it('intersección inclusiva en los límites del periodo', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: range('2026-05-20', '2026-05-25'),
    });
    expect(out.map((r) => r.campaign.name)).toEqual(['VIGENTE']);
  });
});

describe('filterDashboardRows — clasificación', () => {
  const rows = rowsOf([
    campaign({ name: 'INST', tipo: 'INSTITUCIONAL' }),
    campaign({ name: 'PROV', tipo: 'PROVEEDOR' }),
    campaign({ name: 'PEND', tipo: '' }),
  ]);
  const r = range('2026-05-01', '2026-05-31');

  it('filtra solo institucional', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      classification: 'institutional',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['INST']);
  });

  it('filtra solo proveedor', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      classification: 'provider',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['PROV']);
  });

  it('filtra pendientes (unknown)', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      classification: 'unknown',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['PEND']);
  });
});

describe('filterDashboardRows — propietario / soporte / tienda', () => {
  const rows = rowsOf([
    campaign({
      name: 'LIV',
      supports: [support({ support: 'PANTALLA', stores: [{ numero: '5' }] })],
    }),
    campaign({
      name: 'ISM',
      supports: [
        support({
          support: "MUPPI'S",
          owner: 'instore-media',
          stores: [{ numero: '6' }],
        }),
      ],
    }),
  ]);
  const r = range('2026-05-01', '2026-05-31');

  it('propietario elimina campañas sin colocación del propietario', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      owner: 'instore-media',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['ISM']);
  });

  it('soporte compara con la clave normalizada', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      support: 'PANTALLA',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['LIV']);
  });

  it('tienda compara el número normalizado', () => {
    const out = filterDashboardRows(rows, { ...base, range: r, store: '6' });
    expect(out.map((x) => x.campaign.name)).toEqual(['ISM']);
  });
});

describe('filterDashboardRows — filtros combinados exigen una sola colocación', () => {
  // CRIUS en tienda 5 y PANTALLA en tienda 6: ninguna colocación cumple
  // simultáneamente soporte CRIUS + tienda 6.
  const rows = rowsOf([
    campaign({
      name: 'MIXTA',
      supports: [
        support({ support: 'VIDEO WALL CRIUS', stores: [{ numero: '5' }] }),
        support({ support: 'PANTALLA', stores: [{ numero: '6' }] }),
      ],
    }),
  ]);
  const r = range('2026-05-01', '2026-05-31');

  it('participa si soporte y tienda coinciden en la misma colocación', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      support: 'VIDEO WALL CRIUS',
      store: '5',
    });
    expect(out).toHaveLength(1);
  });

  it('queda fuera si soporte y tienda coinciden en colocaciones distintas', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      support: 'VIDEO WALL CRIUS',
      store: '6',
    });
    expect(out).toHaveLength(0);
  });
});

describe('filterDashboardRows — búsqueda', () => {
  const rows = rowsOf([
    campaign({ name: 'BUEN FIN' }),
    campaign({ name: 'NAVIDAD' }),
  ]);
  const r = range('2026-05-01', '2026-05-31');

  it('coincide sin distinguir acentos ni mayúsculas', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      search: 'buen',
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['BUEN FIN']);
  });

  it('sin coincidencias devuelve vacío', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      search: 'zzz',
    });
    expect(out).toHaveLength(0);
  });
});
