import type { QuividiCampaignReport } from '@/domain';
import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
} from '@/domain';

export interface AudienceShare {
  label: string;
  share: number;
}

export interface CampaignAudienceSummary {
  realOts: number;
  extrapolatedOts: number;
  estimatedOts: number;
  totalStores: number;
  measuredStores: number;
  estimatedStores: number;
  coveragePercent: number;
  measuredDays: number;
  totalSupportPairs: number;
  averageDailyOts: number;
  averageDailyPerStore: number;
  averageDailyPerSupport: number;
}

export interface DailyEstimatedOts {
  date: string;
  ots: number;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function uniqueStoreKey(storeNumber: string, storeName: string): string {
  return storeNumber.trim() || storeName.trim().toUpperCase();
}

function civilDaysInclusive(start: string, end: string): number {
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${end}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1;
  return Math.floor((to - from) / 86_400_000) + 1;
}

function measuredStoreCount(report: QuividiCampaignReport): number {
  if (typeof report.coverage.mappedStores === 'number') {
    return report.coverage.mappedStores;
  }
  return new Set(
    report.supportDays.map((row) => uniqueStoreKey(row.storeNumber, row.storeName)),
  ).size;
}

function totalStoreCount(report: QuividiCampaignReport): number {
  if (typeof report.coverage.totalStores === 'number') {
    return report.coverage.totalStores;
  }
  return measuredStoreCount(report);
}

function measuredDayCount(report: QuividiCampaignReport): number {
  const dates = new Set(report.supportDays.map((row) => row.date));
  return dates.size || civilDaysInclusive(report.startDate, report.endDate);
}

export function campaignAudienceSummary(
  report: QuividiCampaignReport,
): CampaignAudienceSummary {
  const measuredStores = measuredStoreCount(report);
  const totalStores = Math.max(totalStoreCount(report), measuredStores);
  const estimatedStores = Math.max(0, totalStores - measuredStores);
  const realOts = report.supportDays.reduce(
    (sum, row) => sum + numeric(row.ots),
    0,
  );
  const averagePerMeasuredStore =
    measuredStores > 0 ? realOts / measuredStores : 0;
  const extrapolatedOts = averagePerMeasuredStore * estimatedStores;
  const estimatedOts = realOts + extrapolatedOts;
  const measuredDays = measuredDayCount(report);
  const totalSupportPairs = Math.max(
    1,
    report.coverage.totalPairs ||
      new Set(
        report.supportDays.map(
          (row) =>
            `${uniqueStoreKey(row.storeNumber, row.storeName)}|${row.support}`,
        ),
      ).size,
  );
  const averageDailyOts = measuredDays > 0 ? estimatedOts / measuredDays : 0;

  return {
    realOts,
    extrapolatedOts,
    estimatedOts,
    totalStores,
    measuredStores,
    estimatedStores,
    coveragePercent:
      totalStores > 0 ? (measuredStores / totalStores) * 100 : 0,
    measuredDays,
    totalSupportPairs,
    averageDailyOts,
    averageDailyPerStore:
      totalStores > 0 ? averageDailyOts / totalStores : 0,
    averageDailyPerSupport:
      totalSupportPairs > 0 ? averageDailyOts / totalSupportPairs : 0,
  };
}

export function dailyEstimatedOts(
  report: QuividiCampaignReport,
): DailyEstimatedOts[] {
  const summary = campaignAudienceSummary(report);
  const scale =
    summary.measuredStores > 0
      ? summary.totalStores / summary.measuredStores
      : 0;
  const byDate = new Map<string, number>();
  for (const row of report.supportDays) {
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + numeric(row.ots));
  }
  return Array.from(byDate, ([date, ots]) => ({
    date,
    ots: ots * scale,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function demographicShares(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): AudienceShare[] {
  const counts = new Map<number, number>();
  for (const row of report.demographics) {
    const key = row[field];
    if (key === 0) continue;
    counts.set(key, (counts.get(key) ?? 0) + numeric(row.watchers));
  }
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [];
  return Array.from(counts, ([key, value]) => ({
    label: labels[key] ?? String(key),
    share: (value / total) * 100,
  })).sort((a, b) => b.share - a.share);
}

export function genderAudienceShares(
  report: QuividiCampaignReport,
): AudienceShare[] {
  return demographicShares(report, 'gender', QUIVIDI_GENDER_LABELS);
}

export function ageAudienceShares(
  report: QuividiCampaignReport,
): AudienceShare[] {
  return demographicShares(report, 'age', QUIVIDI_AGE_LABELS);
}

export function dayPartAudienceShares(
  report: QuividiCampaignReport,
): AudienceShare[] {
  const parts = [
    { label: 'Mañana (06:00–12:00)', start: 6, end: 12, value: 0 },
    { label: 'Tarde (12:00–18:00)', start: 12, end: 18, value: 0 },
    { label: 'Noche (18:00–24:00)', start: 18, end: 24, value: 0 },
  ];
  for (const row of report.supportHours) {
    const part = parts.find((item) => row.hour >= item.start && row.hour < item.end);
    if (part) part.value += numeric(row.ots);
  }
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return total > 0
    ? parts.map((part) => ({
        label: part.label,
        share: (part.value / total) * 100,
      }))
    : [];
}

export function reportSupports(report: QuividiCampaignReport): string[] {
  return Array.from(
    new Set(report.coverage.bySupport.map((item) => item.support).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'es'));
}
