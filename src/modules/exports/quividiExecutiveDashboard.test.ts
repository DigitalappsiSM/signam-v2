import { describe, expect, it } from 'vitest';
import type {
  QuividiCampaignReport,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';
import {
  brandCampaignSummary,
  brandOperationalReport,
  brandTopStores,
} from './quividiBrandReport';
import { brandGapFilledReport } from './quividiGapFill';
import { buildQuividiCampaignWorkbook } from './quividiCampaignExcel';
import {
  commercialDaily,
  commercialHeatmap,
  commercialHourlyDetail,
  commercialStores,
  executiveDashboard,
  operationalTimeBands,
} from './quividiExecutiveDashboard';
import { storeSummaries } from './quividiMarketingAnalytics';

const DATES = ['2026-10-05', '2026-10-06'];
const SUPPORT = 'MEGA MUPI DIGITAL';
const COAPA = { storeNumber: '6', storeName: 'L COAPA' };
const LINDAVISTA = { storeNumber: '83', storeName: 'L LINDAVISTA' };

function hour(
  store: typeof COAPA,
  date: string,
  at: number,
  ots: number,
): QuividiSupportHour {
  return {
    date,
    hour: at,
    ...store,
    support: SUPPORT,
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete',
    ots,
    effectiveOts: ots,
    watchers: ots / 10,
    publishedOts: ots * 2,
    publishedEffectiveOts: ots * 2,
    publishedWatchers: ots / 5,
    attentionSeconds: 2,
    dwellSeconds: 20,
    publishedFactor: 2,
  };
}

function day(hours: QuividiSupportHour[]): QuividiSupportDay {
  const first = hours[0]!;
  const total = (field: 'ots' | 'watchers') =>
    hours.reduce((sum, row) => sum + row[field], 0);
  return {
    date: first.date,
    storeNumber: first.storeNumber,
    storeName: first.storeName,
    support: SUPPORT,
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete',
    ots: total('ots'),
    effectiveOts: total('ots'),
    watchers: total('watchers'),
    publishedOts: total('ots') * 2,
    publishedEffectiveOts: total('ots') * 2,
    publishedWatchers: total('watchers') * 2,
    attentionSeconds: 2,
    dwellSeconds: 20,
  };
}

/**
 * Coapa mide más en el día completo, pero casi todo fuera de 10:00–22:00
 * (00:00–06:00); Lindavista mide más dentro de la franja. Es el caso real en
 * que el Excel y el PDF ordenaban distinto el Top de tiendas.
 */
function report(): QuividiCampaignReport {
  const hours = DATES.flatMap((date) => {
    const window = Array.from({ length: 12 }, (_, index) => index + 10);
    const coapa = [
      ...Array.from({ length: 6 }, (_, at) => hour(COAPA, date, at, 100)),
      ...window.map((at) => hour(COAPA, date, at, 10)),
    ];
    const lindavista = window.map((at) => hour(LINDAVISTA, date, at, 20));
    return [coapa, lindavista];
  });
  return {
    schemaVersion: 10,
    campaignId: 'c1',
    campaignName: 'CAMPAÑA',
    startDate: DATES[0]!,
    endDate: DATES[1]!,
    generatedAt: Date.parse('2026-10-08T18:00:00Z'),
    scopeOrigins: [],
    coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
    storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
    cameraDays: [],
    supportDays: hours.map(day),
    supportHours: hours.flat(),
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
  };
}

describe('Dashboard Ejecutivo del Excel', () => {
  it('ordena el Top de tiendas como el PDF, con la franja 10:00–22:00', () => {
    const source = report();
    // El dato medido de día completo pone primero a Coapa…
    expect(storeSummaries(source)[0]?.storeName).toBe('L COAPA');

    const dashboard = executiveDashboard(source);
    // …la cifra publicada, a Lindavista: 12 h × 20 × 2 × 2 días.
    expect(dashboard.topStores.map((store) => store.storeName)).toEqual([
      'L LINDAVISTA',
      'L COAPA',
    ]);
    expect(dashboard.topStores[0]?.ots).toBe(960);
    expect(dashboard.topStores[1]?.ots).toBe(480);
  });

  it('publica exactamente las cifras del PDF', () => {
    const source = report();
    const operational = brandGapFilledReport(brandOperationalReport(source));
    const dashboard = executiveDashboard(source);

    expect(dashboard.ots).toBe(brandCampaignSummary(operational).estimatedOts);
    expect(dashboard.topStores).toEqual(
      brandTopStores(operational, 5).stores.map((store) => ({
        storeNumber: store.storeNumber,
        storeName: store.storeName,
        ots: store.adjustedOts,
        share: (store.adjustedOts / dashboard.ots) * 100,
        estimated: false,
      })),
    );
  });

  it('reparte el total por soporte, día y franja sin perder OTS', () => {
    const dashboard = executiveDashboard(report());
    const total = (values: number[]) => values.reduce((a, b) => a + b, 0);

    expect(total(dashboard.supports.map((item) => item.ots))).toBeCloseTo(
      dashboard.ots,
    );
    expect(total(dashboard.weekdays.map((item) => item.ots))).toBeCloseTo(
      dashboard.ots,
    );
    expect(total(dashboard.timeBands.map((item) => item.share))).toBeCloseTo(
      100,
    );
    expect(dashboard.peakHours).toHaveLength(3);
  });

  it('recorta las franjas del día a la franja operativa', () => {
    const bands = operationalTimeBands(
      Array.from({ length: 12 }, (_, index) => ({
        hour: index + 10,
        share: 100 / 12,
      })),
    );
    expect(bands.map((band) => band.range)).toEqual([
      '10:00–12:00',
      '12:00–16:00',
      '16:00–20:00',
      '20:00–22:00',
    ]);
  });

  it('marca la tienda con OTS estimados y los separa en «Tiendas»', () => {
    const source = report();
    // Lindavista deja de reportar 14:00–21:00 el segundo día.
    const lost = (row: QuividiSupportHour) =>
      row.storeNumber === LINDAVISTA.storeNumber &&
      row.date === DATES[1] &&
      row.hour >= 14;
    source.supportHours = source.supportHours.filter((row) => !lost(row));
    source.supportDays = source.supportDays.map((row) =>
      row.storeNumber === LINDAVISTA.storeNumber && row.date === DATES[1]
        ? { ...row, status: 'partial', ots: 80, publishedOts: 160 }
        : row,
    );

    const dashboard = executiveDashboard(source);
    const lindavista = dashboard.topStores.find(
      (store) => store.storeNumber === LINDAVISTA.storeNumber,
    );
    const coapa = dashboard.topStores.find(
      (store) => store.storeNumber === COAPA.storeNumber,
    );
    expect(lindavista?.estimated).toBe(true);
    expect(coapa?.estimated).toBe(false);

    const stores = commercialStores(source);
    const row = stores.rows.find(
      (item) => item.storeNumber === LINDAVISTA.storeNumber,
    );
    expect(row?.estimatedOts).toBeGreaterThan(0);
    expect((row?.measuredOts ?? 0) + (row?.estimatedOts ?? 0)).toBeCloseTo(
      row?.ots ?? 0,
    );
    expect(
      commercialHourlyDetail(source).some((item) => item.origin === 'Relleno'),
    ).toBe(true);
  });

  it('las hojas «Tiendas», «Evolución Diaria» y «Días y Horarios» suman la portada', () => {
    const source = report();
    const ots = executiveDashboard(source).ots;
    const total = (values: number[]) => values.reduce((a, b) => a + b, 0);

    const stores = commercialStores(source);
    expect(stores.totalOts).toBe(ots);
    expect(
      total(stores.rows.map((row) => row.ots)) + stores.restOts,
    ).toBeCloseTo(ots);
    expect(stores.rows[0]?.storeName).toBe('L LINDAVISTA');
    expect(stores.rows[0]?.bestHour).toBeGreaterThanOrEqual(10);

    const daily = commercialDaily(source);
    expect(total(daily.map((row) => row.ots))).toBeCloseTo(ots);
    expect(total(daily.map((row) => row.estimatedOts))).toBe(0);

    const heatmap = commercialHeatmap(source);
    expect(heatmap.hours[0]).toBe(10);
    expect(heatmap.hours[heatmap.hours.length - 1]).toBe(21);
    expect(total(heatmap.cells.map((cell) => cell.ots))).toBeCloseTo(ots);
    expect(total(heatmap.timeBands.map((band) => band.ots))).toBeCloseTo(ots);
  });

  it('«Detalle Horario» sólo lista la franja con la cifra publicada', () => {
    const rows = commercialHourlyDetail(report());
    expect(rows.every((row) => row.hour >= 10 && row.hour < 22)).toBe(true);
    expect(rows[0]?.publishedOts).toBe((rows[0]?.rawOts ?? 0) * 2);
  });

  it('el Excel escribe el Top 5 del dashboard en el orden del PDF', async () => {
    const wb = await buildQuividiCampaignWorkbook(report());
    const sheet = wb.getWorksheet('Dashboard Ejecutivo');
    expect(sheet?.getCell(12, 7).value).toBe('83 · L LINDAVISTA');
    expect(sheet?.getCell(12, 9).value).toBe(960);
    const stores = wb.getWorksheet('Tiendas');
    expect(stores?.getCell(5, 2).value).toBe('L LINDAVISTA');
  });
});
