import { describe, expect, it } from 'vitest';
import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';
import {
  brandCampaignSummary,
  brandDaily,
  brandDemographics,
  brandOperationalReport,
  brandStoreAttribution,
} from './quividiBrandReport';
import {
  brandGapFill,
  brandGapFilledReport,
  isWeekendDate,
} from './quividiGapFill';

/** Lunes 28/09 a domingo 04/10/2026. */
const DATES = [
  '2026-09-28',
  '2026-09-29',
  '2026-09-30',
  '2026-10-01',
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
];

type Series = Array<number | null>;

interface Face {
  locationId: number;
  name: string;
  series: Series;
}

interface PairSpec {
  storeNumber: string;
  storeName: string;
  support?: string;
  zoneSplit?: boolean;
  faces: Face[];
}

function cameraDays(spec: PairSpec): QuividiCameraDay[] {
  return spec.faces.flatMap((face) =>
    DATES.map((date, index) => {
      const value = face.series[index] ?? null;
      return {
        locationId: face.locationId,
        locationName: face.name,
        boxId: null,
        siteId: null,
        active: true,
        lastSeen: null,
        date,
        storeNumber: spec.storeNumber,
        storeName: spec.storeName,
        support: spec.support ?? 'BANNER DIGITAL',
        durationSeconds: value === null ? 0 : 43_200,
        ots: value ?? 0,
        effectiveOts: value === null ? 0 : value / 2,
        watchers: value === null ? 0 : value / 10,
        attentionTenths: 0,
        dwellTenths: 0,
        status: value === null ? ('missing' as const) : ('complete' as const),
      };
    }),
  );
}

/**
 * Una hora de la franja operativa por día, como la arma `buildSupportHours`:
 * zona partida con 2+ cámaras suma y envía la lectura de cada cara; 1 cámara
 * se duplica.
 */
function supportHours(spec: PairSpec): QuividiSupportHour[] {
  const configured = spec.faces.length;
  const zoneSplit = spec.zoneSplit ?? true;
  const factor = configured === 1 ? 2 : 1;
  return DATES.flatMap((date, index) => {
    const measured = spec.faces
      .map((face) => ({ face, value: face.series[index] ?? null }))
      .filter(
        (item): item is { face: Face; value: number } => item.value !== null,
      );
    if (measured.length === 0) return [];
    const ots = measured.reduce((total, item) => total + item.value, 0);
    return [
      {
        date,
        hour: 12,
        storeNumber: spec.storeNumber,
        storeName: spec.storeName,
        support: spec.support ?? 'BANNER DIGITAL',
        configuredCameras: configured,
        measuredCameras: measured.length,
        status:
          measured.length === configured
            ? ('complete' as const)
            : ('partial' as const),
        ots,
        effectiveOts: ots / 2,
        watchers: ots / 10,
        publishedOts: ots * factor,
        publishedEffectiveOts: (ots / 2) * factor,
        publishedWatchers: (ots / 10) * factor,
        attentionSeconds: 4,
        dwellSeconds: 15,
        ...(zoneSplit && configured >= 2
          ? {
              cameraReadings: measured.map(({ face, value }) => ({
                locationId: face.locationId,
                ots: value,
                effectiveOts: value / 2,
                watchers: value / 10,
              })),
            }
          : {}),
      },
    ];
  });
}

/** Filas diarias (día completo) consistentes con las horas. */
function supportDays(spec: PairSpec): QuividiSupportDay[] {
  const zoneSplit = spec.zoneSplit ?? true;
  const configured = spec.faces.length;
  const factor = configured === 1 ? 2 : 1;
  return DATES.map((date, index) => {
    const values = spec.faces
      .map((face) => face.series[index] ?? null)
      .filter((value): value is number => value !== null);
    const ots = values.reduce((total, value) => total + value, 0);
    return {
      date,
      storeNumber: spec.storeNumber,
      storeName: spec.storeName,
      support: spec.support ?? 'BANNER DIGITAL',
      configuredCameras: configured,
      measuredCameras: values.length,
      status:
        values.length === 0
          ? ('missing' as const)
          : values.length === configured
            ? ('complete' as const)
            : ('partial' as const),
      zoneSplit,
      ots,
      effectiveOts: ots / 2,
      watchers: ots / 10,
      publishedOts: ots * factor,
      publishedEffectiveOts: (ots / 2) * factor,
      publishedWatchers: (ots / 10) * factor,
      attentionSeconds: values.length ? 4 : 0,
      dwellSeconds: values.length ? 15 : 0,
    };
  });
}

