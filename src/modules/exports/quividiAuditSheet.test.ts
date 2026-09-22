import { describe, expect, it } from 'vitest';
import type { QuividiCampaignReport, QuividiSupportDay } from '@/domain';
import { buildQuividiCampaignWorkbook } from './quividiCampaignExcel';
import { brandCampaignSummary } from './quividiBrandReport';

const DATES = Array.from(
  { length: 10 },
  (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
);

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

/**
 * Universo de 3 pares durante 10 días (30 par-día). Dos tiendas con cámara,
 * una de ellas caída a partir del cuarto día, y un tercer par contratado sin
 * cámara instalada.
 */
function report(): QuividiCampaignReport {
  const rows = DATES.flatMap((date, index) => [
    supportDay({ date, storeNumber: '1', storeName: 'POLANCO', ots: 1000 }),
    supportDay({
      date,
      storeNumber: '2',
      storeName: 'SANTA FE',
      ...(index < 3
        ? { ots: 1000 }
        : { status: 'missing' as const, measuredCameras: 0, ots: 0 }),
    }),
  ]);
  return {
    schemaVersion: 4,
    campaignId: 'c1',
    campaignName: 'VENTA PERFUMERÍA',
    startDate: DATES[0] ?? '',
    endDate: DATES[DATES.length - 1] ?? '',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: { totalPairs: 3, mappedPairs: 2, percent: 66.7, bySupport: [] },
    storeCoverage: { totalStores: 3, mappedStores: 2, percent: 66.7 },
    cameraDays: [],
    supportDays: rows,
    supportHours: [],
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
  };
}

async function auditValues(
  input: QuividiCampaignReport,
): Promise<Map<string, number | string>> {
  const wb = await buildQuividiCampaignWorkbook(input);
  const sheet = wb.getWorksheet('Auditoría de cifras');
  if (!sheet) throw new Error('falta la hoja de auditoría');
  const values = new Map<string, number | string>();
  sheet.eachRow((row) => {
    const label = row.getCell(1).value;
    const value = row.getCell(2).value;
    if (
      typeof label === 'string' &&
      (typeof value === 'number' || typeof value === 'string')
    ) {
      values.set(label, value);
    }
  });
  return values;
}

describe('hoja de auditoría del informe comercial', () => {
  it('se añade al libro con el resto de hojas', async () => {
    const wb = await buildQuividiCampaignWorkbook(report());
    const names = wb.worksheets.map((sheet) => sheet.name);
    expect(names).toContain('Auditoría de cifras');
    // Convive con las hojas que ya existían, no las sustituye.
    expect(names).toContain('Calidad medición');
    expect(names).toContain('Metodología');
  });

  it('publica la rejilla del circuito medible y su reparto exhaustivo', async () => {
    const values = await auditValues(report());
    expect(values.get('Días de vigencia')).toBe(10);
    expect(values.get('Soportes contratados')).toBe(3);
    expect(values.get('Soportes de formatos con medición')).toBe(3);
    expect(values.get('Par-día del circuito medible')).toBe(30);

    const complete = Number(values.get('Par-día con medición completa'));
    const partial = Number(values.get('Par-día con medición parcial'));
    const missing = Number(values.get('Par-día sin dato (cámara instalada)'));
    const uncovered = Number(values.get('Par-día sin cámara instalada'));
    expect(complete).toBe(13);
    expect(partial).toBe(0);
    expect(missing).toBe(7);
    expect(uncovered).toBe(10);
    // El reparto cubre la rejilla completa sin solapes ni huecos.
    expect(complete + partial + missing + uncovered).toBe(30);
    expect(values.get('Par-día medidos')).toBe(13);
  });

  it('reconstruye la cifra publicada sin recalcularla', async () => {
    const input = report();
    const values = await auditValues(input);
    const summary = brandCampaignSummary(input);

    expect(values.get('OTS medidos')).toBe(summary.measuredOts);
    expect(values.get('= OTS estimados de campaña')).toBe(summary.estimatedOts);
    expect(values.get('De los cuales, extrapolados')).toBe(
      summary.extrapolatedOts,
    );
    expect(
      Number(values.get('OTS medidos')) +
        Number(values.get('De los cuales, extrapolados')),
    ).toBeCloseTo(summary.estimatedOts, 6);
  });

  it('desglosa el circuito por formato, medibles y no medibles', async () => {
    const mixed: QuividiCampaignReport = {
      ...report(),
      coverage: {
        totalPairs: 5,
        mappedPairs: 2,
        percent: 40,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 3,
            mappedPairs: 2,
            percent: 66.7,
          },
          { support: 'CRIUS', totalPairs: 2, mappedPairs: 0, percent: 0 },
        ],
      },
    };
    const wb = await buildQuividiCampaignWorkbook(mixed);
    const sheet = wb.getWorksheet('Auditoría de cifras');
    if (!sheet) throw new Error('falta la hoja de auditoría');

    const labels: string[] = [];
    sheet.eachRow((row) => {
      const first = row.getCell(1).value;
      if (typeof first === 'string') labels.push(first);
    });
    // El formato sin medición aparece en el desglose, nunca en la cadena.
    expect(labels).toContain('CRIUS');
    expect(labels).toContain('MUPI DIGITAL');

    const values = await auditValues(mixed);
    expect(values.get('Soportes contratados')).toBe(5);
    expect(values.get('Soportes de formatos con medición')).toBe(3);
    expect(values.get('Soportes de formatos sin medición')).toBe(2);
  });

  it('separa la cobertura de despliegue de la completitud real', async () => {
    const values = await auditValues(report());
    // 2 de 3 tiendas llegaron a medir algo.
    expect(Number(values.get('Cobertura por tienda (despliegue)'))).toBeCloseTo(
      66.67,
      1,
    );
    // 13 de 30 tienda-día midieron: la vigencia larga degrada la completitud.
    expect(
      Number(values.get('Cobertura por tienda-día (completitud)')),
    ).toBeCloseTo(43.33, 1);
  });

  it('no rompe cuando la campaña no tiene ninguna medición', async () => {
    const empty: QuividiCampaignReport = {
      ...report(),
      supportDays: [],
      coverage: { totalPairs: 0, mappedPairs: 0, percent: 0, bySupport: [] },
      storeCoverage: { totalStores: 0, mappedStores: 0, percent: 0 },
    };
    const values = await auditValues(empty);
    expect(values.get('OTS medidos')).toBe(0);
    expect(values.get('= OTS estimados de campaña')).toBe(0);
  });
});
