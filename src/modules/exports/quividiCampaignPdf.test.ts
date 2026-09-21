import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { QuividiCampaignReport, QuividiSupportDay } from '@/domain';
import {
  buildQuividiCampaignPdfBlob,
  quividiCampaignPdfFileName,
} from './quividiCampaignPdf';
import {
  brandCampaignSummary,
  brandGenderAge,
  formatCount,
  formatPercent,
} from './quividiBrandReport';

function report(): QuividiCampaignReport {
  const dates = ['2026-08-11', '2026-08-12', '2026-08-15', '2026-08-16'];
  const stores = [
    { storeNumber: '3', storeName: 'POLANCO' },
    { storeNumber: '7', storeName: 'SANTA FE' },
  ];
  return {
    schemaVersion: 4,
    campaignId: 'c1',
    campaignName: 'VENTA PERFUMERÍA',
    startDate: '2026-08-11',
    endDate: '2026-08-16',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
    storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
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
    supportHours: [],
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
    expect(name.toLowerCase()).not.toContain('signam');
  });

  it('sanea caracteres no válidos del nombre de campaña', () => {
    expect(
      quividiCampaignPdfFileName({
        ...report(),
        campaignName: 'VENTA/ESPECIAL: 2026',
      }),
    ).toContain('VENTA_ESPECIAL_ 2026');
  });

  it('genera el documento comercial completo', async () => {
    const blob = await buildQuividiCampaignPdfBlob(report());
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('genera el documento aunque no existan datos demográficos', async () => {
    const blob = await buildQuividiCampaignPdfBlob({
      ...report(),
      demographics: [],
    });
    expect(blob.size).toBeGreaterThan(1000);
  });
});

/**
 * Comprobaciones de renderizado.
 *
 * Los tests anteriores sólo verifican que el blob exista. Estos recorren el
 * flujo completo con fotografías reales del repositorio y revisan el PDF
 * resultante: jsPDF escribe `NaN` en el flujo de contenido cuando una
 * coordenada sale de una división entre cero, y el archivo se corrompe sin que
 * nada falle en tiempo de ejecución.
 */