function report(specs: PairSpec[]): QuividiCampaignReport {
  const supports = new Map<string, number>();
  for (const spec of specs) {
    const support = spec.support ?? 'BANNER DIGITAL';
    supports.set(support, (supports.get(support) ?? 0) + 1);
  }
  return {
    schemaVersion: 9,
    campaignId: 'c1',
    campaignName: 'MARCA JUGUETES',
    startDate: DATES[0]!,
    endDate: DATES[DATES.length - 1]!,
    generatedAt: Date.parse('2026-10-06T18:00:00Z'),
    measuredEndDate: DATES[DATES.length - 1]!,
    partialDate: null,
    partialUntil: null,
    scopeOrigins: [],
    coverage: {
      totalPairs: specs.length,
      mappedPairs: specs.length,
      percent: 100,
      bySupport: Array.from(supports, ([support, pairs]) => ({
        support,
        totalPairs: pairs,
        mappedPairs: pairs,
        percent: 100,
      })),
    },
    storeCoverage: {
      totalStores: new Set(specs.map((spec) => spec.storeNumber)).size,
      mappedStores: new Set(specs.map((spec) => spec.storeNumber)).size,
      percent: 100,
    },
    cameraDays: specs.flatMap(cameraDays),
    supportDays: specs.flatMap(supportDays),
    supportHours: specs.flatMap(supportHours),
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
  };
}

/**
 * Caso real de octubre 2026 (cifras de la tabla dinámica de Quividi, tiendas
 * anonimizadas): 4 tiendas BANNER DIGITAL, dos con caras sin cámara, una de 1
 * cámara con el fin de semana sin dato y una con una cara caída dos días.
 */
const CIRCUIT: PairSpec[] = [
  {
    storeNumber: '176',
    storeName: 'TIENDA A',
    faces: [
      { locationId: 1, name: 'A-P1', series: Array(7).fill(null) },
      {
        locationId: 2,
        name: 'A-PB',
        series: [3256, 3178, 3309, 3771, 10_102, 14_824, 14_559],
      },
    ],
  },
  {
    storeNumber: '199',
    storeName: 'TIENDA B',
    faces: [
      {
        locationId: 3,
        name: 'B-P1',
        series: [5605, 5674, 5292, 6128, 12_854, 16_576, 18_885],
      },
      { locationId: 4, name: 'B-PB', series: Array(7).fill(null) },
    ],
  },
  {
    storeNumber: '4',
    storeName: 'TIENDA C',
    faces: [
      {
        locationId: 5,
        name: 'C-P2',
        series: [6586, 7038, 7361, 8286, 20_357, null, null],
      },
    ],
  },
  {
    storeNumber: '81',
    storeName: 'TIENDA D',
    faces: [
      {
        locationId: 6,
        name: 'D-01',
        series: [5919, 5676, 6048, 6884, 15_351, 17_906, 19_259],
      },
      {
        locationId: 7,
        name: 'D-02',
        series: [7132, null, null, 7867, 17_565, 21_104, 23_314],
      },
    ],
  },
];

function pdfView(input: QuividiCampaignReport): QuividiCampaignReport {
  return brandGapFilledReport(brandOperationalReport(input));
}

