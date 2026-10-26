import type { QuividiCampaignReport } from '@/domain';
import {
  BRAND_OPERATIONAL_END_HOUR,
  BRAND_OPERATIONAL_START_HOUR,
  brandAge,
  brandCampaignSummary,
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
  const windowed = brandOperationalReport(report);
  const operational = brandGapFilledReport(windowed);
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
