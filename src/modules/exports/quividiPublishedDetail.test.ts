import { describe, expect, it } from 'vitest';
import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiDemographicRow,
  QuividiSupportDay,
} from '@/domain';
import {
  brandCampaignSummary,
  brandDemographics,
  brandGender,
} from './quividiBrandReport';
import {
  cameraRuleRationale,
  publishedDemographicDetail,
  publishedSupportDetail,
} from './quividiPublishedDetail';

const DATES = ['2026-09-29', '2026-09-30'];

function supportDay(
  over: Partial<QuividiSupportDay> & {
    date: string;
    storeNumber: string;
  },
): QuividiSupportDay {
  const base = {
    storeName: `TIENDA ${over.storeNumber}`,
    support: 'MEGA MUPI DIGITAL',
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete' as const,
    ots: 1000,
    effectiveOts: 500,
    watchers: 100,
    attentionSeconds: 2,
    dwellSeconds: 30,
    zoneSplit: false,
    ...over,
  };
  return {
    publishedOts: base.ots * 2,
    publishedEffectiveOts: base.effectiveOts * 2,
    publishedWatchers: base.watchers * 2,
    ...base,
  };
}

function camera(
  over: Partial<QuividiCameraDay> & {
    date: string;
    storeNumber: string;
    locationId: number;
  },
): QuividiCameraDay {
  return {
    locationName: `CAM-${over.locationId}`,
    boxId: null,
    siteId: null,
    active: true,
    lastSeen: null,
    storeName: `TIENDA ${over.storeNumber}`,
    support: 'MEGA MUPI DIGITAL',
    durationSeconds: 36_000,
    ots: 1000,
    effectiveOts: 500,
    watchers: 100,
    attentionTenths: 20,
    dwellTenths: 300,
    status: 'complete',
    ...over,
  };
}

function demo(
  over: Partial<QuividiDemographicRow> & {
    date: string;
    storeNumber: string;
    gender: number;
    watchers: number;
  },
): QuividiDemographicRow {
  return {
    storeName: `TIENDA ${over.storeNumber}`,
    support: 'MEGA MUPI DIGITAL',
    age: 3,
    publishedWatchers: over.watchers * 2,
    ...over,
  };
}

/**
 * Escenario del ejemplo acordado: tienda 1 con 1 cámara, tienda 2 con 2
 * cámaras (tipo Coapa) que el día 30 no reporta, y un tercer soporte del
 * universo sin cámara.
 */
function scenario(): QuividiCampaignReport {
  return {
    schemaVersion: 7,
    campaignId: 'c1',
    campaignName: 'TOKI',
    startDate: DATES[0]!,
    endDate: DATES[1]!,
    generatedAt: Date.parse('2026-10-01T18:00:00Z'),
    measuredEndDate: DATES[1]!,
    partialDate: null,
    partialUntil: null,
    scopeOrigins: [],
    coverage: {
      totalPairs: 3,
      mappedPairs: 2,
      percent: 66.7,
      bySupport: [
        {
          support: 'MEGA MUPI DIGITAL',
          totalPairs: 3,
          mappedPairs: 2,
          percent: 66.7,
        },
      ],
    },
    storeCoverage: { totalStores: 3, mappedStores: 2, percent: 66.7 },
    cameraDays: [
      ...DATES.map((date) => camera({ date, storeNumber: '1', locationId: 1 })),
      camera({ date: DATES[0]!, storeNumber: '2', locationId: 2, ots: 3000 }),
      camera({ date: DATES[0]!, storeNumber: '2', locationId: 3, ots: 1200 }),
      camera({
        date: DATES[1]!,
        storeNumber: '2',
        locationId: 2,
        ots: 0,
        status: 'missing',
      }),
      camera({
        date: DATES[1]!,
        storeNumber: '2',
        locationId: 3,
        ots: 0,
        status: 'missing',
      }),
    ],
    supportDays: [
      ...DATES.map((date) => supportDay({ date, storeNumber: '1' })),
      supportDay({
        date: DATES[0]!,
        storeNumber: '2',
        configuredCameras: 2,
        measuredCameras: 2,
        ots: 3000,
        watchers: 300,
      }),
      supportDay({
        date: DATES[1]!,
        storeNumber: '2',
        configuredCameras: 2,
        measuredCameras: 0,
        status: 'missing',
        ots: 0,
        effectiveOts: 0,
        watchers: 0,
      }),
    ],
    supportHours: [],
    demographics: [
      ...DATES.flatMap((date) => [
        demo({ date, storeNumber: '1', gender: 2, watchers: 60 }),
        demo({ date, storeNumber: '1', gender: 1, watchers: 40 }),
      ]),
      demo({
        date: DATES[0]!,
        storeNumber: '2',
        gender: 2,
        watchers: 150,
        cameraWatchers: [
          { locationId: 2, watchers: 150 },
          { locationId: 3, watchers: 50 },
        ],
      }),
      demo({
        date: DATES[0]!,
        storeNumber: '2',
        gender: 1,
        watchers: 150,
        cameraWatchers: [
          { locationId: 2, watchers: 150 },
          { locationId: 3, watchers: 70 },
        ],
      }),
    ],
    incidents: [],
    unmappedCameraNames: [],
  };
}

