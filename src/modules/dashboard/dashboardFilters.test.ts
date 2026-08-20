import { describe, it, expect } from 'vitest';
import { buildTrackingRows } from '@/modules/operational-tracking/trackingModel';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
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
  search: '',
  placementCampaignIds: null,
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

describe('filterDashboardRows — colocación (conjunto resuelto por occupancyModel)', () => {
  const rows = rowsOf([
    campaign({ name: 'A', id: 'a' }),
    campaign({ name: 'B', id: 'b' }),
    campaign({ name: 'C', id: 'c' }),
  ]);
  const r = range('2026-05-01', '2026-05-31');

  it('sin filtro de colocación (null) participan todas', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      placementCampaignIds: null,
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['A', 'B', 'C']);
  });

  it('restringe a los ids del conjunto de colocación resuelto', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      placementCampaignIds: new Set(['a', 'c']),
    });
    expect(out.map((x) => x.campaign.name)).toEqual(['A', 'C']);
  });

  it('un conjunto vacío deja fuera a todas las campañas', () => {
    const out = filterDashboardRows(rows, {
      ...base,
      range: r,
      placementCampaignIds: new Set<string>(),
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