describe('renderizado del informe', () => {
  const DAYS = 60;
  const dates = Array.from({ length: DAYS }, (_, index) =>
    new Date(Date.UTC(2026, 5, 1) + index * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );

  function longCampaign(): QuividiCampaignReport {
    const supportDays: QuividiSupportDay[] = [];
    for (let store = 0; store < 22; store += 1) {
      const supports =
        store < 6 ? ['MUPI DIGITAL', 'VIDEO WALL'] : ['MUPI DIGITAL'];
      for (const support of supports) {
        dates.forEach((date, day) => {
          const down = (store * 7 + day) % 11 < 4;
          supportDays.push({
            date,
            storeNumber: String(store + 1),
            storeName: `TIENDA ${store + 1}`,
            support,
            configuredCameras: 1,
            measuredCameras: down ? 0 : 1,
            status: down
              ? ('missing' as const)
              : day % 9 === 0
                ? ('partial' as const)
                : ('complete' as const),
            ots: down ? 0 : 30_000 + ((store * 13 + day * 7) % 22_000),
            effectiveOts: down ? 0 : 20_000,
            watchers: down ? 0 : 5_000,
            attentionSeconds: 2.8,
            dwellSeconds: 22.4,
          });
        });
      }
    }
    const supportHours = Array.from({ length: 24 }, (_, hour) => ({
      date: dates[0] ?? '',
      hour,
      storeNumber: '1',
      storeName: 'TIENDA 1',
      support: 'MUPI DIGITAL',
      configuredCameras: 1,
      measuredCameras: 1,
      status: 'complete' as const,
      ots:
        hour >= 12 && hour < 18
          ? 4_500
          : hour >= 18
            ? 2_800
            : hour >= 6
              ? 2_700
              : 60,
      effectiveOts: 0,
      watchers: 0,
      attentionSeconds: 0,
      dwellSeconds: 0,
    }));

    return {
      ...report(),
      campaignName: 'VENTA PERFUMERÍA 2026',
      startDate: dates[0] ?? '',
      endDate: dates[DAYS - 1] ?? '',
      coverage: { totalPairs: 30, mappedPairs: 28, percent: 93, bySupport: [] },
      storeCoverage: { totalStores: 24, mappedStores: 22, percent: 91.7 },
      supportDays,
      supportHours,
      demographics: [1, 2].flatMap((gender) =>
        [1, 2, 3, 4, 0].map((age) => ({
          date: dates[0] ?? '',
          storeNumber: '1',
          storeName: 'TIENDA 1',
          support: 'MUPI DIGITAL',
          gender,
          age,
          watchers: gender === 2 ? 540 + age * 90 : 460 + age * 70,
        })),
      ),
    };
  }

  /** Sirve las fotografías del repositorio en lugar de la red. */
  function serveRepoAssets(): void {
    const files: Record<string, Buffer> = {};
    for (const name of [
      'instore-media-color.png',
      'liverpool-mupi-cover.jpg',
      'liverpool-banner-closing.jpg',
    ]) {
      files[`/report-assets/${name}`] = readFileSync(
        `public/report-assets/${name}`,
      );
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const file = files[String(input)];
      if (!file) return { ok: false } as Response;
      return {
        ok: true,
        blob: async () =>
          new Blob([new Uint8Array(file)], { type: 'image/jpeg' }),
      } as unknown as Response;
    }) as typeof fetch;
  }

  async function bytesOf(blob: Blob): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('no se pudo leer el PDF'));
      reader.onload = () => resolve(Buffer.from(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
  }

  it('dibuja las cinco páginas sin coordenadas corruptas', async () => {
    serveRepoAssets();
    const raw = (
      await bytesOf(await buildQuividiCampaignPdfBlob(longCampaign()))
    ).toString('latin1');

    expect(raw).not.toContain('NaN');
    expect(raw).not.toContain('undefined');
    expect((raw.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(5);
  });

  it('publica en portada la cifra de campaña y la completitud de medición', async () => {
    serveRepoAssets();
    const input = longCampaign();
    const summary = brandCampaignSummary(input);
    const raw = (
      await bytesOf(await buildQuividiCampaignPdfBlob(input))
    ).toString('latin1');

    expect(raw).toContain(formatCount(summary.estimatedOts));
    expect(raw).toContain(formatPercent(summary.coverage.storeDayPercent, 1));
    // La portada no delata la estimación; eso se explica en el cuerpo.
    expect(raw).toContain('OPORTUNIDADES');
    expect(raw).toContain('OTS ESTIMADOS');
    // Nunca se nombra la plataforma de medición.
    expect(raw.toLowerCase()).not.toContain('quividi');
  });

  it('cruza género y edad en la pirámide de audiencia', async () => {
    serveRepoAssets();
    const input = longCampaign();
    const rows = brandGenderAge(input);
    const raw = (
      await bytesOf(await buildQuividiCampaignPdfBlob(input))
    ).toString('latin1');

    expect(rows.length).toBeGreaterThan(0);
    expect(raw).toContain('MUJERES');
    expect(raw).toContain('HOMBRES');
    // Cada rango aparece con su peso por género, no sólo el total de edad.
    for (const row of rows.slice(0, 3)) {
      expect(raw).toContain(formatPercent(row.female, 0));
      expect(raw).toContain(formatPercent(row.male, 0));
    }
  });

  it('no se rompe sin fotografías, sin demografía ni sin detalle horario', async () => {
    globalThis.fetch = (async () =>
      ({ ok: false }) as Response) as typeof fetch;
    const bare: QuividiCampaignReport = {
      ...longCampaign(),
      demographics: [],
      supportHours: [],
    };
    const raw = (
      await bytesOf(await buildQuividiCampaignPdfBlob(bare))
    ).toString('latin1');

    expect(raw).not.toContain('NaN');
    expect((raw.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(5);
    // El bloque horario se omite en lugar de dibujar ceros.
    expect(raw).toContain('no incluye detalle horario');
  });

  it('no se rompe con una campaña sin ninguna medición', async () => {
    globalThis.fetch = (async () =>
      ({ ok: false }) as Response) as typeof fetch;
    const empty: QuividiCampaignReport = {
      ...report(),
      supportDays: [],
      demographics: [],
      supportHours: [],
      coverage: { totalPairs: 0, mappedPairs: 0, percent: 0, bySupport: [] },
      storeCoverage: { totalStores: 0, mappedStores: 0, percent: 0 },
    };
    const raw = (
      await bytesOf(await buildQuividiCampaignPdfBlob(empty))
    ).toString('latin1');

    expect(raw).not.toContain('NaN');
    expect((raw.match(/\/Type \/Page[^s]/g) ?? []).length).toBe(5);
  });
});