describe('detalle Quividi → publicado', () => {
  it('lo publicado concilia exactamente con la cifra del informe', () => {
    const report = scenario();
    const rows = publishedSupportDetail(report);
    const total = rows.reduce((acc, row) => acc + row.publishedOts, 0);
    expect(total).toBeCloseTo(brandCampaignSummary(report).estimatedOts, 6);
  });

  it('pone la lectura de cada cámara junto a la cifra publicada y su regla', () => {
    const rows = publishedSupportDetail(scenario());
    const coapa = rows.find(
      (row) => row.storeNumber === '2' && row.date === DATES[0],
    );
    expect(coapa?.cameras.map((c) => c.ots)).toEqual([3000, 1200]);
    expect(coapa).toMatchObject({
      publishedOts: 6000,
      origin: 'measured',
      rationale: '2 cámaras: la más alta (Cám. 1) × 2',
    });
    const single = rows.find(
      (row) => row.storeNumber === '1' && row.date === DATES[0],
    );
    expect(single?.rationale).toBe('1 cámara: lectura × 2');
  });

  it('explica los días sin dato y los soportes sin cámara', () => {
    const rows = publishedSupportDetail(scenario());
    // Promedio del formato: (2,000 + 2,000 + 6,000) / 3 par-día medidos.
    const missing = rows.find((row) => row.origin === 'missing');
    expect(missing?.publishedOts).toBeCloseTo(10_000 / 3, 6);
    expect(missing?.rationale).toContain('Sin dato ese día');
    const uncovered = rows.filter((row) => row.origin === 'uncovered');
    expect(uncovered).toHaveLength(2);
    expect(uncovered[0]).toMatchObject({
      storeName: 'Sin cámara (1 soporte)',
      rationale: 'Sin cámara: promedio del formato × 1 soporte',
    });
  });

  it('la zona partida suma sin duplicar', () => {
    const row = supportDay({
      date: DATES[0]!,
      storeNumber: '9',
      configuredCameras: 2,
      zoneSplit: true,
    });
    expect(cameraRuleRationale(row, [])).toBe(
      'Zona partida: suma de ambas cámaras, sin duplicar',
    );
  });
});

describe('demografía publicada', () => {
  it('rellena días sin dato y soportes sin cámara con el perfil del formato', () => {
    const rows = brandDemographics(scenario());
    const origins = new Set(rows.map((row) => row.origin));
    expect(origins).toEqual(new Set(['measured', 'missing', 'uncovered']));
    // Perfil medido del formato: mujeres 120 + 120 + 300 de 1,000 publicados.
    // Lo estimado usa ese mismo perfil, así que el total no se mueve.
    const gender = brandGender(scenario());
    const female = gender.find((item) => item.label === 'Femenino');
    expect(female?.share).toBeCloseTo(54, 6);
  });

  it('los watchers publicados por demografía suman lo mismo que los del soporte', () => {
    const report = scenario();
    const demographics = brandDemographics(report).reduce(
      (acc, row) => acc + row.watchers,
      0,
    );
    const support = publishedSupportDetail(report).reduce(
      (acc, row) => acc + row.publishedWatchers,
      0,
    );
    expect(demographics).toBeCloseTo(support, 6);
  });

  it('conserva la lectura de cada cámara en las filas medidas', () => {
    const rows = publishedDemographicDetail(scenario());
    const coapa = rows.find(
      (row) =>
        row.storeNumber === '2' &&
        row.gender === 1 &&
        row.origin === 'measured',
    );
    expect(coapa).toMatchObject({
      cameraWatchers: [150, 70],
      watchers: 300,
      rationale: '2 cámaras: la más alta (Cám. 1) × 2',
    });
  });
});
