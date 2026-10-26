import type { QuividiCampaignReport } from '@/domain';
import {
  BRAND_OPERATIONAL_END_HOUR,
  BRAND_OPERATIONAL_START_HOUR,
  brandAge,
  brandCampaignSummary,
  brandStoreAttribution,
  brandDaily,
  brandDwellTime,
  brandFormatRate,
  brandGender,
  brandHeader,
  brandHourlyDistribution,
  brandOperationalReport,
  brandTopStores,
  type BrandHourlyPoint,
  type BrandShare,
} from './quividiBrandReport';
import { brandGapFilledReport } from './quividiGapFill';
import {
  WEEKDAY_LABELS,
  qualitySummary,
  type MarketingQualitySummary,
} from './quividiMarketingAnalytics';

/**
 * Datos de la hoja «Dashboard Ejecutivo» del Excel.
 *
 * Es la cara comercial del Excel, así que publica **la misma cifra que el PDF**
 * (`quividiCampaignPdf.ts`): franja operativa 10:00–22:00
 * (`brandOperationalReport`), huecos rellenados con el promedio propio de cada
 * pantalla (`brandGapFilledReport`), duplicación por cámara (`published*`) y
 * extrapolación por formato. Sale de las mismas funciones puras que el PDF,
 * de modo que el Top 5 y el OTS total no pueden divergir de «Tiendas TOP» ni
 * de la portada. Las hojas técnicas («Detalle Soportes», «Cámaras»,
 * «Auditoría de cifras») siguen con el dato medido de día completo.
 */
export interface ExecutiveDashboard {
  ots: number;
  dailyAverage: number;
  dwellSeconds: number;
  days: number;
  totalStores: number;
  measuredPercent: number;
  /** OTS publicados por formato con medición; suman `ots`. */
  supports: Array<{ support: string; ots: number }>;
  /** Las tiendas de mayor aportación; `share` en % sobre `ots`. */
  topStores: Array<{
    storeNumber: string;
    storeName: string;
    ots: number;
    share: number;
    /** Incluye OTS estimados (relleno de huecos o promedio del formato). */
    estimated: boolean;
  }>;
  /** Lunes a domingo; `share` en % sobre `ots`. */
  weekdays: Array<{ label: string; ots: number; share: number; days: number }>;
  /** Horas de mayor audiencia dentro de la franja, de mayor a menor. */
  peakHours: Array<{ hour: number; ots: number; share: number }>;
  /** Franjas acotadas a 10:00–22:00; `share` en % sobre `ots`. */
  timeBands: Array<{ label: string; range: string; share: number }>;
  gender: BrandShare[];
  age: BrandShare[];
  /** Soporte-día dentro de la franja, antes del relleno de huecos. */
  quality: MarketingQualitySummary;
}

const BANDS = [
  { label: 'Mañana', start: 6, end: 12 },
  { label: 'Mediodía', start: 12, end: 16 },
  { label: 'Tarde', start: 16, end: 20 },
  { label: 'Noche', start: 20, end: 24 },
] as const;

