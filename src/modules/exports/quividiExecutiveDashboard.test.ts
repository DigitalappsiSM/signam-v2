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
import {
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
});
