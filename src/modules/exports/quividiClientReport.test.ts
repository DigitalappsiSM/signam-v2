import { describe, expect, it } from 'vitest';
import type { QuividiCampaignReport } from '@/domain';
import {
  ageAudienceShares,
  campaignAudienceSummary,
  dailyEstimatedOts,
  genderAudienceShares,
} from './quividiClientReport';

function report(): QuividiCampaignReport {
  const supportDays = Array.from({ length: 15 }, (_, index) => ({
    date: '2026-05-01',
    storeNumber: String(index + 1),
    storeName: `TIENDA ${index + 1}`,
    support: 'MUPI DIGITAL',
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete' as const,
    ots: 1_000_000,
    effectiveOts: 800_000,
    watchers: 0,
    attentionSeconds: 0,
    dwellSeconds: 0,
  }));

  return {
    schemaVersion: 3,
    campaignId: 'campaign-1',
    campaignName: 'CAMPAÑA EJEMPLO',
    startDate: '2026-05-01',
    endDate: '2026-05-01',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: {
      totalPairs: 20,
      mappedPairs: 15,
      percent: 75,
      totalStores: 20,
      mappedStores: 15,
      storePercent: 75,
      bySupport: [
        {
          support: 'MUPI DIGITAL',
          totalPairs: 20,
          mappedPairs: 15,
          percent: 75,
        },
      ],
    },
    cameraDays: [],
    supportDays,
    supportHours: [],
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
  };
}

describe('modelo comercial agregado de audiencia', () => {
  it('extrapola las tiendas sin cobertura usando el promedio de las medidas', () => {
    const summary = campaignAudienceSummary(report());

    expect(summary.realOts).toBe(15_000_000);
    expect(summary.extrapolatedOts).toBe(5_000_000);
    expect(summary.estimatedOts).toBe(20_000_000);
    expect(summary.measuredStores).toBe(15);
    expect(summary.totalStores).toBe(20);
    expect(summary.estimatedStores).toBe(5);
    expect(summary.coveragePercent).toBe(75);
  });

  it('calcula promedios diarios por campaña, tienda y soporte', () => {
    const summary = campaignAudienceSummary(report());

    expect(summary.averageDailyOts).toBe(20_000_000);
    expect(summary.averageDailyPerStore).toBe(1_000_000);
    expect(summary.averageDailyPerSupport).toBe(1_000_000);
  });

  it('aplica la misma extrapolación a la serie diaria agregada', () => {
    expect(dailyEstimatedOts(report())).toEqual([
      { date: '2026-05-01', ots: 20_000_000 },
    ]);
  });

  it('expone segmentación demográfica solo como porcentajes', () => {
    const base = report();
    base.demographics = [
      {
        date: '2026-05-01',
        storeNumber: '1',
        storeName: 'TIENDA 1',
        support: 'MUPI DIGITAL',
        gender: 1,
        age: 2,
        watchers: 300,
      },
      {
        date: '2026-05-01',
        storeNumber: '1',
        storeName: 'TIENDA 1',
        support: 'MUPI DIGITAL',
        gender: 2,
        age: 3,
        watchers: 200,
      },
      {
        date: '2026-05-01',
        storeNumber: '1',
        storeName: 'TIENDA 1',
        support: 'MUPI DIGITAL',
        gender: 0,
        age: 0,
        watchers: 900,
      },
    ];

    expect(genderAudienceShares(base)).toEqual([
      { label: 'Masculino', share: 60 },
      { label: 'Femenino', share: 40 },
    ]);
    expect(ageAudienceShares(base)).toEqual([
      { label: 'Adulto joven (16–30)', share: 60 },
      { label: 'Adulto (31–65)', share: 40 },
    ]);
  });
});
