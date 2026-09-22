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
  brandDaily,
  brandExtrapolationBasis,
  brandGender,
  brandGenderAge,
  brandMeasurableScope,
  brandSupportDays,
  brandTimeOfDay,
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
        cameraDay({
          date,
          storeNumber: '10',
          storeName: 'INSURGENTES',
          locationId: 1,
          ots: 100,
        }),
        cameraDay({
          date,
          storeNumber: '10',
          storeName: 'INSURGENTES',
          locationId: 2,
          ots: 200,
        }),
        cameraDay({
          date,
          storeNumber: '11',
          storeName: 'SANTA FE',
          locationId: 3,
          ots: 400,
        }),
        cameraDay({
          date,
          storeNumber: '11',
          storeName: 'SANTA FE',
          locationId: 4,
          ots: 600,
        }),
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
      totalStoreDays: 20,
      measuredStoreDays: 15,
      storeDayPercent: 75,
    });
    expect(summary.measuredOts).toBe(15_000_000);
    expect(summary.extrapolatedOts).toBe(5_000_000);
    expect(summary.estimatedOts).toBe(20_000_000);
    expect(summary.dailyPerStore).toBe(1_000_000);
    expect(summary.dailyPerSupport).toBe(1_000_000);
  });

  it('degrada la cobertura tienda-día cuando una cámara cae a mitad de vigencia', () => {
    // 4 tiendas del universo, 10 días. Dos miden siempre, una mide 2 de 10 y
    // la cuarta no tiene cámara.
    const dates = Array.from(
      { length: 10 },
      (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    );
    const rows = dates.flatMap((date, index) => [
      supportDay({ date, storeNumber: '1', storeName: 'UNO', ots: 1000 }),
      supportDay({ date, storeNumber: '2', storeName: 'DOS', ots: 1000 }),
      supportDay({
        date,
        storeNumber: '3',
        storeName: 'TRES',
        ...(index < 2
          ? { ots: 1000 }
          : { status: 'missing' as const, measuredCameras: 0, ots: 0 }),
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: { totalPairs: 4, mappedPairs: 3, percent: 75, bySupport: [] },
      storeCoverage: { totalStores: 4, mappedStores: 3, percent: 75 },
      supportDays: rows,
    });

    const coverage = brandCoverage(input);
    // El despliegue de cámaras no cambia: 3 de 4 tiendas midieron algo.
    expect(coverage.measuredPercent).toBe(75);
    // La completitud real sí: 22 de 40 tienda-día.
    expect(coverage.totalStoreDays).toBe(40);
    expect(coverage.measuredStoreDays).toBe(22);
    expect(coverage.storeDayPercent).toBeCloseTo(55, 5);
  });

  it('no deflacta la extrapolación con los días sin medición', () => {
    const dates = Array.from(
      { length: 10 },
      (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    );
    const rows = dates.flatMap((date, index) => [
      supportDay({ date, storeNumber: '1', storeName: 'UNO', ots: 1000 }),
      supportDay({
        date,
        storeNumber: '2',
        storeName: 'DOS',
        ...(index < 2
          ? { ots: 1000 }
          : { status: 'missing' as const, measuredCameras: 0, ots: 0 }),
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
      supportDays: rows,
    });

    const basis = brandExtrapolationBasis(input);
    expect(basis.totalPairDays).toBe(20);
    expect(basis.measuredPairDays).toBe(12);
    expect(basis.missingPairDays).toBe(8);
    expect(basis.uncoveredPairDays).toBe(0);
    // 12 par-día medidos a 1000 OTS cada uno: el promedio no baja por los huecos.
    expect(basis.otsPerMeasuredPairDay).toBe(1000);

    const summary = brandCampaignSummary(input);
    expect(summary.measuredOts).toBe(12_000);
    // 20 par-día del universo × 1000: los 8 huecos se rellenan al promedio real.
    expect(summary.estimatedOts).toBe(20_000);
    expect(summary.extrapolatedOts).toBe(8_000);
  });

  it('escala cada día por los pares medidos de ese día', () => {
    const rows = [
      supportDay({
        date: '2026-09-01',
        storeNumber: '1',
        storeName: 'UNO',
        ots: 1000,
      }),
      supportDay({
        date: '2026-09-01',
        storeNumber: '2',
        storeName: 'DOS',
        ots: 1000,
      }),
      // El día 2 sólo mide una de las dos tiendas: la audiencia por tienda no
      // cambió, la medición sí.
      supportDay({
        date: '2026-09-02',
        storeNumber: '1',
        storeName: 'UNO',
        ots: 1000,
      }),
      supportDay({
        date: '2026-09-02',
        storeNumber: '2',
        storeName: 'DOS',
        status: 'missing',
        measuredCameras: 0,
        ots: 0,
      }),
    ];
    const input = report({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
      supportDays: rows,
    });

    const daily = brandDaily(input);
    expect(daily).toHaveLength(2);
    expect(daily[0]?.measuredPairs).toBe(2);
    expect(daily[1]?.measuredPairs).toBe(1);
    // Ambos días se dibujan iguales: el hueco de medición no es una caída.
    expect(daily[0]?.estimatedOts).toBe(2000);
    expect(daily[1]?.estimatedOts).toBe(2000);
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

describe('reparto por franja horaria', () => {
  function hour(
    h: number,
    ots: number,
    status: 'complete' | 'missing' = 'complete',
  ) {
    return {
      date: '2026-09-01',
      hour: h,
      storeNumber: '1',
      storeName: 'UNO',
      support: 'MUPI DIGITAL',
      configuredCameras: 1,
      measuredCameras: status === 'missing' ? 0 : 1,
      status,
      ots,
      effectiveOts: ots,
      watchers: 0,
      attentionSeconds: 0,
      dwellSeconds: 0,
    };
  }

  it('reparte los OTS entre mañana, tarde y noche', () => {
    const input = report({
      supportHours: [hour(8, 100), hour(14, 200), hour(20, 100)],
    });
    const bands = brandTimeOfDay(input);
    expect(bands.map((band) => band.label)).toEqual([
      'Mañana',
      'Tarde',
      'Noche',
    ]);
    expect(bands.map((band) => Math.round(band.share))).toEqual([25, 50, 25]);
  });

  it('cuenta la madrugada como noche, sin descartar sus OTS', () => {
    const input = report({ supportHours: [hour(8, 100), hour(3, 100)] });
    const bands = brandTimeOfDay(input);
    expect(bands[2]?.share).toBeCloseTo(50, 5);
    // Las tres franjas cubren el día completo.
    expect(bands.reduce((total, band) => total + band.share, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  it('ignora las horas sin medición', () => {
    const input = report({
      supportHours: [hour(8, 100), hour(14, 999, 'missing')],
    });
    expect(brandTimeOfDay(input)[0]?.share).toBe(100);
  });

  it('devuelve vacío cuando el reporte no trae detalle horario', () => {
    expect(brandTimeOfDay(report({ supportHours: [] }))).toEqual([]);
  });
});

describe('perfil cruzado de género y edad', () => {
  function demo(gender: number, age: number, watchers: number) {
    return {
      date: '2026-09-01',
      storeNumber: '1',
      storeName: 'UNO',
      support: 'MUPI DIGITAL',
      gender,
      age,
      watchers,
    };
  }

  it('reparte cada rango de edad entre mujer y hombre sobre el total', () => {
    const input = report({
      demographics: [
        demo(2, 3, 40),
        demo(1, 3, 20),
        demo(2, 2, 30),
        demo(1, 2, 10),
      ],
    });
    const rows = brandGenderAge(input);
    // Ordenado por peso total del rango: adulto (60) antes que adulto joven (40).
    expect(rows.map((row) => row.age)).toEqual([
      'Adulto (31–65)',
      'Adulto joven (16–30)',
    ]);
    expect(rows[0]?.female).toBeCloseTo(40, 5);
    expect(rows[0]?.male).toBeCloseTo(20, 5);
    // Toda la tabla suma 100: son porcentajes del total, no de cada género.
    const all = rows.reduce((sum, row) => sum + row.female + row.male, 0);
    expect(all).toBeCloseTo(100, 5);
  });

  it('descarta el género desconocido en lugar de repartirlo', () => {
    const input = report({
      demographics: [demo(2, 3, 50), demo(1, 3, 50), demo(0, 3, 900)],
    });
    const rows = brandGenderAge(input);
    expect(rows[0]?.female).toBeCloseTo(50, 5);
    expect(rows[0]?.male).toBeCloseTo(50, 5);
  });

  it('devuelve vacío sin datos demográficos utilizables', () => {
    expect(brandGenderAge(report({ demographics: [] }))).toEqual([]);
    expect(brandGenderAge(report({ demographics: [demo(0, 1, 10)] }))).toEqual(
      [],
    );
  });
});

describe('circuito medible', () => {
  const dates = Array.from(
    { length: 10 },
    (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
  );

  /** Mupis con cámara y medición; video walls contratados y sin medir. */
  function mixed(): QuividiCampaignReport {
    const rows = dates.flatMap((date) => [
      supportDay({
        date,
        storeNumber: '1',
        storeName: 'UNO',
        support: 'MUPI DIGITAL',
        ots: 1000,
      }),
      supportDay({
        date,
        storeNumber: '2',
        storeName: 'DOS',
        support: 'MUPI DIGITAL',
        ots: 1000,
      }),
    ]);
    return report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: {
        totalPairs: 10,
        mappedPairs: 2,
        percent: 20,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 4,
            mappedPairs: 2,
            percent: 50,
          },
          { support: 'VIDEO WALL', totalPairs: 6, mappedPairs: 0, percent: 0 },
        ],
      },
      storeCoverage: { totalStores: 10, mappedStores: 2, percent: 20 },
      supportDays: rows,
    });
  }

  it('deja fuera de la cifra los formatos sin ninguna medición', () => {
    const scope = brandMeasurableScope(mixed());
    expect(scope.measurable.map((format) => format.support)).toEqual([
      'MUPI DIGITAL',
    ]);
    expect(scope.excluded.map((format) => format.support)).toEqual([
      'VIDEO WALL',
    ]);
    expect(scope.measurablePairs).toBe(4);
    expect(scope.excludedPairs).toBe(6);
    // La rejilla publicada son los 4 mupis por 10 días, no los 10 soportes.
    expect(scope.measurablePairDays).toBe(40);
    expect(scope.measuredPairDays).toBe(20);
    expect(scope.measuredPercent).toBeCloseTo(50, 5);
  });

  it('no hereda el rendimiento del mupi al video wall', () => {
    const summary = brandCampaignSummary(mixed());
    expect(summary.measuredOts).toBe(20_000);
    // 4 mupis × 10 días × 1.000 OTS. Los 6 video wall no entran.
    expect(summary.estimatedOts).toBe(40_000);
    expect(summary.extrapolatedOts).toBe(20_000);
  });

  it('extrapola cada formato medible con su propio promedio', () => {
    const rows = dates.flatMap((date) => [
      supportDay({
        date,
        storeNumber: '1',
        storeName: 'UNO',
        support: 'MUPI DIGITAL',
        ots: 1000,
      }),
      supportDay({
        date,
        storeNumber: '9',
        storeName: 'NUEVE',
        support: 'VIDEO WALL',
        ots: 9000,
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: {
        totalPairs: 4,
        mappedPairs: 2,
        percent: 50,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 2,
            mappedPairs: 1,
            percent: 50,
          },
          { support: 'VIDEO WALL', totalPairs: 2, mappedPairs: 1, percent: 50 },
        ],
      },
      storeCoverage: { totalStores: 4, mappedStores: 2, percent: 50 },
      supportDays: rows,
    });

    const summary = brandCampaignSummary(input);
    expect(summary.measuredOts).toBe(100_000);
    // Cada formato dobla su propio dato: 20.000 de mupi y 180.000 de video
    // wall. Un promedio único habría dado 200.000 para ambos.
    expect(summary.estimatedOts).toBe(200_000);
    expect(summary.scope.measurable).toHaveLength(2);
  });
});
