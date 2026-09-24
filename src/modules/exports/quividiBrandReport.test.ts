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
  brandDwellTime,
  brandExtrapolationBasis,
  brandExtrapolationByReason,
  brandGender,
  brandGenderAge,
  brandGenderByDay,
  brandHourlyDistribution,
  brandMeasurableScope,
  brandStoreAttribution,
  brandSupportDays,
  brandWeeklyEvolution,
  periodDays,
  weekStartOf,
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

  it('conserva un OTS observado igual a cero: no lo confunde con una jornada sin dato', () => {
    const rows = [
      supportDay({
        date: '2026-09-01',
        storeNumber: '1',
        storeName: 'UNO',
        ots: 1000,
      }),
      // Segunda tienda: cámara activa, pero cero personas detectadas ese día.
      // Sigue siendo una medición válida y debe contar como par medido.
      supportDay({
        date: '2026-09-01',
        storeNumber: '2',
        storeName: 'DOS',
        ots: 0,
      }),
    ];
    const input = report({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
      supportDays: rows,
    });

    const basis = brandExtrapolationBasis(input);
    expect(basis.measuredPairDays).toBe(2);
    expect(basis.missingPairDays).toBe(0);
    // El promedio baja porque el cero es un dato real, no porque se descarte.
    expect(basis.otsPerMeasuredPairDay).toBe(500);

    const daily = brandDaily(input);
    expect(daily[0]?.measuredPairs).toBe(2);
    expect(daily[0]?.estimatedOts).toBe(1000);
  });

  it('concilia la suma de los días con el total de campaña, con varios formatos de promedios distintos', () => {
    const dates = Array.from(
      { length: 5 },
      (_, index) => `2026-09-0${index + 1}`,
    );
    // Mupi mide siempre las dos tiendas; video wall pierde una tienda a
    // partir del tercer día. Cada formato tiene su propio promedio.
    const rows = dates.flatMap((date, index) => [
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
        ots: 1200,
      }),
      supportDay({
        date,
        storeNumber: '3',
        storeName: 'TRES',
        support: 'VIDEO WALL',
        ots: 5000,
      }),
      supportDay({
        date,
        storeNumber: '4',
        storeName: 'CUATRO',
        support: 'VIDEO WALL',
        ...(index < 2
          ? { ots: 4600 }
          : { status: 'missing' as const, measuredCameras: 0, ots: 0 }),
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: {
        totalPairs: 4,
        mappedPairs: 4,
        percent: 100,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 2,
            mappedPairs: 2,
            percent: 100,
          },
          {
            support: 'VIDEO WALL',
            totalPairs: 2,
            mappedPairs: 2,
            percent: 100,
          },
        ],
      },
      storeCoverage: { totalStores: 4, mappedStores: 4, percent: 100 },
      supportDays: rows,
    });

    const summary = brandCampaignSummary(input);
    const daily = brandDaily(input);
    const totalFromDaily = daily.reduce(
      (total, point) => total + point.estimatedOts,
      0,
    );
    expect(totalFromDaily).toBeCloseTo(summary.estimatedOts, 6);

    const weekly = brandWeeklyEvolution(input);
    const totalFromWeekly = weekly.reduce(
      (total, point) => total + point.estimatedOts,
      0,
    );
    expect(totalFromWeekly).toBeCloseTo(summary.estimatedOts, 6);
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

