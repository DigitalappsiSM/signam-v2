import { describe, it, expect } from 'vitest';
import type { QuividiCampaignReport } from '@/domain';
import {
  buildBrandCampaignMetrics,
  buildBrandDailyEstimated,
  buildQuividiCampaignPdfBlob,
  commercialSupportDayOts,
  quividiCampaignPdfFileName,
} from './quividiCampaignPdf';

function baseReport(
  overrides: Partial<QuividiCampaignReport> = {},
): QuividiCampaignReport {
  return {
    schemaVersion: 3,
    campaignId: 'c1',
    campaignName: 'VENTA PERFUMERÍA',
    startDate: '2026-08-11',
    endDate: '2026-08-12',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: {
      totalPairs: 2,
      mappedPairs: 2,
      percent: 100,
      bySupport: [
        {
          support: 'MUPI DIGITAL',
          totalPairs: 2,
          mappedPairs: 2,
          percent: 100,
        },
      ],
    },
    cameraDays: [],
    supportDays: [
      {
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        configuredCameras: 1,
        measuredCameras: 1,
        status: 'complete',
        ots: 1200,
        effectiveOts: 900,
        watchers: 190,
        attentionSeconds: 2.8,
        dwellSeconds: 22.4,
      },
      {
        date: '2026-08-11',
        storeNumber: '7',
        storeName: 'SANTA FE',
        support: 'MUPI DIGITAL',
        configuredCameras: 1,
        measuredCameras: 1,
        status: 'complete',
        ots: 800,
        effectiveOts: 620,
        watchers: 130,
        attentionSeconds: 2.6,
        dwellSeconds: 20.1,
      },
      {
        date: '2026-08-12',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        configuredCameras: 1,
        measuredCameras: 1,
        status: 'complete',
        ots: 1300,
        effectiveOts: 970,
        watchers: 200,
        attentionSeconds: 2.9,
        dwellSeconds: 22.9,
      },
      {
        date: '2026-08-12',
        storeNumber: '7',
        storeName: 'SANTA FE',
        support: 'MUPI DIGITAL',
        configuredCameras: 1,
        measuredCameras: 1,
        status: 'complete',
        ots: 700,
        effectiveOts: 540,
        watchers: 120,
        attentionSeconds: 2.5,
        dwellSeconds: 19.8,
      },
    ],
    supportHours: [],
    demographics: [
      {
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        gender: 1,
        age: 2,
        watchers: 120,
      },
      {
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        gender: 2,
        age: 3,
        watchers: 180,
      },
    ],
    incidents: [],
    unmappedCameraNames: [],
    ...overrides,
  };
}

describe('informe comercial de audiencia en PDF', () => {
  it('nombra el archivo por campaña y vigencia, sin citar plataformas internas', () => {
    const report = baseReport();
    const name = quividiCampaignPdfFileName(report);
    expect(name).toBe('Audiencia_VENTA PERFUMERÍA_2026-08-11_2026-08-12.pdf');
    expect(name.toLowerCase()).not.toContain('quividi');
    expect(name.toLowerCase()).not.toContain('signam');
  });

  it('sanea caracteres no válidos del nombre de campaña', () => {
    expect(
      quividiCampaignPdfFileName(
        baseReport({ campaignName: 'VENTA/ESPECIAL: 2026' }),
      ),
    ).toContain('VENTA_ESPECIAL_ 2026');
  });

  it('extrapola tiendas sin cobertura con el promedio observado en el mismo periodo', () => {
    const stores = Array.from({ length: 15 }, (_, index) => String(index + 1));
    const supportDays = stores.map((storeNumber) => ({
      date: '2026-08-11',
      storeNumber,
      storeName: `TIENDA ${storeNumber}`,
      support: 'MUPI DIGITAL',
      configuredCameras: 1,
      measuredCameras: 1,
      status: 'complete' as const,
      ots: 1_000_000,
      effectiveOts: 800_000,
      watchers: 100_000,
      attentionSeconds: 2,
      dwellSeconds: 20,
    }));

    const report = baseReport({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      supportDays,
      coverage: {
        totalPairs: 20,
        mappedPairs: 15,
        percent: 75,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 20,
            mappedPairs: 15,
            percent: 75,
          },
        ],
      },
    });

    const metrics = buildBrandCampaignMetrics(report);
    expect(metrics.actualOts).toBe(15_000_000);
    expect(metrics.extrapolatedOts).toBe(5_000_000);
    expect(metrics.estimatedOts).toBe(20_000_000);
    expect(metrics.measuredStores).toBe(15);
    expect(metrics.totalStores).toBe(20);
    expect(metrics.coveragePercent).toBe(75);
    expect(metrics.dailyPerStore).toBe(1_000_000);
  });

  it('mantiene la ponderación existente salvo Insurgentes, donde suma zonas independientes', () => {
    const insurgentesDay = {
      date: '2026-08-11',
      storeNumber: '19',
      storeName: 'LIVERPOOL INSURGENTES',
      support: 'MUPI DIGITAL',
      configuredCameras: 2,
      measuredCameras: 2,
      status: 'complete' as const,
      ots: 500,
      effectiveOts: 400,
      watchers: 100,
      attentionSeconds: 2,
      dwellSeconds: 20,
    };

    const report = baseReport({
      supportDays: [insurgentesDay],
      cameraDays: [
        {
          date: '2026-08-11',
          storeNumber: '19',
          storeName: 'LIVERPOOL INSURGENTES',
          support: 'MUPI DIGITAL',
          locationId: 101,
          locationName: 'INSURGENTES PB',
          boxId: null,
          siteId: null,
          active: true,
          lastSeen: null,
          durationSeconds: 43_200,
          ots: 600,
          effectiveOts: 480,
          watchers: 80,
          attentionTenths: 20,
          dwellTenths: 200,
          status: 'complete',
        },
        {
          date: '2026-08-11',
          storeNumber: '19',
          storeName: 'LIVERPOOL INSURGENTES',
          support: 'MUPI DIGITAL',
          locationId: 102,
          locationName: 'INSURGENTES P1',
          boxId: null,
          siteId: null,
          active: true,
          lastSeen: null,
          durationSeconds: 43_200,
          ots: 400,
          effectiveOts: 320,
          watchers: 60,
          attentionTenths: 20,
          dwellTenths: 200,
          status: 'complete',
        },
      ],
      coverage: {
        totalPairs: 1,
        mappedPairs: 1,
        percent: 100,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 1,
            mappedPairs: 1,
            percent: 100,
          },
        ],
      },
    });

    expect(commercialSupportDayOts(report, insurgentesDay)).toBe(1000);

    const regular = {
      ...insurgentesDay,
      storeNumber: '3',
      storeName: 'POLANCO',
      ots: 500,
    };
    expect(commercialSupportDayOts(report, regular)).toBe(500);
  });

  it('extrapola la evolución diaria sin revelar resultados por tienda', () => {
    const report = baseReport({
      coverage: {
        totalPairs: 4,
        mappedPairs: 2,
        percent: 50,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 4,
            mappedPairs: 2,
            percent: 50,
          },
        ],
      },
    });
    const daily = buildBrandDailyEstimated(report);
    expect(daily).toHaveLength(2);
    expect(daily[0]?.ots).toBe(4000);
    expect(daily[1]?.ots).toBe(4000);
  });

  it('genera las cinco páginas aunque no haya datos horarios o demográficos', async () => {
    const blob = await buildQuividiCampaignPdfBlob(
      baseReport({ supportHours: [], demographics: [] }),
    );
    expect(blob.size).toBeGreaterThan(1000);
  });
});
