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
  brandFormatAverageAssignments,
  brandGender,
  brandHourlyDistribution,
  brandOperationalReport,
  brandStoreAttribution,
  brandTopStores,
} from './quividiBrandReport';
import {
  brandGapFill,
  brandGapFilledReport,
  gapFillMethodLabel,
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
  /** Horas de la franja sin dato, por fecha (el resto del día sí midió). */
  hourGaps?: Record<string, number[]>;
}

interface PairSpec {
  storeNumber: string;
  storeName: string;
  support?: string;
  zoneSplit?: boolean;
  /** Mupi de Polanco: pantalla única, no se duplica. */
  singleScreen?: boolean;
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

const OPERATIONAL_HOURS = Array.from({ length: 12 }, (_, index) => 10 + index);

/** Regla de cámaras del backend (v10): zona partida suma; si no, la más alta. */
function combine(values: readonly number[], zoneSplit: boolean): number {
  if (values.length === 0) return 0;
  return zoneSplit
    ? values.reduce((total, value) => total + value, 0)
    : Math.max(...values);
}

function factorOf(spec: PairSpec): number {
  const configured = spec.faces.length;
  const zoneSplit = spec.zoneSplit ?? true;
  if (spec.singleScreen) return 1;
  if (configured === 1) return 2;
  return configured === 2 && !zoneSplit ? 2 : 1;
}

/**
 * Las 12 horas de la franja operativa por día, como las arma
 * `buildSupportHours` (v10): cada hora vale 1/12 del día de cada cámara; con
 * 2+ cámaras envía la lectura de cada una. `hourGaps` quita horas concretas
 * de una cámara.
 */
function supportHours(spec: PairSpec): QuividiSupportHour[] {
  const configured = spec.faces.length;
  const zoneSplit = spec.zoneSplit ?? true;
  const factor = factorOf(spec);
  return DATES.flatMap((date, index) =>
    OPERATIONAL_HOURS.flatMap((hour) => {
      const measured = spec.faces
        .map((face) => ({ face, value: face.series[index] ?? null }))
        .filter(
          (item): item is { face: Face; value: number } =>
            item.value !== null &&
            !(item.face.hourGaps?.[date] ?? []).includes(hour),
        )
        .map(({ face, value }) => ({ face, value: value / 12 }));
      if (measured.length === 0) return [];
      const ots = combine(
        measured.map((item) => item.value),
        zoneSplit,
      );
      return [
        {
          date,
          hour,
          storeNumber: spec.storeNumber,
          storeName: spec.storeName,
          support: spec.support ?? 'BANNER DIGITAL',
          configuredCameras: configured,
          measuredCameras: measured.length,
          status:
            measured.length === configured
              ? ('complete' as const)
              : ('partial' as const),
          zoneSplit,
          publishedFactor: factor,
          ots,
          effectiveOts: ots / 2,
          watchers: ots / 10,
          publishedOts: ots * factor,
          publishedEffectiveOts: (ots / 2) * factor,
          publishedWatchers: (ots / 10) * factor,
          attentionSeconds: 4,
          dwellSeconds: 15,
          ...(configured >= 2
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
    }),
  );
}

/** Filas diarias (día completo) consistentes con las horas. */
function supportDays(spec: PairSpec): QuividiSupportDay[] {
  const zoneSplit = spec.zoneSplit ?? true;
  const configured = spec.faces.length;
  const factor = factorOf(spec);
  return DATES.map((date, index) => {
    const values = spec.faces
      .map((face) => face.series[index] ?? null)
      .filter((value): value is number => value !== null);
    const ots = combine(values, zoneSplit);
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
      publishedFactor: factor,
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
    schemaVersion: 10,
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
      publishedOts: expect.closeTo(5605, 6),
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
      {
        date: '2026-10-04',
        method: 'weekend-average',
        publishedOts: expect.closeTo(800, 6),
      },
    ]);
  });

  it('Mupi de Insurgentes: un piso sin cámara copia el valor del otro', () => {
    const spec: PairSpec = {
      storeNumber: '10',
      storeName: 'INSURGENTES',
      support: 'MEGA MUPI DIGITAL',
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
    expect(fills).toHaveLength(7);
    expect(fills[0]).toMatchObject({
      locationName: 'F-2',
      reason: 'missing-face',
      method: 'sister-face-copy',
      publishedOts: expect.closeTo(100, 6),
    });
  });

  it('una cámara caída fuera de zona partida no se copia de su hermana', () => {
    const spec: PairSpec = {
      storeNumber: '12',
      storeName: 'COAPA',
      support: 'MEGA MUPI DIGITAL',
      zoneSplit: false,
      faces: [
        { locationId: 12, name: 'K-1', series: Array(7).fill(100) },
        { locationId: 13, name: 'K-2', series: Array(7).fill(null) },
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

describe('relleno hora a hora · Mupis igual que Banners', () => {
  it('una cámara con horas sin dato completa cada hora con su promedio ÷ 12', () => {
    // 1 cámara (× 2): lunes a jueves completos con 1,200; el viernes faltan
    // 4 horas → 8 medidas (800) + 4 × 1,200/12 (400).
    const spec: PairSpec = {
      storeNumber: '20',
      storeName: 'SATELITE',
      support: 'MEGA MUPI DIGITAL',
      zoneSplit: false,
      faces: [
        {
          locationId: 20,
          name: 'M',
          series: [1200, 1200, 1200, 1200, 1200, 2400, 2400],
          hourGaps: { '2026-10-02': [18, 19, 20, 21] },
        },
      ],
    };
    const { fills, report: view } = brandGapFill(
      brandOperationalReport(report([spec])),
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      date: '2026-10-02',
      locationId: null,
      reason: 'missing-hours',
      method: 'weekday-average',
      basisDays: 4,
      basisKind: 'complete-days',
      missingHours: 4,
      ots: expect.closeTo(400, 6),
      publishedOts: expect.closeTo(800, 6),
    });
    const friday = view.supportDays.find((row) => row.date === '2026-10-02');
    expect(friday?.publishedOts).toBeCloseTo(2400, 6);
    expect(friday?.gapFill).toMatchObject({ full: false });
    expect(gapFillMethodLabel(fills[0]!)).toBe(
      '4 de 12 h sin dato: cada hora vale 1/12 del promedio propio entre semana (4 días completos)',
    );
  });

  it('el promedio sale sólo de días completos: un día parcial no lo deflacta', () => {
    // Lunes parcial (6 de 12 h, 600 medidos) y martes sin dato: el martes
    // toma el promedio de los días completos (1,200), no (600 + 1,200…) / n.
    const spec: PairSpec = {
      storeNumber: '21',
      storeName: 'PERISUR',
      support: 'MEGA MUPI DIGITAL',
      faces: [
        {
          locationId: 21,
          name: 'P',
          series: [1200, null, 1200, 1200, 1200, 1200, 1200],
          hourGaps: { '2026-09-28': [16, 17, 18, 19, 20, 21] },
        },
      ],
    };
    const { fills } = brandGapFill(brandOperationalReport(report([spec])));
    const tuesday = fills.find((fill) => fill.date === '2026-09-29');
    expect(tuesday).toMatchObject({
      reason: 'missing-day',
      missingHours: 12,
      basisDays: 3,
      ots: expect.closeTo(1200, 6),
    });
    const monday = fills.find((fill) => fill.date === '2026-09-28');
    expect(monday).toMatchObject({
      reason: 'missing-hours',
      missingHours: 6,
      ots: expect.closeTo(600, 6),
    });
  });

  it('Mupi de 2 cámaras: rellena la caída con su promedio y toma la más alta × 2', () => {
    // K-2 suele medir más (1,800) que K-1 (1,200). El miércoles K-2 cae:
    // su promedio (1,800) supera lo medido por K-1 → 1,800 × 2.
    const spec: PairSpec = {
      storeNumber: '22',
      storeName: 'COAPA',
      support: 'MEGA MUPI DIGITAL',
      zoneSplit: false,
      faces: [
        { locationId: 22, name: 'K-1', series: Array(7).fill(1200) },
        {
          locationId: 23,
          name: 'K-2',
          series: [1800, 1800, null, 1800, 1800, 1800, 1800],
        },
      ],
    };
    const { fills, report: view } = brandGapFill(
      brandOperationalReport(report([spec])),
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      date: '2026-09-30',
      locationName: 'K-2',
      reason: 'missing-day',
      ots: expect.closeTo(600, 6),
      publishedOts: expect.closeTo(1200, 6),
    });
    const wednesday = view.supportDays.find((row) => row.date === '2026-09-30');
    expect(wednesday?.publishedOts).toBeCloseTo(3600, 6);
  });

  it('Mupi de 2 cámaras: si la caída mide menos que su hermana, no se estima nada', () => {
    const spec: PairSpec = {
      storeNumber: '23',
      storeName: 'COAPA',
      support: 'MEGA MUPI DIGITAL',
      zoneSplit: false,
      faces: [
        { locationId: 24, name: 'K-1', series: Array(7).fill(1800) },
        {
          locationId: 25,
          name: 'K-2',
          series: [1200, 1200, null, 1200, 1200, 1200, 1200],
        },
      ],
    };
    const { fills } = brandGapFill(brandOperationalReport(report([spec])));
    expect(fills).toEqual([]);
  });

  it('Mupi de Insurgentes: rellena cada piso por separado y los suma', () => {
    const spec: PairSpec = {
      storeNumber: '24',
      storeName: 'INSURGENTES',
      support: 'MEGA MUPI DIGITAL',
      faces: [
        { locationId: 26, name: 'PISO 1', series: Array(7).fill(1200) },
        {
          locationId: 27,
          name: 'PISO 2',
          series: [600, 600, 600, 600, 600, 600, 600],
          hourGaps: { '2026-09-29': [10, 11, 12] },
        },
      ],
    };
    const { fills, report: view } = brandGapFill(
      brandOperationalReport(report([spec])),
    );
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      locationName: 'PISO 2',
      reason: 'missing-hours',
      missingHours: 3,
      publishedOts: expect.closeTo(150, 6),
    });
    const tuesday = view.supportDays.find((row) => row.date === '2026-09-29');
    // Suma de pisos, sin duplicar: 1,200 + (450 medidos + 150 estimados).
    expect(tuesday?.publishedOts).toBeCloseTo(1800, 6);
  });

  it('Mupi de Polanco: rellena con su promedio y publica sin duplicar', () => {
    const spec: PairSpec = {
      storeNumber: '25',
      storeName: 'POLANCO',
      support: 'MEGA MUPI DIGITAL',
      zoneSplit: false,
      singleScreen: true,
      faces: [
        {
          locationId: 28,
          name: 'POL',
          series: [1000, 1000, 1000, null, 1000, 1000, 1000],
        },
      ],
    };
    const { fills } = brandGapFill(brandOperationalReport(report([spec])));
    expect(fills).toMatchObject([
      {
        date: '2026-10-01',
        ots: expect.closeTo(1000, 6),
        publishedOts: expect.closeTo(1000, 6),
      },
    ]);
  });
});

describe('todas las cifras del PDF cuadran con la portada', () => {
  function circuitWithUniverse(): QuividiCampaignReport {
    const specs: PairSpec[] = [
      ...CIRCUIT,
      {
        storeNumber: '30',
        storeName: 'TIENDA H',
        support: 'BANNER DIGITAL',
        faces: [
          {
            locationId: 30,
            name: 'H-1',
            series: [4000, 4000, 4000, 4000, 4000, 8000, 8000],
            hourGaps: { '2026-10-01': [19, 20, 21] },
          },
          {
            locationId: 31,
            name: 'H-2',
            series: [3000, 3000, 3000, 3000, 3000, 6000, 6000],
          },
        ],
      },
    ];
    const base = report(specs);
    // Demografía medida por día completo (00–24 h): el doble de los watchers
    // de la franja, para comprobar que se escala a lo publicado.
    const demographics = base.supportDays
      .filter((row) => row.status !== 'missing')
      .flatMap((row) => [
        {
          date: row.date,
          storeNumber: row.storeNumber,
          storeName: row.storeName,
          support: row.support,
          gender: 2,
          age: 3,
          watchers: row.watchers * 1.2,
          publishedWatchers: row.publishedWatchers * 1.2,
        },
        {
          date: row.date,
          storeNumber: row.storeNumber,
          storeName: row.storeName,
          support: row.support,
          gender: 1,
          age: 3,
          watchers: row.watchers * 0.8,
          publishedWatchers: row.publishedWatchers * 0.8,
        },
      ]);
    return {
      ...base,
      demographics,
      coverage: {
        ...base.coverage,
        totalPairs: base.coverage.totalPairs + 1,
        bySupport: [
          {
            support: 'BANNER DIGITAL',
            totalPairs: 6,
            mappedPairs: 5,
            percent: 83,
          },
        ],
        unmappedPairs: [
          {
            storeNumber: '40',
            storeName: 'TIENDA SIN DATO',
            support: 'BANNER DIGITAL',
          },
        ],
      },
      storeCoverage: { totalStores: 6, mappedStores: 5, percent: 83 },
    };
  }

  it('portada = evolución = Tiendas TOP + demás universo', () => {
    const view = pdfView(circuitWithUniverse());
    const summary = brandCampaignSummary(view);
    expect(summary.extrapolatedOts).toBeGreaterThan(0);
    expect(
      brandDaily(view).reduce((total, point) => total + point.estimatedOts, 0),
    ).toBeCloseTo(summary.estimatedOts, 6);
    const top = brandTopStores(view, 3);
    expect(top.stores).toHaveLength(3);
    expect(top.restStores).toBe(3);
    expect(
      top.stores.reduce((total, store) => total + store.adjustedOts, 0) +
        top.restOts,
    ).toBeCloseTo(summary.estimatedOts, 6);
    expect(top.totalOts).toBeCloseTo(summary.estimatedOts, 6);
  });

  it('horarios: las horas rellenadas cuentan en su hora y el reparto cubre el total', () => {
    // Cada cámara reparte su día parejo en las 12 horas: con las horas sin
    // dato rellenadas y lo extrapolado repartido por el perfil del formato,
    // el reparto vuelve a ser parejo.
    const hourly = brandHourlyDistribution(pdfView(circuitWithUniverse()));
    expect(hourly).toHaveLength(12);
    for (const point of hourly) expect(point.share).toBeCloseTo(100 / 12, 6);
  });

  it('demografía: los watchers concilian con los publicados', () => {
    const view = pdfView(circuitWithUniverse());
    const rows = brandDemographics(view);
    const measured = rows
      .filter((row) => row.origin === 'measured')
      .reduce((total, row) => total + row.watchers, 0);
    const published = view.supportDays
      .filter((row) => row.status !== 'missing')
      .reduce(
        (total, row) =>
          total + row.publishedWatchers - (row.gapFill?.publishedWatchers ?? 0),
        0,
      );
    expect(measured).toBeCloseTo(published, 6);
    // El perfil medido (60 % mujeres) se conserva al escalar.
    const female = brandGender(view).find((item) => item.label === 'Femenino');
    expect(female?.share).toBeCloseTo(60, 6);
  });

  it('auditoría: lista por tienda lo calculado con el promedio del formato', () => {
    const input = circuitWithUniverse();
    const view = pdfView(input);
    const assignments = brandFormatAverageAssignments(view, input);
    expect(assignments.map((entry) => entry.storeName)).toContain(
      'TIENDA SIN DATO',
    );
    expect(
      assignments.reduce((total, entry) => total + entry.ots, 0),
    ).toBeCloseTo(brandCampaignSummary(view).extrapolatedOts, 6);
  });
});