describe('desglose de OTS extrapolados por motivo del hueco', () => {
  it('separa días sin dato (con cámara) de soportes sin cámara, por formato', () => {
    const dates = Array.from(
      { length: 10 },
      (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`,
    );
    // Mupi: tienda 1 siempre mide; tienda 2 deja de reportar desde el día 4
    // (7 días sin dato, con cámara instalada). Un tercer par de Mupi está
    // contratado pero nunca tuvo cámara (10 par-día sin cámara).
    // Video wall: una sola tienda, mide siempre — sin huecos de ningún tipo.
    const rows = dates.flatMap((date, index) => [
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
        ...(index < 3
          ? { ots: 1000 }
          : { status: 'missing' as const, measuredCameras: 0, ots: 0 }),
      }),
      supportDay({
        date,
        storeNumber: '3',
        storeName: 'TRES',
        support: 'VIDEO WALL',
        ots: 5000,
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: {
        totalPairs: 4,
        mappedPairs: 3,
        percent: 75,
        bySupport: [
          {
            support: 'MUPI DIGITAL',
            totalPairs: 3,
            mappedPairs: 2,
            percent: 66.7,
          },
          {
            support: 'VIDEO WALL',
            totalPairs: 1,
            mappedPairs: 1,
            percent: 100,
          },
        ],
      },
      storeCoverage: { totalStores: 3, mappedStores: 3, percent: 100 },
      supportDays: rows,
    });

    const byReason = brandExtrapolationByReason(input);
    const mupi = byReason.byFormat.find(
      (row) => row.support === 'MUPI DIGITAL',
    );
    const wall = byReason.byFormat.find((row) => row.support === 'VIDEO WALL');

    expect(mupi?.missingPairDays).toBe(7);
    expect(mupi?.missingOts).toBe(7_000); // 7 × 1000, promedio de Mupi
    expect(mupi?.uncoveredPairDays).toBe(10); // 1 par sin cámara × 10 días
    expect(mupi?.uncoveredOts).toBe(10_000);
    // Video wall midió siempre: ningún hueco de ningún motivo.
    expect(wall?.missingPairDays).toBe(0);
    expect(wall?.uncoveredPairDays).toBe(0);
    expect(wall?.missingOts).toBe(0);
    expect(wall?.uncoveredOts).toBe(0);

    expect(byReason.missingOts).toBe(7_000);
    expect(byReason.uncoveredOts).toBe(10_000);

    // Reconciliación con la cifra publicada, sin recalcularla.
    const summary = brandCampaignSummary(input);
    expect(byReason.missingOts + byReason.uncoveredOts).toBeCloseTo(
      summary.extrapolatedOts,
      6,
    );
  });

  it('no rompe sin ningún hueco: los dos motivos quedan en cero', () => {
    const input = report({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      coverage: { totalPairs: 1, mappedPairs: 1, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 1, mappedStores: 1, percent: 100 },
      supportDays: [
        supportDay({ date: '2026-09-01', storeNumber: '1', storeName: 'UNO' }),
      ],
    });

    const byReason = brandExtrapolationByReason(input);
    expect(byReason.missingOts).toBe(0);
    expect(byReason.uncoveredOts).toBe(0);
  });
});

describe('distribución horaria de OTS con medición directa', () => {
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

  it('reparte el porcentaje entre las horas con dato', () => {
    const input = report({
      supportHours: [hour(11, 100), hour(14, 200), hour(20, 100)],
    });
    const hourly = brandHourlyDistribution(input);
    expect(hourly.map((point) => point.hour)).toEqual([11, 14, 20]);
    expect(hourly.map((point) => Math.round(point.share))).toEqual([
      25, 50, 25,
    ]);
    expect(hourly.reduce((total, point) => total + point.share, 0)).toBeCloseTo(
      100,
      5,
    );
  });

  it('ignora las horas sin medición, sin fabricar su dato', () => {
    const input = report({
      supportHours: [hour(11, 100), hour(14, 999, 'missing')],
    });
    expect(brandHourlyDistribution(input)).toEqual([{ hour: 11, share: 100 }]);
  });

  it('devuelve vacío cuando el reporte no trae detalle horario', () => {
    expect(brandHourlyDistribution(report({ supportHours: [] }))).toEqual([]);
  });

  it('excluye horas fuera de la franja operativa de cara a la marca (10h–22h)', () => {
    // 03h y 23h tienen medición válida (tráfico fuera de horario comercial:
    // limpieza, seguridad), pero de cara a la marca es irrelevante y no debe
    // sugerir audiencia comercial fuera del horario de la tienda.
    const input = report({
      supportHours: [
        hour(3, 500),
        hour(11, 100),
        hour(14, 200),
        hour(21, 100),
        hour(22, 500),
        hour(23, 500),
      ],
    });
    const hourly = brandHourlyDistribution(input);
    expect(hourly.map((point) => point.hour)).toEqual([11, 14, 21]);
    // El total se recalcula sobre la franja operativa, no sobre las 24h.
    expect(hourly.reduce((total, point) => total + point.share, 0)).toBeCloseTo(
      100,
      5,
    );
  });
});

describe('evolución semanal para vigencias largas', () => {
  it('agrupa de lunes a domingo, con semanas parciales en los extremos', () => {
    // 21/08/2026 es viernes: la primera semana sólo trae 3 días (vie-dom).
    const dates = Array.from({ length: 20 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 7, 21) + index * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
    const rows = dates.map((date) =>
      supportDay({ date, storeNumber: '1', storeName: 'UNO', ots: 1000 }),
    );
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: { totalPairs: 1, mappedPairs: 1, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 1, mappedStores: 1, percent: 100 },
      supportDays: rows,
    });

    const weekly = brandWeeklyEvolution(input);
    // 20 días desde un viernes: semana parcial inicial, 2 completas, parcial final.
    expect(weekly).toHaveLength(4);
    expect(weekly[0]?.weekStart).toBe('2026-08-21');
    expect(weekly[0]?.weekEnd).toBe('2026-08-23');
    expect(weekly[weekly.length - 1]?.weekEnd).toBe(dates[dates.length - 1]);
    const total = weekly.reduce((sum, week) => sum + week.estimatedOts, 0);
    expect(total).toBeCloseTo(brandCampaignSummary(input).estimatedOts, 6);
  });

  it('calcula el lunes de la semana ISO de una fecha', () => {
    expect(weekStartOf('2026-08-22')).toBe('2026-08-17'); // sábado -> lunes previo
    expect(weekStartOf('2026-08-23')).toBe('2026-08-17'); // domingo -> lunes previo
    expect(weekStartOf('2026-08-17')).toBe('2026-08-17'); // lunes -> él mismo
  });
});

describe('dwell time ponderado del circuito', () => {
  it('pondera por watchers, no promedia tiendas grandes y pequeñas por igual', () => {
    const input = report({
      supportDays: [
        supportDay({
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'GRANDE',
          watchers: 900,
          dwellSeconds: 40,
        }),
        supportDay({
          date: '2026-09-01',
          storeNumber: '2',
          storeName: 'CHICA',
          watchers: 100,
          dwellSeconds: 10,
        }),
      ],
    });
    // (900*40 + 100*10) / 1000 = 37, no (40+10)/2 = 25.
    expect(brandDwellTime(input)).toBeCloseTo(37, 5);
  });

  it('ignora las jornadas sin medición al ponderar', () => {
    const input = report({
      supportDays: [
        supportDay({
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'UNO',
          watchers: 100,
          dwellSeconds: 20,
        }),
        supportDay({
          date: '2026-09-02',
          storeNumber: '1',
          storeName: 'UNO',
          status: 'missing',
          measuredCameras: 0,
          ots: 0,
          watchers: 0,
          dwellSeconds: 0,
        }),
      ],
    });
    expect(brandDwellTime(input)).toBe(20);
  });
});

describe('aportación de tiendas a la cifra publicada', () => {
  it('separa tiendas con medición de tiendas sin medición y concilia con el total', () => {
    const dates = Array.from(
      { length: 5 },
      (_, index) => `2026-09-0${index + 1}`,
    );
    // 3 tiendas con cámara (2 miden siempre, 1 nunca reporta) + 2 tiendas sin
    // cámara del universo contratado (no aparecen en supportDays).
    const rows = dates.flatMap((date) => [
      supportDay({ date, storeNumber: '1', storeName: 'UNO', ots: 1000 }),
      supportDay({ date, storeNumber: '2', storeName: 'DOS', ots: 2000 }),
      supportDay({
        date,
        storeNumber: '3',
        storeName: 'TRES',
        status: 'missing',
        measuredCameras: 0,
        ots: 0,
      }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: { totalPairs: 5, mappedPairs: 3, percent: 60, bySupport: [] },
      storeCoverage: { totalStores: 5, mappedStores: 3, percent: 60 },
      supportDays: rows,
    });

    const attribution = brandStoreAttribution(input);
    expect(attribution.stores).toHaveLength(3);
    const tres = attribution.stores.find((s) => s.storeNumber === '3');
    expect(tres?.everMeasured).toBe(false);
    expect(
      attribution.stores.find((s) => s.storeNumber === '1')?.everMeasured,
    ).toBe(true);

    const summary = brandCampaignSummary(input);
    expect(
      attribution.measuredStoresOts + attribution.unmeasuredStoresOts,
    ).toBeCloseTo(summary.estimatedOts, 6);
    expect(
      attribution.measuredStoresSharePercent +
        attribution.unmeasuredStoresSharePercent,
    ).toBeCloseTo(100, 6);
    // TRES nunca midió: su aportación cae del lado de "sin medición" aunque
    // tenga cámara instalada, igual que las 2 tiendas que ni eso tienen.
    expect(attribution.unmeasuredStoresOts).toBeGreaterThan(0);
  });

  it('conserva el dato propio de cada tienda: no iguala a todas al promedio del formato', () => {
    const dates = Array.from(
      { length: 4 },
      (_, index) => `2026-09-0${index + 1}`,
    );
    // Dos tiendas, ambas con medición completa todos los días, pero con
    // desempeño muy distinto: deben conservar su propio OTS ajustado.
    const rows = dates.flatMap((date) => [
      supportDay({ date, storeNumber: '1', storeName: 'GRANDE', ots: 5000 }),
      supportDay({ date, storeNumber: '2', storeName: 'CHICA', ots: 500 }),
    ]);
    const input = report({
      startDate: dates[0],
      endDate: dates[dates.length - 1],
      coverage: { totalPairs: 2, mappedPairs: 2, percent: 100, bySupport: [] },
      storeCoverage: { totalStores: 2, mappedStores: 2, percent: 100 },
      supportDays: rows,
    });

    const attribution = brandStoreAttribution(input);
    const grande = attribution.stores.find((s) => s.storeNumber === '1');
    const chica = attribution.stores.find((s) => s.storeNumber === '2');
    // Sin huecos que rellenar, el ajustado es exactamente el propio dato.
    expect(grande?.adjustedOts).toBe(20_000);
    expect(chica?.adjustedOts).toBe(2_000);
  });

  it('rellena sólo los huecos propios de la tienda, con su dato real intacto', () => {
    const dates = Array.from(
      { length: 4 },
      (_, index) => `2026-09-0${index + 1}`,
    );
    const rows = dates.flatMap((date, index) => [
      supportDay({ date, storeNumber: '1', storeName: 'COMPLETA', ots: 1000 }),
      supportDay({
        date,
        storeNumber: '2',
        storeName: 'PARCIAL',
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

    const attribution = brandStoreAttribution(input);
    const parcial = attribution.stores.find((s) => s.storeNumber === '2');
    // 2 días medidos a 1000 + 2 días sin dato completados al promedio del
    // formato (1000, porque la tienda COMPLETA sostiene el promedio real).
    expect(parcial?.measuredOts).toBe(2000);
    expect(parcial?.adjustedOts).toBe(4000);
  });

  it('suma las dos cámaras de Insurgentes como una sola aportación de tienda', () => {
    const date = '2026-09-01';
    const input = report({
      supportDays: [
        supportDay({
          date,
          storeNumber: '10',
          storeName: 'INSURGENTES',
          configuredCameras: 2,
          measuredCameras: 2,
          ots: 300,
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
      ],
    });

    const attribution = brandStoreAttribution(input);
    expect(attribution.stores).toHaveLength(1);
    expect(attribution.stores[0]?.storeName).toBe('INSURGENTES');
    expect(attribution.stores[0]?.measuredOts).toBe(300);
  });
});

describe('composición por género día a día', () => {
  it('conserva el género no identificado sin redistribuirlo', () => {
    const input = report({
      demographics: [
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'UNO',
          support: 'MUPI DIGITAL',
          gender: 2,
          age: 2,
          watchers: 49,
        },
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'UNO',
          support: 'MUPI DIGITAL',
          gender: 1,
          age: 2,
          watchers: 49,
        },
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'UNO',
          support: 'MUPI DIGITAL',
          gender: 0,
          age: 2,
          watchers: 2,
        },
      ],
    });
    const days = brandGenderByDay(input);
    expect(days).toHaveLength(1);
    expect(days[0]?.female).toBeCloseTo(49, 5);
    expect(days[0]?.male).toBeCloseTo(49, 5);
    expect(days[0]?.unknown).toBeCloseTo(2, 5);
    expect(
      (days[0]?.female ?? 0) + (days[0]?.male ?? 0) + (days[0]?.unknown ?? 0),
    ).toBeCloseTo(100, 5);
  });

  it('devuelve un punto por día, ordenado', () => {
    const input = report({
      demographics: [
        {
          date: '2026-09-02',
          storeNumber: '1',
          storeName: 'UNO',
          support: 'MUPI DIGITAL',
          gender: 2,
          age: 2,
          watchers: 10,
        },
        {
          date: '2026-09-01',
          storeNumber: '1',
          storeName: 'UNO',
          support: 'MUPI DIGITAL',
          gender: 1,
          age: 2,
          watchers: 10,
        },
      ],
    });
    expect(brandGenderByDay(input).map((point) => point.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
    ]);
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
