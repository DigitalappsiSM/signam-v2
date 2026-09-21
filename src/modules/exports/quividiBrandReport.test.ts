import { describe, expect, it } from 'vitest';
import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiSupportDay,
} from '@/domain';
import {
  brandAge,
  brandCampaignSummary,
  brandCoverage,
  brandGender,
  brandSupportDays,
  periodDays,
} from './quividiBrandReport';

function supportDay(
  overrides: Partial<QuividiSupportDay> & {
    date: string;
    storeNumber: string;
    storeName: string;
  },
): QuividiSupportDay {
  return {
    support: 'MUPI DIGITAL',
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete',
    ots: 1000,
    effectiveOts: 800,
    watchers: 100,
    attentionSeconds: 3,
    dwellSeconds: 20,
    ...overrides,
  };
}

function cameraDay(
  overrides: Partial<QuividiCameraDay> & {
    date: string;
    storeNumber: string;
    storeName: string;
    locationId: number;
  },
): QuividiCameraDay {
  return {
    locationName: `CAM-${overrides.locationId}`,
    boxId: null,
    siteId: null,
    active: true,
    lastSeen: null,
    support: 'MUPI DIGITAL',
    durationSeconds: 36000,
    ots: 100,
    effectiveOts: 80,
    watchers: 10,
    attentionTenths: 30,
    dwellTenths: 200,
    status: 'complete',
    ...overrides,
  };
}

function report(
  overrides: Partial<QuividiCampaignReport> = {},
): QuividiCampaignReport {
  return {
    schemaVersion: 4,
    campaignId: 'c1',
    campaignName: 'MARCA EJEMPLO',
    startDate: '2026-09-01',
    endDate: '2026-09-14',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: { totalPairs: 0, mappedPairs: 0, percent: 0, bySupport: [] },
    storeCoverage: { totalStores: 0, mappedStores: 0, percent: 0 },
    cameraDays: [],
    supportDays: [],
    supportHours: [],
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
    ...overrides,
  };
}

describe('informe comercial agregado de audiencia', () => {
  it('mantiene la ponderación actual salvo en Insurgentes', () => {
    const date = '2026-09-01';
    const input = report({
      supportDays: [
        supportDay({
          date,
          storeNumber: '10',
          storeName: 'INSURGENTES',
          configuredCameras: 2,
          measuredCameras: 2,
          ots: 150,
        }),
        supportDay({
          date,
          storeNumber: '11',
          storeName: 'SANTA FE',
          configuredCameras: 2,
          measuredCameras: 2,
          ots: 500,
        }),
      ],
      cameraDays: [
        cameraDay({ date, storeNumber: '10', storeName: 'INSURGENTES', locationId: 1, ots: 100 }),
        cameraDay({ date, storeNumber: '10', storeName: 'INSURGENTES', locationId: 2, ots: 200 }),
        cameraDay({ date, storeNumber: '11', storeName: 'SANTA FE', locationId: 3, ots: 400 }),
        cameraDay({ date, storeNumber: '11', storeName: 'SANTA FE', locationId: 4, ots: 600 }),
      ],
    });

    const rows = brandSupportDays(input);
    expect(rows.find((row) => row.storeName === 'INSURGENTES')?.ots).toBe(300);
    expect(rows.find((row) => row.storeName === 'SANTA FE')?.ots).toBe(500);
  });

  it('calcula cobertura por tienda y extrapola las tiendas sin cámara', () => {
    const measuredStores = Array.from({ length: 15 }, (_, index) =>
      supportDay({
        date: '2026-09-01',
        storeNumber: String(index + 1),
        storeName: `TIENDA ${index + 1}`,
        ots: 1_000_000,
      }),
    );
    const input = report({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      coverage: { totalPairs: 20, mappedPairs: 15, percent: 75, bySupport: [] },
      storeCoverage: { totalStores: 20, mappedStores: 15, percent: 75 },
      supportDays: measuredStores,
    });

    const coverage = brandCoverage(input);
    const summary = brandCampaignSummary(input);

    expect(coverage).toEqual({
      totalStores: 20,
      measuredStores: 15,
      estimatedStores: 5,
      measuredPercent: 75,
      estimatedPercent: 25,
    });
    expect(summary.measuredOts).toBe(15_000_000);
    expect(summary.extrapolatedOts).toBe(5_000_000);
    expect(summary.estimatedOts).toBe(20_000_000);
    expect(summary.dailyPerStore).toBe(1_000_000);
    expect(summary.dailyPerSupport).toBe(1_000_000);
  });

  it('calcula días naturales inclusivos de la campaña', () => {
    expect(periodDays(report())).toBe(14);
  });

  it('expone segmentos solo como porcentajes agregados', () => {
    const input = report({
      demographics: [
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'CENTRO',
          support: 'MUPI DIGITAL',
          gender: 1,
          age: 2,
          watchers: 60,
        },
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'CENTRO',
          support: 'MUPI DIGITAL',
          gender: 2,
          age: 3,
          watchers: 40,
        },
      ],
    });

    const gender = brandGender(input);
    const age = brandAge(input);
    expect(gender.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(100);
    expect(age.reduce((sum, item) => sum + item.share, 0)).toBeCloseTo(100);
    expect(gender.map((item) => Object.keys(item))).toEqual([
      ['label', 'share'],
      ['label', 'share'],
    ]);
  });
});