describe('relleno con promedio propio · caso BANNER DIGITAL', () => {
  it('sábado y domingo son fin de semana; viernes no', () => {
    expect(isWeekendDate('2026-10-02')).toBe(false);
    expect(isWeekendDate('2026-10-03')).toBe(true);
    expect(isWeekendDate('2026-10-04')).toBe(true);
  });

  it('«Tiendas TOP» completa cada tienda con su propio promedio', () => {
    const stores = new Map(
      brandStoreAttribution(pdfView(report(CIRCUIT))).stores.map((store) => [
        store.storeNumber,
        store.adjustedOts,
      ]),
    );
    // Cara sin cámara: copia día a día a su hermana (52,999 × 2).
    expect(stores.get('176')).toBeCloseTo(105_998, 6);
    expect(stores.get('199')).toBeCloseTo(142_028, 6);
    // 1 cámara (×2, sin cambios) y sin ningún sábado/domingo medido: el
    // fin de semana se completa con el promedio de sus 5 días medidos.
    expect(stores.get('4')).toBeCloseTo(99_256 + 2 * (99_256 / 5), 6);
    // Cara D-02 caída martes y miércoles: promedio propio entre semana
    // (lunes, jueves, viernes = 32,564 / 3 ≈ 10,855), sólo de esa cara.
    expect(stores.get('81')).toBeCloseTo(154_025 + 2 * (32_564 / 3), 6);
  });

  it('portada, evolución diaria y tiendas concilian exactamente', () => {
    const view = pdfView(report(CIRCUIT));
    const summary = brandCampaignSummary(view);
    const daily = brandDaily(view);
    const attribution = brandStoreAttribution(view);
    expect(summary.extrapolatedOts).toBeCloseTo(0, 6);
    expect(
      daily.reduce((total, point) => total + point.estimatedOts, 0),
    ).toBeCloseTo(summary.estimatedOts, 6);
    expect(attribution.measuredStoresOts).toBeCloseTo(summary.estimatedOts, 6);
    expect(summary.measuredOts + summary.filledOts).toBeCloseTo(
      summary.estimatedOts,
      6,
    );
    // Lo medido no cambia: 52,999 + 71,014 + 99,256 + 154,025.
    expect(summary.measuredOts).toBeCloseTo(377_294, 6);
  });

  it('el martes 29/09 ya incluye la cara caída de la tienda D', () => {
    const point = brandDaily(pdfView(report(CIRCUIT))).find(
      (item) => item.date === '2026-09-29',
    );
    // A: 3,178 ×2 · B: 5,674 ×2 · C: 7,038 ×2 · D: 5,676 + 10,854.67.
    expect(point?.estimatedOts).toBeCloseTo(
      3178 * 2 + 5674 * 2 + 7038 * 2 + 5676 + 32_564 / 3,
      6,
    );
  });

  it('deja registrado cada relleno por tienda, soporte y cámara', () => {
    const { fills } = brandGapFill(brandOperationalReport(report(CIRCUIT)));
    const d02 = fills.filter((fill) => fill.locationName === 'D-02');
    expect(d02.map((fill) => fill.date)).toEqual(['2026-09-29', '2026-09-30']);
    expect(d02[0]).toMatchObject({
      reason: 'missing-day',
      method: 'weekday-average',
      basisDays: 3,
    });
    const faceB = fills.filter((fill) => fill.locationName === 'B-PB');
    expect(faceB).toHaveLength(7);
    expect(faceB[0]).toMatchObject({
      reason: 'missing-face',
      method: 'sister-face-copy',
      sourceLocationName: 'B-P1',
      publishedOts: 5605,
    });
    const storeC = fills.filter((fill) => fill.storeNumber === '4');
    expect(storeC).toMatchObject([
      { date: '2026-10-03', locationId: null, method: 'overall-average' },
      { date: '2026-10-04', locationId: null, method: 'overall-average' },
    ]);
  });

  it('con días de fin de semana medidos usa el promedio de fin de semana', () => {
    const spec: PairSpec = {
      storeNumber: '9',
      storeName: 'TIENDA E',
      faces: [
        {
          locationId: 9,
          name: 'E',
          series: [100, 100, 100, 100, 100, 400, null],
        },
      ],
    };
    const { fills } = brandGapFill(brandOperationalReport(report([spec])));
    expect(fills).toMatchObject([
      { date: '2026-10-04', method: 'weekend-average', publishedOts: 800 },
    ]);
  });

  it('una cara sin cámara fuera de BANNER DIGITAL no se copia', () => {
    const spec: PairSpec = {
      storeNumber: '10',
      storeName: 'INSURGENTES',
      support: 'MUPI DIGITAL',
      faces: [
        {
          locationId: 10,
          name: 'F-1',
          series: [100, 100, 100, 100, 100, 100, 100],
        },
        { locationId: 11, name: 'F-2', series: Array(7).fill(null) },
      ],
    };
    const { fills } = brandGapFill(brandOperationalReport(report([spec])));
    expect(fills).toEqual([]);
  });

  it('una pantalla sin ningún día medido no tiene promedio propio', () => {
    const spec: PairSpec = {
      storeNumber: '11',
      storeName: 'TIENDA G',
      support: 'MUPI DIGITAL',
      zoneSplit: false,
      faces: [{ locationId: 12, name: 'G', series: Array(7).fill(null) }],
    };
    const { fills } = brandGapFill(report([spec]));
    expect(fills).toEqual([]);
  });

  it('el día incompleto nunca se rellena', () => {
    const input: QuividiCampaignReport = {
      ...report([CIRCUIT[2]!]),
      endDate: '2026-10-10',
      measuredEndDate: '2026-10-04',
      partialDate: '2026-10-04',
      partialUntil: '15:00',
    };
    const { fills } = brandGapFill(brandOperationalReport(input));
    expect(fills.map((fill) => fill.date)).toEqual(['2026-10-03']);
  });

  it('aplicarlo dos veces no vuelve a sumar', () => {
    const once = pdfView(report(CIRCUIT));
    const twice = brandGapFilledReport(once);
    expect(brandCampaignSummary(twice).estimatedOts).toBe(
      brandCampaignSummary(once).estimatedOts,
    );
  });

  it('por día completo, la cara caída se rellena desde cameraDays', () => {
    const view = brandGapFilledReport(report([CIRCUIT[3]!]));
    const tuesday = view.supportDays.find((row) => row.date === '2026-09-29');
    expect(tuesday?.publishedOts).toBeCloseTo(5676 + 32_564 / 3, 6);
    expect(tuesday?.gapFill).toMatchObject({ full: false });
  });

  it('la demografía estimada sigue el perfil del propio soporte', () => {
    const base = report([CIRCUIT[2]!]);
    const input: QuividiCampaignReport = {
      ...base,
      demographics: DATES.slice(0, 5).flatMap((date) => [
        {
          date,
          storeNumber: '4',
          storeName: 'TIENDA C',
          support: 'BANNER DIGITAL',
          gender: 2,
          age: 3,
          watchers: 30,
          publishedWatchers: 60,
        },
        {
          date,
          storeNumber: '4',
          storeName: 'TIENDA C',
          support: 'BANNER DIGITAL',
          gender: 1,
          age: 3,
          watchers: 10,
          publishedWatchers: 20,
        },
      ]),
    };
    const rows = brandDemographics(brandGapFilledReport(input)).filter(
      (row) => row.origin === 'filled',
    );
    expect(new Set(rows.map((row) => row.date))).toEqual(
      new Set(['2026-10-03', '2026-10-04']),
    );
    const female = rows.filter((row) => row.gender === 2);
    const total = rows.reduce((sum, row) => sum + row.watchers, 0);
    expect(
      female.reduce((sum, row) => sum + row.watchers, 0) / total,
    ).toBeCloseTo(0.75, 6);
  });
});

