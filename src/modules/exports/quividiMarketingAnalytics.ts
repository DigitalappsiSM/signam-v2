import type {
  QuividiCampaignReport,
  QuividiDemographicRow,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';

export const WEEKDAY_LABELS = [
  'Dom',
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
] as const;

export interface MarketingOverallSummary {
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionRate: number;
  attentionSeconds: number;
  dwellSeconds: number;
  measurementPercent: number;
  storeCount: number;
}

export interface MarketingStoreSummary {
  storeNumber: string;
  storeName: string;
  supports: string[];
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionRate: number;
  attentionSeconds: number;
  dwellSeconds: number;
  measurementPercent: number;
  bestWeekday: string;
  bestHour: number | null;
}

export interface MarketingDailySummary {
  date: string;
  ots: number;
  watchers: number;
  attentionRate: number;
}

export interface MarketingWeekdaySummary {
  weekday: number;
  label: string;
  ots: number;
  watchers: number;
  attentionRate: number;
}

export interface MarketingHourSummary {
  hour: number;
  ots: number;
  watchers: number;
  attentionRate: number;
}

export interface MarketingHeatmapCell {
  weekday: number;
  label: string;
  hour: number;
  ots: number;
  watchers: number;
}

export interface MarketingPeakMoment {
  date: string;
  weekday: string;
  hour: number;
  ots: number;
  watchers: number;
  attentionRate: number;
}

export interface MarketingTimeBandSummary {
  key: string;
  label: string;
  range: string;
  ots: number;
  watchers: number;
  share: number;
}

export interface MarketingDemographicSummary {
  key: number;
  label: string;
  watchers: number;
  share: number;
}

export interface MarketingQualitySummary {
  complete: number;
  partial: number;
  missing: number;
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function weightedTime<
  T extends { watchers: number; attentionSeconds: number; dwellSeconds: number },
>(rows: readonly T[], field: 'attentionSeconds' | 'dwellSeconds'): number {
  const watchers = rows.reduce((sum, row) => sum + numeric(row.watchers), 0);
  if (watchers <= 0) return 0;
  return (
    rows.reduce(
      (sum, row) => sum + numeric(row[field]) * numeric(row.watchers),
      0,
    ) / watchers
  );
}

function dayOfWeek(date: string): number {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getUTCDay();
}

function aggregateRows<
  T extends {
    ots: number;
    effectiveOts: number;
    watchers: number;
    attentionSeconds: number;
    dwellSeconds: number;
  },
>(rows: readonly T[]) {
  const ots = rows.reduce((sum, row) => sum + numeric(row.ots), 0);
  const effectiveOts = rows.reduce(
    (sum, row) => sum + numeric(row.effectiveOts),
    0,
  );
  const watchers = rows.reduce((sum, row) => sum + numeric(row.watchers), 0);
  return {
    ots,
    effectiveOts,
    watchers,
    attentionRate: ots > 0 ? (watchers / ots) * 100 : 0,
    attentionSeconds: weightedTime(rows, 'attentionSeconds'),
    dwellSeconds: weightedTime(rows, 'dwellSeconds'),
  };
}

function bestWeekday(rows: readonly QuividiSupportHour[]): string {
  const byDay = new Map<number, number>();
  for (const row of rows) {
    const key = dayOfWeek(row.date);
    byDay.set(key, (byDay.get(key) ?? 0) + numeric(row.ots));
  }
  const best = Array.from(byDay.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? WEEKDAY_LABELS[best[0]] ?? '—' : '—';
}

function bestHour(rows: readonly QuividiSupportHour[]): number | null {
  const byHour = new Map<number, number>();
  for (const row of rows) {
    byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + numeric(row.ots));
  }
  return Array.from(byHour.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function overallSummary(
  report: QuividiCampaignReport,
): MarketingOverallSummary {
  const aggregated = aggregateRows(report.supportDays);
  const measured = report.supportDays.filter(
    (row) => row.status !== 'missing',
  ).length;
  return {
    ...aggregated,
    measurementPercent:
      report.supportDays.length > 0
        ? (measured / report.supportDays.length) * 100
        : 0,
    storeCount: new Set(
      report.supportDays
        .filter((row) => row.status !== 'missing')
        .map((row) => row.storeNumber),
    ).size,
  };
}

export function storeSummaries(
  report: QuividiCampaignReport,
): MarketingStoreSummary[] {
  const keys = new Map<string, QuividiSupportDay[]>();
  for (const row of report.supportDays) {
    const current = keys.get(row.storeNumber) ?? [];
    current.push(row);
    keys.set(row.storeNumber, current);
  }

  return Array.from(keys, ([storeNumber, rows]) => {
    const hourly = report.supportHours.filter(
      (row) => row.storeNumber === storeNumber,
    );
    const measured = rows.filter((row) => row.status !== 'missing').length;
    const aggregated = aggregateRows(rows);
    return {
      storeNumber,
      storeName: rows[0]?.storeName ?? '',
      supports: Array.from(new Set(rows.map((row) => row.support))).sort((a, b) =>
        a.localeCompare(b, 'es'),
      ),
      ...aggregated,
      measurementPercent: rows.length > 0 ? (measured / rows.length) * 100 : 0,
      bestWeekday: bestWeekday(hourly),
      bestHour: bestHour(hourly),
    };
  }).sort((a, b) => b.ots - a.ots);
}

export function dailySummaries(
  report: QuividiCampaignReport,
): MarketingDailySummary[] {
  const groups = new Map<string, QuividiSupportDay[]>();
  for (const row of report.supportDays) {
    const current = groups.get(row.date) ?? [];
    current.push(row);
    groups.set(row.date, current);
  }
  return Array.from(groups, ([date, rows]) => {
    const aggregated = aggregateRows(rows);
    return {
      date,
      ots: aggregated.ots,
      watchers: aggregated.watchers,
      attentionRate: aggregated.attentionRate,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export function weekdaySummaries(
  report: QuividiCampaignReport,
): MarketingWeekdaySummary[] {
  const groups = new Map<number, QuividiSupportHour[]>();
  for (const row of report.supportHours) {
    const weekday = dayOfWeek(row.date);
    const current = groups.get(weekday) ?? [];
    current.push(row);
    groups.set(weekday, current);
  }
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const rows = groups.get(weekday) ?? [];
    const aggregated = aggregateRows(rows);
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday] ?? '',
      ots: aggregated.ots,
      watchers: aggregated.watchers,
      attentionRate: aggregated.attentionRate,
    };
  });
}

export function hourSummaries(
  report: QuividiCampaignReport,
): MarketingHourSummary[] {
  const groups = new Map<number, QuividiSupportHour[]>();
  for (const row of report.supportHours) {
    const current = groups.get(row.hour) ?? [];
    current.push(row);
    groups.set(row.hour, current);
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const rows = groups.get(hour) ?? [];
    const aggregated = aggregateRows(rows);
    return {
      hour,
      ots: aggregated.ots,
      watchers: aggregated.watchers,
      attentionRate: aggregated.attentionRate,
    };
  });
}

export function heatmapCells(
  report: QuividiCampaignReport,
): MarketingHeatmapCell[] {
  const groups = new Map<string, QuividiSupportHour[]>();
  for (const row of report.supportHours) {
    const weekday = dayOfWeek(row.date);
    const key = `${weekday}|${row.hour}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  const result: MarketingHeatmapCell[] = [];
  for (const weekday of [1, 2, 3, 4, 5, 6, 0]) {
    for (let hour = 0; hour < 24; hour += 1) {
      const rows = groups.get(`${weekday}|${hour}`) ?? [];
      const aggregated = aggregateRows(rows);
      result.push({
        weekday,
        label: WEEKDAY_LABELS[weekday] ?? '',
        hour,
        ots: aggregated.ots,
        watchers: aggregated.watchers,
      });
    }
  }
  return result;
}

export function peakMoments(
  report: QuividiCampaignReport,
  limit = 3,
): MarketingPeakMoment[] {
  const groups = new Map<string, QuividiSupportHour[]>();
  for (const row of report.supportHours) {
    const key = `${row.date}|${row.hour}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return Array.from(groups, ([key, rows]) => {
    const [date, hourText] = key.split('|');
    const aggregated = aggregateRows(rows);
    return {
      date: date ?? '',
      weekday: WEEKDAY_LABELS[dayOfWeek(date ?? '')] ?? '',
      hour: Number(hourText),
      ots: aggregated.ots,
      watchers: aggregated.watchers,
      attentionRate: aggregated.attentionRate,
    };
  })
    .sort((a, b) => b.ots - a.ots)
    .slice(0, Math.max(0, limit));
}

const TIME_BANDS = [
  { key: 'early', label: 'Madrugada', range: '00:00–06:00', start: 0, end: 6 },
  { key: 'morning', label: 'Mañana', range: '06:00–12:00', start: 6, end: 12 },
  { key: 'midday', label: 'Mediodía', range: '12:00–16:00', start: 12, end: 16 },
  { key: 'afternoon', label: 'Tarde', range: '16:00–20:00', start: 16, end: 20 },
  { key: 'night', label: 'Noche', range: '20:00–24:00', start: 20, end: 24 },
] as const;

export function timeBandSummaries(
  report: QuividiCampaignReport,
): MarketingTimeBandSummary[] {
  const totalOts = report.supportHours.reduce(
    (sum, row) => sum + numeric(row.ots),
    0,
  );
  return TIME_BANDS.map((band) => {
    const rows = report.supportHours.filter(
      (row) => row.hour >= band.start && row.hour < band.end,
    );
    const aggregated = aggregateRows(rows);
    return {
      key: band.key,
      label: band.label,
      range: band.range,
      ots: aggregated.ots,
      watchers: aggregated.watchers,
      share: totalOts > 0 ? (aggregated.ots / totalOts) * 100 : 0,
    };
  }).filter((band) => band.ots > 0 || band.key !== 'early');
}

function demographicSummaries(
  rows: readonly QuividiDemographicRow[],
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): MarketingDemographicSummary[] {
  const groups = new Map<number, number>();
  for (const row of rows) {
    const key = row[field];
    groups.set(key, (groups.get(key) ?? 0) + numeric(row.watchers));
  }
  const total = Array.from(groups.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(groups, ([key, watchers]) => ({
    key,
    label: labels[key] ?? `Código ${key}`,
    watchers,
    share: total > 0 ? (watchers / total) * 100 : 0,
  })).sort((a, b) => b.watchers - a.watchers);
}

export function genderSummaries(
  report: QuividiCampaignReport,
  labels: Readonly<Record<number, string>>,
): MarketingDemographicSummary[] {
  return demographicSummaries(report.demographics, 'gender', labels);
}

export function ageSummaries(
  report: QuividiCampaignReport,
  labels: Readonly<Record<number, string>>,
): MarketingDemographicSummary[] {
  return demographicSummaries(report.demographics, 'age', labels);
}

export function qualitySummary(
  report: QuividiCampaignReport,
): MarketingQualitySummary {
  return report.supportDays.reduce<MarketingQualitySummary>(
    (result, row) => {
      result[row.status] += 1;
      return result;
    },
    { complete: 0, partial: 0, missing: 0 },
  );
}

export function hourRange(hour: number | null): string {
  if (hour == null || !Number.isInteger(hour)) return '—';
  const start = String(hour).padStart(2, '0');
  const end = String((hour + 1) % 24).padStart(2, '0');
  return `${start}:00–${end}:00`;
}