/** Menos de medio OTS de diferencia es redondeo, no estimación. */
function hasEstimate(adjustedOts: number, measuredOts: number): boolean {
  return adjustedOts - measuredOts >= 0.5;
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function dayOfWeek(date: string): number {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getUTCDay();
}

/** Franjas del día recortadas a la franja operativa de cara a la marca. */
export function operationalTimeBands(
  hourly: readonly BrandHourlyPoint[],
): ExecutiveDashboard['timeBands'] {
  return BANDS.flatMap((band) => {
    const start = Math.max(band.start, BRAND_OPERATIONAL_START_HOUR);
    const end = Math.min(band.end, BRAND_OPERATIONAL_END_HOUR);
    if (start >= end) return [];
    const share = hourly
      .filter((point) => point.hour >= start && point.hour < end)
      .reduce((total, point) => total + point.share, 0);
    return [
      {
        label: band.label,
        range: `${hourLabel(start)}–${hourLabel(end)}`,
        share,
      },
    ];
  });
}

export function executiveDashboard(
  report: QuividiCampaignReport,
): ExecutiveDashboard {
  const { windowed, operational } = publishedReport(report);
  const summary = brandCampaignSummary(operational);
  const header = brandHeader(operational);
  const ots = summary.estimatedOts;
  const shareOf = (value: number) => (ots > 0 ? (value / ots) * 100 : 0);

  // Mismo total por formato que `brandCampaignSummary`, así que suman `ots`.
  const supports = summary.scope.measurable
    .map((format) => ({
      support: format.support,
      ots:
        (format.measuredPairDays > 0
          ? format.measuredOts +
            brandFormatRate(format) *
              Math.max(0, format.pairDays - format.measuredPairDays)
          : 0) + format.partialOts,
    }))
    .sort((a, b) => b.ots - a.ots);

  const topStores = brandTopStores(operational, 5).stores.map((store) => ({
    storeNumber: store.storeNumber,
    storeName: store.storeName,
    ots: store.adjustedOts,
    share: shareOf(store.adjustedOts),
    estimated: hasEstimate(store.adjustedOts, store.measuredOts),
  }));

  const byWeekday = new Map<number, { ots: number; days: number }>();
  for (const point of brandDaily(operational)) {
    const weekday = dayOfWeek(point.date);
    const current = byWeekday.get(weekday) ?? { ots: 0, days: 0 };
    current.ots += point.estimatedOts;
    current.days += 1;
    byWeekday.set(weekday, current);
  }
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const current = byWeekday.get(weekday) ?? { ots: 0, days: 0 };
    return {
      label: WEEKDAY_LABELS[weekday] ?? '',
      ots: current.ots,
      share: shareOf(current.ots),
      days: current.days,
    };
  });

  // El 100 % del reparto horario es la portada (`brandHourlyDistribution`).
  const hourly = brandHourlyDistribution(operational);
  const peakHours = [...hourly]
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map((point) => ({
      hour: point.hour,
      ots: (point.share / 100) * ots,
      share: point.share,
    }));

  return {
    ots,
    dailyAverage: summary.dailyAverage,
    dwellSeconds: brandDwellTime(operational),
    days: header.days,
    totalStores: header.totalStores,
    measuredPercent: summary.scope.measuredPercent,
    supports,
    topStores,
    weekdays,
    peakHours,
    timeBands: operationalTimeBands(hourly),
    gender: brandGender(operational),
    age: brandAge(operational),
    quality: qualitySummary(windowed),
  };
}

/** Reporte con la cifra publicada: franja 10:00–22:00 y huecos rellenados. */
function publishedReport(report: QuividiCampaignReport): {
  windowed: QuividiCampaignReport;
  operational: QuividiCampaignReport;
} {
  const windowed = brandOperationalReport(report);
  return { windowed, operational: brandGapFilledReport(windowed) };
}

function inWindow(hour: number): boolean {
  return (
    hour >= BRAND_OPERATIONAL_START_HOUR && hour < BRAND_OPERATIONAL_END_HOUR
  );
}

/** OTS publicados por hora con dato: medidos más rellenados, sin extrapolar. */
function hourlyObservations(operational: QuividiCampaignReport): Array<{
  date: string;
  storeNumber: string;
  hour: number;
  publishedOts: number;
}> {
  return [
    ...operational.supportHours.filter(
      (row) => row.status !== 'missing' && inWindow(row.hour),
    ),
    ...(operational.estimatedHours ?? []).filter((row) => inWindow(row.hour)),
  ];
}

function bestKey<K>(values: Map<K, number>): K | null {
  let best: K | null = null;
  let bestValue = 0;
  for (const [key, value] of values) {
    if (value > bestValue) {
      best = key;
      bestValue = value;
    }
  }
  return best;
}

export interface CommercialStoreRow {
  storeNumber: string;
  storeName: string;
  supports: string[];
  /** OTS publicados de la tienda (los de «Tiendas TOP»). */
  ots: number;
  /** Parte medida de `ots`, ya duplicada donde aplica. */
  measuredOts: number;
  /** Parte estimada de `ots`: relleno de huecos y promedio del formato. */
  estimatedOts: number;
  dwellSeconds: number;
  bestWeekday: string;
  bestHour: number | null;
  /** Soporte-día con medición propia dentro de la franja, en %. */
  measurementPercent: number;
}

/**
 * Hoja «Tiendas»: mismas tiendas y cifras que «Tiendas TOP» del PDF, sin
 * tope de filas. `restOts` es lo que la portada suma sin tienda identificable
 * (soportes sin cámara); `rows` + `restOts` = `totalOts`.
 */
