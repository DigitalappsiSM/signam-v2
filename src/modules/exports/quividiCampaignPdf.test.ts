import { describe, it, expect } from 'vitest';
import type { QuividiCampaignReport } from '@/domain';
import {
  buildQuividiCampaignPdfBlob,
  quividiCampaignPdfFileName,
} from './quividiCampaignPdf';

function report(): QuividiCampaignReport {
  const dates = ['2026-08-11', '2026-08-12', '2026-08-15', '2026-08-16'];
  const stores = [
    { storeNumber: '3', storeName: 'POLANCO' },
    { storeNumber: '7', storeName: 'SANTA FE' },
  ];
  return {
    schemaVersion: 3,
    campaignId: 'c1',
    campaignName: 'VENTA PERFUMERÍA',
    startDate: '2026-08-11',
    endDate: '2026-08-16',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
    cameraDays: [],
    supportDays: dates.flatMap((date) =>
      stores.map((store) => ({
        date,
        ...store,
        support: 'MUPI DIGITAL',
        configuredCameras: 1,
        measuredCameras: 1,
        status: 'complete' as const,
        ots: 1200,
        effectiveOts: 900,
        watchers: 190,
        attentionSeconds: 2.8,
        dwellSeconds: 22.4,
      })),
    ),
    supportHours: dates.flatMap((date) =>
      stores.flatMap((store) =>
        [9, 11, 14, 17, 20, 23].map((hour) => ({
          date,
          hour,
          ...store,
          support: 'MUPI DIGITAL',
          configuredCameras: 1,
          measuredCameras: 1,
          status: 'complete' as const,
          ots: 200,
          effectiveOts: 150,
          watchers: 30,
          attentionSeconds: 2.8,
          dwellSeconds: 22.4,
        })),
      ),
    ),
    demographics: [1, 2].flatMap((gender) =>
      [2, 3].map((age) => ({
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        gender,
        age,
        watchers: 100 * gender + age,
      })),
    ),
    incidents: [],
    unmappedCameraNames: [],
  };
}

describe('informe de audiencia en PDF', () => {
  it('nombra el archivo por campaña y vigencia, sin citar la plataforma', () => {
    const name = quividiCampaignPdfFileName(report());
    expect(name).toBe('Audiencia_VENTA PERFUMERÍA_2026-08-11_2026-08-16.pdf');
    expect(name.toLowerCase()).not.toContain('quividi');
  });

  it('sanea caracteres no válidos del nombre de campaña', () => {
    expect(
      quividiCampaignPdfFileName({
        ...report(),
        campaignName: 'VENTA/ESPECIAL: 2026',
      }),
    ).toContain('VENTA_ESPECIAL_ 2026');
  });

  it('genera el documento completo sin datos vacíos', async () => {
    const blob = await buildQuividiCampaignPdfBlob(report());
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('genera el documento aunque la campaña no tenga medición horaria', async () => {
    const blob = await buildQuividiCampaignPdfBlob({
      ...report(),
      supportHours: [],
      demographics: [],
    });
    expect(blob.size).toBeGreaterThan(1000);
  });
});
