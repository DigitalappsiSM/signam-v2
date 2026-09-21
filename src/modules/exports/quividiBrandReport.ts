import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  type QuividiCampaignReport,
  type QuividiCameraDay,
  type QuividiSupportDay,
} from '@/domain';

/**
 * Capa pura del informe comercial de audiencia.
 *
 * El Excel técnico conserva el detalle original. Este módulo prepara únicamente
 * la vista agregada que se comparte con marcas: OTS, cobertura de tiendas,
 * extrapolación y distribuciones porcentuales de audiencia.
 */

export interface BrandCoverage {
  totalStores: number;
  measuredStores: number;
  estimatedStores: number;
  measuredPercent: number;
  estimatedPercent: number;
}

export interface BrandHeader {
  campaignName: string;
  periodLabel: string;
  days: number;
  totalStores: number;
  measuredStores: number;
  supports: string[];
  storeSupportPairs: number;
}

export interface BrandCampaignSummary {
  measuredOts: number;
  extrapolatedOts: number;
  estimatedOts: number;
  dailyAverage: number;
  dailyPerStore: number;
  dailyPerSupport: number;
  coverage: BrandCoverage;
}

export interface BrandDailyPoint {
  date: string;
  label: string;
  measuredOts: number;
  estimatedOts: number;
}

export interface BrandShare {
  label: string;
  share: number;
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isInsurgentes(storeName: string): boolean {
  return normalize(storeName).includes('INSURGENTES');
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + numeric(value), 0);
}

function selectedCameraRows(rows: readonly QuividiCameraDay[]): QuividiCameraDay[] {
  const complete = rows.filter((row) => row.status === 'complete');
  if (complete.length > 0) return complete;
  return rows.filter((row) => row.status === 'partial');
}

function pairKey(row: Pick<QuividiSupportDay, 'storeNumber' | 'support'>): string {
  return `${row.storeNumber}|${row.support}`;
}

