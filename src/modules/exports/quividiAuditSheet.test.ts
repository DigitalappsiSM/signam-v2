import { describe, expect, it } from 'vitest';
import type { QuividiCampaignReport, QuividiSupportDay } from '@/domain';
import { buildQuividiCampaignWorkbook } from './quividiCampaignExcel';
import {
  brandCampaignSummary,
  brandExtrapolationByReason,
  brandSingleCameraDuplication,
  brandStoreAttribution,
} from './quividiBrandReport';

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
  const base = {
    support: 'MUPI DIGITAL',
    // 2 cámaras por default: no es "de una sola cámara" (eso se prueba en
    // quividiBrandReport.test.ts), así que no se duplica.
    configuredCameras: 2,
    measuredCameras: 1,
    status: 'complete' as const,
    ots: 1000,
    effectiveOts: 800,
    watchers: 100,
    attentionSeconds: 3,
    dwellSeconds: 20,
    ...overrides,
  };
  const singleCamera = base.configuredCameras === 1;
  return {
    publishedOts: singleCamera ? base.ots * 2 : base.ots,
    publishedEffectiveOts: singleCamera
      ? base.effectiveOts * 2
      : base.effectiveOts,
    publishedWatchers: singleCamera ? base.watchers * 2 : base.watchers,
    ...base,
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
    generatedAt:
      Date.parse(`${DATES[DATES.length - 1]}T12:00:00Z`) + 86_400_000,
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

  it('separa el día incompleto: sólo medido y marcado en las hojas por fecha', async () => {
    const base = report();
    const lastDate = DATES[DATES.length - 1] ?? '';
    const input: QuividiCampaignReport = {
      ...base,
      schemaVersion: 6,
      endDate: '2026-12-31',
      measuredEndDate: lastDate,
      partialDate: lastDate,
      partialUntil: '15:07',
    };
    const values = await auditValues(input);
    const summary = brandCampaignSummary(input);
    expect(summary.partialOts).toBeGreaterThan(0);
    expect(values.get('— de ellos, día incompleto')).toBe(summary.partialOts);
    expect(values.get('= OTS estimados de campaña')).toBe(summary.estimatedOts);

    const wb = await buildQuividiCampaignWorkbook(input);
    const detail = wb.getWorksheet('Detalle Soportes');
    if (!detail) throw new Error('falta Detalle Soportes');
    const rationales: string[] = [];
    detail.eachRow((row, index) => {
      if (index <= 3) return;
      if (String(row.getCell(1).value) === lastDate) {
        rationales.push(String(row.getCell(20).value ?? ''));
      }
    });
    expect(rationales.length).toBeGreaterThan(0);
    for (const text of rationales) {
      expect(text).toContain('Día incompleto, medido hasta 15:07');
    }
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

  it('separa los OTS extrapolados por motivo del hueco, y concilia con el total', async () => {
    const input = report();
    const values = await auditValues(input);
    const byReason = brandExtrapolationByReason(input);

    expect(values.get('— por días sin dato (cámara instalada)')).toBe(
      byReason.missingOts,
    );
    expect(values.get('— por soportes sin cámara instalada')).toBe(
      byReason.uncoveredOts,
    );
    expect(
      Number(values.get('— por días sin dato (cámara instalada)')) +
        Number(values.get('— por soportes sin cámara instalada')),
    ).toBeCloseTo(Number(values.get('De los cuales, extrapolados')), 6);
  });

  it('hace visible que la clasificación de portada y la técnica no son el mismo porcentaje', async () => {
    const input = report();
    const values = await auditValues(input);
    const attribution = brandStoreAttribution(input);

    expect(
      Number(
        values.get('Informativa (por tienda): OTS de tiendas con medición'),
      ),
    ).toBeCloseTo(attribution.measuredStoresSharePercent, 6);
    expect(
      Number(
        values.get('Informativa (por tienda): OTS de tiendas sin medición'),
      ),
    ).toBeCloseTo(attribution.unmeasuredStoresSharePercent, 6);

    const technicalMeasured = Number(
      values.get('Técnica (por par-día): OTS medidos'),
    );
    const informativeMeasured = Number(
      values.get('Informativa (por tienda): OTS de tiendas con medición'),
    );
    // Con la tienda 2 (Santa Fe) parcialmente caída, la clasificación por
    // tienda y la clasificación por par-día deben divergir: la tabla existe
    // justamente para que esa diferencia sea visible.
    expect(technicalMeasured).not.toBeCloseTo(informativeMeasured, 0);
  });

  it('publica OTS ajustados por tienda y reconstruye el total desde ahí', async () => {
    const input = report();
    const values = await auditValues(input);
    const attribution = brandStoreAttribution(input);
    const summary = brandCampaignSummary(input);

    expect(
      values.get('OTS ajustados de tiendas con medición (suma de la tabla)'),
    ).toBe(attribution.measuredStoresOts);
    expect(values.get('+ OTS de tiendas sin medición (residuo)')).toBe(
      attribution.unmeasuredStoresOts,
    );
    expect(
      values.get('= OTS estimados de campaña (reconstruido por tienda)'),
    ).toBeCloseTo(summary.estimatedOts, 6);
  });

  it('desglosa la construcción por formato con las columnas de motivo del hueco', async () => {
    const wb = await buildQuividiCampaignWorkbook(report());
    const sheet = wb.getWorksheet('Auditoría de cifras');
    if (!sheet) throw new Error('falta la hoja de auditoría');

    let headerRow: number | null = null;
    sheet.eachRow((row, rowNumber) => {
      if (row.getCell(1).value === 'Formato' && headerRow === null) {
        headerRow = rowNumber;
      }
    });
    expect(headerRow).not.toBeNull();
    if (headerRow === null) return;
    const headers = [1, 2, 3, 4, 5, 6, 7].map(
      (col) => sheet.getRow(headerRow!).getCell(col).value,
    );
    expect(headers).toContain('Extrapolados: sin dato');
    expect(headers).toContain('Extrapolados: sin cámara');
  });

  it('publica la sección de duplicación por cámara única, reconciliada con el total', async () => {
    const withSingleCamera: QuividiCampaignReport = {
      ...report(),
      supportDays: [
        ...report().supportDays,
        supportDay({
          date: DATES[0]!,
          storeNumber: '3',
          storeName: 'COAPA',
          configuredCameras: 1,
          ots: 2000,
        }),
      ],
      coverage: { totalPairs: 4, mappedPairs: 3, percent: 75, bySupport: [] },
      storeCoverage: { totalStores: 4, mappedStores: 3, percent: 75 },
    };
    const values = await auditValues(withSingleCamera);
    const duplication = brandSingleCameraDuplication(withSingleCamera);
    const summary = brandCampaignSummary(withSingleCamera);

    expect(duplication.pairs).toBe(1);
    expect(duplication.measuredOts).toBe(2000);
    expect(duplication.publishedOts).toBe(4000);
    expect(duplication.addedOts).toBe(2000);

    expect(values.get('Pares duplicados (circuito medible)')).toBe(
      duplication.pairs,
    );
    expect(values.get('OTS medidos en esos pares, sin duplicar')).toBe(
      duplication.measuredOts,
    );
    expect(values.get('+ OTS añadidos por duplicación')).toBe(
      duplication.addedOts,
    );
    expect(
      values.get('= OTS publicados de esos pares (ya incluidos arriba)'),
    ).toBe(duplication.publishedOts);

    // El total de portada (sección 3) ya incluye la duplicación: no se suma
    // de nuevo, sólo se hace explícito cuánto de ese total es el ajuste.
    expect(values.get('OTS medidos')).toBe(summary.measuredOts);
    // 10 días de POLANCO (1000 c/u) + 3 días de SANTA FE (1000 c/u) + 2000
    // reales de COAPA, todo sin duplicar.
    expect(summary.measuredOts - duplication.addedOts).toBe(15_000);
  });

  it('no publica nada en la sección de duplicación si no hay pares de 1 sola cámara', async () => {
    const values = await auditValues(report());
    expect(values.get('Pares duplicados (circuito medible)')).toBe(0);
    expect(values.get('+ OTS añadidos por duplicación')).toBe(0);
  });
});