describe('relleno con promedio propio · base del promedio del formato', () => {
  it('los días rellenados no entran al promedio que completa pantallas sin medición', () => {
    // E midió sólo el lunes (200 publicados, 100 por cara) y rellena 6 días;
    // H publica 600 todos los días; G nunca midió y toma el promedio del
    // formato sobre observación directa.
    const specs: PairSpec[] = [
      {
        storeNumber: '1',
        storeName: 'E',
        support: 'MUPI DIGITAL',
        zoneSplit: false,
        faces: [
          {
            locationId: 1,
            name: 'E',
            series: [100, null, null, null, null, null, null],
          },
          {
            locationId: 2,
            name: 'E2',
            series: [100, null, null, null, null, null, null],
          },
        ],
      },
      {
        storeNumber: '2',
        storeName: 'H',
        support: 'MUPI DIGITAL',
        zoneSplit: false,
        faces: [
          { locationId: 3, name: 'H', series: Array(7).fill(300) },
          { locationId: 4, name: 'H2', series: Array(7).fill(300) },
        ],
      },
      {
        storeNumber: '3',
        storeName: 'G',
        support: 'MUPI DIGITAL',
        zoneSplit: false,
        faces: [
          { locationId: 5, name: 'G', series: Array(7).fill(null) },
          { locationId: 6, name: 'G2', series: Array(7).fill(null) },
        ],
      },
    ];
    const view = brandGapFilledReport(report(specs));
    const summary = brandCampaignSummary(view);
    // Observación directa: (200 + 7 × 600) / 8 = 550 por par-día. Con los 6
    // días rellenados de E dentro, bajaría a (7 × 200 + 7 × 600) / 14 = 400.
    expect(summary.extrapolatedOts).toBeCloseTo(7 * 550, 6);
    // E: 7 × 200 (propio) · H: 7 × 600 · G: 7 × 550.
    expect(summary.estimatedOts).toBeCloseTo(1400 + 4200 + 7 * 550, 6);
    expect(
      brandDaily(view).reduce((total, point) => total + point.estimatedOts, 0),
    ).toBeCloseTo(summary.estimatedOts, 6);
  });
});