function supportDayKey(
  row: Pick<QuividiSupportDay, 'date' | 'storeNumber' | 'support'>,
): string {
  return `${row.date}|${row.storeNumber}|${row.support}`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/** `2026-08-11` -> `11/08/2026`. Fechas civiles, sin zona horaria. */
export function formatCivilDate(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** Días naturales cubiertos por la vigencia, ambos extremos incluidos. */
export function periodDays(report: QuividiCampaignReport): number {
  const start = Date.parse(`${report.startDate}T12:00:00Z`);
  const end = Date.parse(`${report.endDate}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Mantiene la agregación vigente de tienda + soporte para todo el circuito.
 * Únicamente Insurgentes se corrige para el informe comercial: sus cámaras se
 * encuentran en pisos distintos, por lo que sus OTS se suman como zonas
 * independientes en lugar de promediarse.
 */
export function brandSupportDays(report: QuividiCampaignReport): QuividiSupportDay[] {
  if (report.cameraDays.length === 0) return report.supportDays.map((row) => ({ ...row }));

  const camerasByKey = new Map<string, QuividiCameraDay[]>();
  for (const camera of report.cameraDays) {
    if (!isInsurgentes(camera.storeName)) continue;
    const key = `${camera.date}|${camera.storeNumber}|${camera.support}`;
    const current = camerasByKey.get(key) ?? [];
    current.push(camera);
    camerasByKey.set(key, current);
  }

  return report.supportDays.map((row) => {
    if (!isInsurgentes(row.storeName)) return { ...row };
    const selected = selectedCameraRows(camerasByKey.get(supportDayKey(row)) ?? []);
    if (selected.length === 0) return { ...row };
    return {
      ...row,
      measuredCameras: selected.length,
      ots: sum(selected.map((camera) => camera.ots)),
      effectiveOts: sum(selected.map((camera) => camera.effectiveOts)),
    };
  });
}

/** Cobertura por tienda, no por cámara ni por tienda-soporte. */
export function brandCoverage(report: QuividiCampaignReport): BrandCoverage {
  const measuredFromRows = new Set(
    report.supportDays
      .filter((row) => row.status !== 'missing')
      .map((row) => row.storeNumber),
  ).size;

  const totalStores = Math.max(
    report.storeCoverage?.totalStores ?? 0,
    report.storeCoverage?.mappedStores ?? 0,
    measuredFromRows,
  );
  const measuredStores = Math.min(
    totalStores,
    Math.max(report.storeCoverage?.mappedStores ?? 0, measuredFromRows),
  );
  const estimatedStores = Math.max(0, totalStores - measuredStores);
  const measuredPercent = totalStores > 0 ? (measuredStores / totalStores) * 100 : 0;

  return {
    totalStores,
    measuredStores,
    estimatedStores,
    measuredPercent,
    estimatedPercent: totalStores > 0 ? 100 - measuredPercent : 0,
  };
}

export function brandHeader(report: QuividiCampaignReport): BrandHeader {
  const adjusted = brandSupportDays(report);
  const coverage = brandCoverage(report);
  const supports = Array.from(
    new Set(adjusted.map((row) => row.support).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'es'));
  const measuredPairs = new Set(
    adjusted.filter((row) => row.status !== 'missing').map(pairKey),
  ).size;

  return {
    campaignName: report.campaignName,
    periodLabel: `${formatCivilDate(report.startDate)} - ${formatCivilDate(report.endDate)}`,
    days: periodDays(report),
    totalStores: coverage.totalStores,
    measuredStores: coverage.measuredStores,
    supports,
    storeSupportPairs: Math.max(report.coverage.totalPairs, measuredPairs),
  };
}

/**
 * Extrapolación comercial: el promedio de OTS por tienda medida durante la
 * vigencia se aplica únicamente a las tiendas del universo sin cobertura.
 */
export function brandCampaignSummary(
  report: QuividiCampaignReport,
): BrandCampaignSummary {
  const rows = brandSupportDays(report);
  const coverage = brandCoverage(report);
  const measuredOts = sum(rows.map((row) => row.ots));
  const averagePerMeasuredStore =
    coverage.measuredStores > 0 ? measuredOts / coverage.measuredStores : 0;
  const extrapolatedOts = averagePerMeasuredStore * coverage.estimatedStores;
  const estimatedOts = measuredOts + extrapolatedOts;
  const days = periodDays(report);
  const totalPairs = Math.max(
    report.coverage.totalPairs,
    new Set(rows.map(pairKey)).size,
  );

  return {
    measuredOts,
    extrapolatedOts,
    estimatedOts,
    dailyAverage: days > 0 ? estimatedOts / days : 0,
    dailyPerStore:
      days > 0 && coverage.totalStores > 0
        ? estimatedOts / days / coverage.totalStores
        : 0,
    dailyPerSupport:
      days > 0 && totalPairs > 0 ? estimatedOts / days / totalPairs : 0,
    coverage,
  };
}

/** Evolución diaria agregada; nunca expone una tienda individual. */
export function brandDaily(report: QuividiCampaignReport): BrandDailyPoint[] {
  const rows = brandSupportDays(report);
  const coverage = brandCoverage(report);
  const factor =
    coverage.measuredStores > 0
      ? coverage.totalStores / coverage.measuredStores
      : 1;
  const groups = new Map<string, number>();

  for (const row of rows) {
    groups.set(row.date, (groups.get(row.date) ?? 0) + numeric(row.ots));
  }

  return Array.from(groups, ([date, measuredOts]) => ({
    date,
    label: date.slice(8, 10),
    measuredOts,
    estimatedOts: measuredOts * factor,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function shareBy(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): BrandShare[] {
  const groups = new Map<number, number>();
  for (const row of report.demographics) {
    groups.set(row[field], (groups.get(row[field]) ?? 0) + numeric(row.watchers));
  }
  const total = sum(Array.from(groups.values()));
  return Array.from(groups, ([key, count]) => ({
    label: labels[key] ?? `Código ${key}`,
    share: total > 0 ? (count / total) * 100 : 0,
  }))
    .filter((item) => item.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** Distribución porcentual de género; no expone conteos absolutos. */
export function brandGender(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'gender', QUIVIDI_GENDER_LABELS);
}

/** Distribución porcentual de edad; no expone conteos absolutos. */
export function brandAge(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'age', QUIVIDI_AGE_LABELS);
}
