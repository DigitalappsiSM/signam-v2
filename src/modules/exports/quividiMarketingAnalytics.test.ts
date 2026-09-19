import { describe, expect, it } from 'vitest';
import type { QuividiCampaignReport } from '@/domain';
import {
  hourRange,
  overallSummary,
  peakMoments,
  storeSummaries,
  timeBandSummaries,
  weekdaySummaries,
} from './quividiMarketingAnalytics';

function report(): QuividiCampaignReport {
  return {
    schemaVersion: 3,
    campaignId: 'c1',
    campaignName: 'CAMPAÑA',
    startDate: '2026-09-18',
    endDate: '2026-09-19',
    generatedAt: 1,
    scopeOrigins: [],
    coverage: { totalPairs: 1, mappedPairs: 1, percent: 100, bySupport: [] },
    cameraDays: [],
    supportDays: [
      {
        date: '2026-09-18',
        storeNumber: '7',
        storeName: 'L SANTA FE',
        support: 'MEGA MUPI DIGITAL',
        configuredCameras: 2,
        measuredCameras: 2,
        status: 'complete',
        ots: 100,
        effectiveOts: 80,
        watchers: 25,
        attentionSeconds: 3,
        dwellSeconds: 8,
      },
      {
        date: '2026-09-19',
        storeNumber: '7',
        storeName: 'L SANTA FE',
        support: 'MEGA MUPI DIGITAL',
        configuredCameras: 2,
        measuredCameras: 1,
        status: 'partial',
        ots: 200,
        effectiveOts: 160,
        watchers: 50,
        attentionSeconds: 5,
        dwellSeconds: 10,
      },
    ],
    supportHours: [
      {
        date: '2026-09-18',
        hour: 17,
        storeNumber: '7',
        storeName: 'L SANTA FE',
        support: 'MEGA MUPI DIGITAL',
        configuredCameras: 2,
        measuredCameras: 2,
        status: 'complete',
        ots: 90,
        effectiveOts: 70,
        watchers: 20,
        attentionSeconds: 3,
        dwellSeconds: 8,
      },
      {
        date: '2026-09-19',
        hour: 18,
        storeNumber: '7',
        storeName: 'L SANTA FE',
        support: 'MEGA MUPI DIGITAL',
        configuredCameras: 2,
        measuredCameras: 1,
        status: 'partial',
        ots: 180,
        effectiveOts: 145,
        watchers: 45,
        attentionSeconds: 5,
        dwellSeconds: 10,
      },
    ],
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
  };
}

describe('quividiMarketingAnalytics', () => {
  it('calcula KPIs generales sin convertir contactos en reach único', () => {
    const summary = overallSummary(report());
    expect(summary.ots).toBe(300);
    expect(summary.watchers).toBe(75);
    expect(summary.attentionRate).toBe(25);
    expect(summary.measurementPercent).toBe(100);
    expect(summary.storeCount).toBe(1);
  });

  it('resume tienda y detecta su franja horaria con mayor OTS', () => {
    const [store] = storeSummaries(report());
    expect(store?.storeNumber).toBe('7');
    expect(store?.bestHour).toBe(18);
    expect(store?.bestWeekday).toBe('Sáb');
    expect(store?.measurementPercent).toBe(100);
  });

  it('ordena momentos de oportunidad por OTS horario', () => {
    const peaks = peakMoments(report(), 2);
    expect(peaks).toHaveLength(2);
    expect(peaks[0]?.hour).toBe(18);
    expect(peaks[0]?.ots).toBe(180);
  });

  it('agrupa franjas y días de semana con el dato horario', () => {
    const bands = timeBandSummaries(report());
    const afternoon = bands.find((band) => band.key === 'afternoon');
    expect(afternoon?.ots).toBe(270);
    expect(afternoon?.share).toBe(100);

    const weekdays = weekdaySummaries(report());
    expect(weekdays.find((day) => day.label === 'Vie')?.ots).toBe(90);
    expect(weekdays.find((day) => day.label === 'Sáb')?.ots).toBe(180);
  });

  it('formatea la franja de una hora', () => {
    expect(hourRange(17)).toBe('17:00–18:00');
    expect(hourRange(null)).toBe('—');
  });
});