export function commercialStores(report: QuividiCampaignReport): {
  rows: CommercialStoreRow[];
  restOts: number;
  totalOts: number;
} {
  const { windowed, operational } = publishedReport(report);
  const totalOts = brandCampaignSummary(operational).estimatedOts;
  const observations = hourlyObservations(operational);

  const rows = brandStoreAttribution(operational)
    .stores.filter((store) => store.everMeasured)
    .map((store) => {
      const days = windowed.supportDays.filter(
        (row) => row.storeNumber === store.storeNumber,
      );
      const byWeekday = new Map<number, number>();
      const byHour = new Map<number, number>();
      for (const row of observations) {
        if (row.storeNumber !== store.storeNumber) continue;
        const weekday = dayOfWeek(row.date);
        byWeekday.set(
          weekday,
          (byWeekday.get(weekday) ?? 0) + row.publishedOts,
        );
        byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + row.publishedOts);
      }
      const weekday = bestKey(byWeekday);
      return {
        storeNumber: store.storeNumber,
        storeName: store.storeName,
        supports: Array.from(new Set(days.map((row) => row.support))).sort(
          (a, b) => a.localeCompare(b, 'es'),
        ),
        ots: store.adjustedOts,
        measuredOts: store.measuredOts,
        estimatedOts: hasEstimate(store.adjustedOts, store.measuredOts)
          ? store.adjustedOts - store.measuredOts
          : 0,
        dwellSeconds: store.dwellSeconds,
        bestWeekday: weekday === null ? '—' : (WEEKDAY_LABELS[weekday] ?? '—'),
        bestHour: bestKey(byHour),
        measurementPercent:
          days.length > 0
            ? (days.filter((row) => row.status !== 'missing').length /
                days.length) *
              100
            : 0,
      };
    });
  const listed = rows.reduce((total, row) => total + row.ots, 0);
  return { rows, restOts: Math.max(0, totalOts - listed), totalOts };
}

export interface CommercialDailyRow {
  date: string;
  ots: number;
  measuredOts: number;
  estimatedOts: number;
  /** Hora `HH:MM` del corte, sólo en el día incompleto. */
  partialUntil?: string;
}

/**
 * Hoja «Evolución Diaria»: la serie de «Evolución» del PDF (`brandDaily`),
 * cuya suma es la portada. `measuredOts` excluye lo rellenado.
 */
export function commercialDaily(
  report: QuividiCampaignReport,
): CommercialDailyRow[] {
  const { operational } = publishedReport(report);
  const measurable = new Set(
    brandCampaignSummary(operational).scope.measurable.map(
      (format) => format.support,
    ),
  );
  const ownByDate = new Map<string, number>();
  for (const row of operational.supportDays) {
    if (row.status === 'missing' || !measurable.has(row.support)) continue;
    const own = row.publishedOts - (row.gapFill?.publishedOts ?? 0);
    ownByDate.set(row.date, (ownByDate.get(row.date) ?? 0) + own);
  }
  return brandDaily(operational).map((point) => {
    const measuredOts = point.partialUntil
      ? point.estimatedOts
      : Math.min(point.estimatedOts, ownByDate.get(point.date) ?? 0);
    return {
      date: point.date,
      ots: point.estimatedOts,
      measuredOts,
      estimatedOts: Math.max(0, point.estimatedOts - measuredOts),
      ...(point.partialUntil ? { partialUntil: point.partialUntil } : {}),
    };
  });
}

export interface CommercialHeatCell {
  weekday: number;
  label: string;
  hour: number;
  ots: number;
}

/**
 * Hoja «Días y Horarios»: el OTS publicado de cada día (`brandDaily`)
 * repartido por el perfil horario con dato de ese mismo día (medido más
 * rellenado); un día sin perfil usa el reparto horario del PDF. La suma de
 * todas las celdas es la portada.
 */
export function commercialHeatmap(report: QuividiCampaignReport): {
  hours: number[];
  cells: CommercialHeatCell[];
  weekdays: Array<{ weekday: number; label: string; ots: number }>;
  timeBands: Array<{
    label: string;
    range: string;
    ots: number;
    share: number;
  }>;
} {
  const { operational } = publishedReport(report);
  const ots = brandCampaignSummary(operational).estimatedOts;
  const overall = brandHourlyDistribution(operational);
  const profiles = new Map<string, Map<number, number>>();
  for (const row of hourlyObservations(operational)) {
    const profile = profiles.get(row.date) ?? new Map<number, number>();
    profile.set(row.hour, (profile.get(row.hour) ?? 0) + row.publishedOts);
    profiles.set(row.date, profile);
  }

  const hours = Array.from(
    { length: BRAND_OPERATIONAL_END_HOUR - BRAND_OPERATIONAL_START_HOUR },
    (_, index) => BRAND_OPERATIONAL_START_HOUR + index,
  );
  const totals = new Map<string, number>();
  const add = (weekday: number, hour: number, value: number) => {
    const key = `${weekday}|${hour}`;
    totals.set(key, (totals.get(key) ?? 0) + value);
  };
  for (const point of brandDaily(operational)) {
    const weekday = dayOfWeek(point.date);
    const profile = profiles.get(point.date);
    const observed = profile
      ? Array.from(profile.values()).reduce((a, b) => a + b, 0)
      : 0;
    if (profile && observed > 0) {
      for (const [hour, value] of profile) {
        add(weekday, hour, (value / observed) * point.estimatedOts);
      }
    } else {
      for (const item of overall) {
        add(weekday, item.hour, (item.share / 100) * point.estimatedOts);
      }
    }
  }

  const order = [1, 2, 3, 4, 5, 6, 0];
  const cells = order.flatMap((weekday) =>
    hours.map((hour) => ({
      weekday,
      label: WEEKDAY_LABELS[weekday] ?? '',
      hour,
      ots: totals.get(`${weekday}|${hour}`) ?? 0,
    })),
  );
  const weekdays = order.map((weekday) => ({
    weekday,
    label: WEEKDAY_LABELS[weekday] ?? '',
    ots: cells
      .filter((cell) => cell.weekday === weekday)
      .reduce((total, cell) => total + cell.ots, 0),
  }));
  const timeBands = operationalTimeBands(overall).map((band) => ({
    ...band,
    ots: (band.share / 100) * ots,
  }));
  return { hours, cells, weekdays, timeBands };
}

export interface CommercialHourRow {
  date: string;
  hour: number;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  origin: 'Medido' | 'Medido parcial' | 'Relleno';
  /** Lo que registró la cámara, sin duplicar (0 en horas rellenadas). */
  rawOts: number;
  /** Cifra publicada de esa hora: duplicada y, si aplica, rellenada. */
  publishedOts: number;
}

/**
 * Hoja «Detalle Horario»: cada hora de 10:00 a 22:00 con la cifra publicada,
 * medida o rellenada con el promedio propio de la pantalla. La extrapolación
 * por formato (soportes sin cámara, pantallas sin ningún día medido) no tiene
 * hora ni tienda, así que esta hoja suma menos que la portada.
 */
export function commercialHourlyDetail(
  report: QuividiCampaignReport,
): CommercialHourRow[] {
  const { operational } = publishedReport(report);
  const measured: CommercialHourRow[] = operational.supportHours
    .filter((row) => row.status !== 'missing' && inWindow(row.hour))
    .map((row) => ({
      date: row.date,
      hour: row.hour,
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      configuredCameras: row.configuredCameras,
      measuredCameras: row.measuredCameras,
      origin: row.status === 'complete' ? 'Medido' : 'Medido parcial',
      rawOts: row.ots,
      publishedOts: row.publishedOts,
    }));
  const pairInfo = new Map(
    operational.supportHours.map((row) => [
      `${row.storeNumber}|${row.support}`,
      row,
    ]),
  );
  const filled: CommercialHourRow[] = (operational.estimatedHours ?? [])
    .filter((row) => inWindow(row.hour))
    .map((row) => {
      const info = pairInfo.get(`${row.storeNumber}|${row.support}`);
      return {
        date: row.date,
        hour: row.hour,
        storeNumber: row.storeNumber,
        storeName: info?.storeName ?? '',
        support: row.support,
        configuredCameras: info?.configuredCameras ?? 0,
        measuredCameras: 0,
        origin: 'Relleno',
        rawOts: 0,
        publishedOts: row.publishedOts,
      };
    });
  return [...measured, ...filled].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.hour - b.hour ||
      a.storeNumber.localeCompare(b.storeNumber, 'es', { numeric: true }) ||
      a.support.localeCompare(b.support, 'es') ||
      a.origin.localeCompare(b.origin, 'es'),
  );
}
