import type { jsPDF } from 'jspdf';
import type {
  QuividiCampaignReport,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';
import instoreLogoUrl from '@/assets/brand/instore-media.png';
import liverpoolLogoUrl from '@/assets/ppt/liverpool.png';
import {
  LIVERPOOL_BANNER_REPORT_IMAGE,
  LIVERPOOL_MUPI_REPORT_IMAGE,
} from '@/assets/reports/liverpoolReportImages';

/**
 * PDF comercial de audiencia para marcas.
 *
 * Reglas:
 * - no identifica proveedores/plataformas internas;
 * - no expone métricas internas de mirada ni ratios derivados;
 * - no muestra rendimiento individual, rankings ni tráfico por tienda;
 * - presenta OTS agregado, cobertura de medición y extrapolación transparente;
 * - mantiene la ponderación multi-punto existente, salvo Insurgentes, cuyos
 *   dos puntos de medición están en pisos distintos y se consideran zonas
 *   independientes para OTS;
 * - la segmentación de audiencia se comunica únicamente como porcentajes.
 */

type RGB = readonly [number, number, number];

const NAVY: RGB = [17, 38, 83];
const BLUE: RGB = [0, 126, 210];
const BLUE_2: RGB = [75, 169, 229];
const BLUE_3: RGB = [151, 205, 239];
const BLUE_4: RGB = [205, 229, 245];
const PINK: RGB = [225, 0, 126];
const INK: RGB = [28, 35, 49];
const MUTED: RGB = [94, 110, 132];
const HAIR: RGB = [224, 232, 240];
const SOFT: RGB = [244, 248, 252];
const WHITE: RGB = [255, 255, 255];
const GRAY: RGB = [196, 207, 219];

const M = 15;
const PAGE_W = 210;
const PAGE_H = 297;

interface PdfAssets {
  instoreLogo: string | null;
  liverpoolLogo: string | null;
}

export interface BrandCampaignMetrics {
  actualOts: number;
  extrapolatedOts: number;
  estimatedOts: number;
  measuredStores: number;
  totalStores: number;
  coveragePercent: number;
  days: number;
  dailyAverage: number;
  dailyPerStore: number;
  dailyPerSupport: number;
  supportUnits: number;
}

interface DailyPoint {
  date: string;
  label: string;
  ots: number;
}

interface SharePoint {
  label: string;
  share: number;
}

function fill(doc: jsPDF, color: RGB): void {
  doc.setFillColor(...color);
}

function stroke(doc: jsPDF, color: RGB): void {
  doc.setDrawColor(...color);
}

function ink(doc: jsPDF, color: RGB): void {
  doc.setTextColor(...color);
}

function txt(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: RGB;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    maxWidth?: number;
  } = {},
): void {
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(options.size ?? 9);
  ink(doc, options.color ?? INK);
  doc.text(value, x, y, {
    align: options.align ?? 'left',
    ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
  });
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

function civilDate(value: string): string {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function periodDays(report: QuividiCampaignReport): number {
  const start = Date.parse(`${report.startDate}T12:00:00Z`);
  const end = Date.parse(`${report.endDate}T12:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

function isInsurgentes(storeName: string): boolean {
  return normalize(storeName).includes('INSURGENTES');
}

function measuredSupportRows(report: QuividiCampaignReport): QuividiSupportDay[] {
  return report.supportDays.filter((row) => row.status !== 'missing');
}

/**
 * OTS comercial del día.
 *
 * Para todas las tiendas se conserva el agregado ya calculado por backend.
 * Única excepción: Insurgentes. Sus puntos están en pisos diferentes, por lo
 * que los OTS válidos se suman como zonas independientes.
 */
export function commercialSupportDayOts(
  report: QuividiCampaignReport,
  row: QuividiSupportDay,
): number {
  if (!isInsurgentes(row.storeName)) return numeric(row.ots);

  const cameras = report.cameraDays.filter(
    (camera) =>
      camera.date === row.date &&
      camera.storeNumber === row.storeNumber &&
      camera.support === row.support,
  );
  const complete = cameras.filter((camera) => camera.status === 'complete');
  const partial = cameras.filter((camera) => camera.status === 'partial');
  const selected = complete.length > 0 ? complete : partial;
  if (selected.length === 0) return numeric(row.ots);
  return selected.reduce((total, camera) => total + numeric(camera.ots), 0);
}

function supportActuals(report: QuividiCampaignReport): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of measuredSupportRows(report)) {
    totals.set(
      row.support,
      (totals.get(row.support) ?? 0) + commercialSupportDayOts(report, row),
    );
  }
  return totals;
}

/**
 * Métricas comerciales agregadas usadas por el PDF.
 *
 * La extrapolación se calcula por soporte para no mezclar comportamientos de
 * formatos distintos. En campañas de un único soporte, la cobertura coincide
 * exactamente con tiendas medidas / tiendas de campaña.
 */
export function buildBrandCampaignMetrics(
  report: QuividiCampaignReport,
): BrandCampaignMetrics {
  const rows = measuredSupportRows(report);
  const actualBySupport = supportActuals(report);
  const actualOts = Array.from(actualBySupport.values()).reduce(
    (total, value) => total + value,
    0,
  );

  let extrapolatedOts = 0;
  for (const coverage of report.coverage.bySupport) {
    const actual = actualBySupport.get(coverage.support) ?? 0;
    const mapped = Math.max(0, coverage.mappedPairs);
    const missing = Math.max(0, coverage.totalPairs - mapped);
    const averagePerMappedStore = mapped > 0 ? actual / mapped : 0;
    extrapolatedOts += averagePerMappedStore * missing;
  }

  const measuredStores = new Set(rows.map((row) => row.storeNumber)).size;
  const missingUnits = Math.max(
    0,
    report.coverage.totalPairs - report.coverage.mappedPairs,
  );
  // El payload actual conserva el universo por Tienda+Soporte. Para el PDF
  // comercial se expresa en tiendas; con un único soporte es exacto y, cuando
  // existen varios, nunca se cuenta una cámara como tienda.
  const totalStores = Math.max(measuredStores, measuredStores + missingUnits);
  const coveragePercent =
    totalStores > 0 ? (measuredStores / totalStores) * 100 : 0;
  const estimatedOts = actualOts + extrapolatedOts;
  const days = periodDays(report);
  const supportUnits = Math.max(1, report.coverage.totalPairs);
  const dailyAverage = days > 0 ? estimatedOts / days : 0;

  return {
    actualOts,
    extrapolatedOts,
    estimatedOts,
    measuredStores,
    totalStores,
    coveragePercent,
    days,
    dailyAverage,
    dailyPerStore:
      days > 0 && totalStores > 0 ? estimatedOts / days / totalStores : 0,
    dailyPerSupport: days > 0 ? estimatedOts / days / supportUnits : 0,
    supportUnits,
  };
}

export function buildBrandDailyEstimated(
  report: QuividiCampaignReport,
): DailyPoint[] {
  const byDate = new Map<string, QuividiSupportDay[]>();
  for (const row of measuredSupportRows(report)) {
    const current = byDate.get(row.date) ?? [];
    current.push(row);
    byDate.set(row.date, current);
  }

  return Array.from(byDate, ([date, rows]) => {
    let total = 0;
    for (const coverage of report.coverage.bySupport) {
      const supportRows = rows.filter((row) => row.support === coverage.support);
      const actual = supportRows.reduce(
        (sum, row) => sum + commercialSupportDayOts(report, row),
        0,
      );
      const measured = new Set(supportRows.map((row) => row.storeNumber)).size;
      const missing = Math.max(0, coverage.totalPairs - measured);
      total += actual + (measured > 0 ? (actual / measured) * missing : 0);
    }
    return { date, label: date.slice(8, 10), ots: total };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function genderShares(report: QuividiCampaignReport): SharePoint[] {
  return demographicShares(report, 'gender', {
    0: 'Sin determinar',
    1: 'Masculino',
    2: 'Femenino',
  });
}

function ageShares(report: QuividiCampaignReport): SharePoint[] {
  return demographicShares(report, 'age', {
    0: 'Sin determinar',
    1: '1–15',
    2: '16–30',
    3: '31–65',
    4: '66+',
  });
}

function demographicShares(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Record<number, string>,
): SharePoint[] {
  const totals = new Map<number, number>();
  for (const row of report.demographics) {
    totals.set(row[field], (totals.get(row[field]) ?? 0) + numeric(row.watchers));
  }
  const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(totals, ([key, value]) => ({
    label: labels[key] ?? `Código ${key}`,
    share: total > 0 ? (value / total) * 100 : 0,
  }))
    .filter((item) => item.share > 0)
    .sort((a, b) => b.share - a.share);
}

function hourInWindow(row: QuividiSupportHour): boolean {
  const extended = normalize(row.storeName).includes('POLANCO');
  return row.hour >= (extended ? 8 : 10) && row.hour < 22;
}

function dayPartShares(report: QuividiCampaignReport): SharePoint[] {
  const parts = [
    { label: 'Mañana', start: 8, end: 12 },
    { label: 'Tarde', start: 12, end: 18 },
    { label: 'Noche', start: 18, end: 22 },
  ];
  const rows = report.supportHours.filter(hourInWindow);
  const values = parts.map((part) => ({
    label: part.label,
    value: rows
      .filter((row) => row.hour >= part.start && row.hour < part.end)
      .reduce((sum, row) => sum + numeric(row.ots), 0),
  }));
  const total = values.reduce((sum, item) => sum + item.value, 0);
  return values
    .map((item) => ({
      label: item.label,
      share: total > 0 ? (item.value / total) * 100 : 0,
    }))
    .filter((item) => item.share > 0);
}

async function loadAsset(url: string): Promise<string | null> {
  try {
    if (typeof fetch !== 'function' || typeof FileReader === 'undefined') {
      return null;
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadAssets(): Promise<PdfAssets> {
  const [instoreLogo, liverpoolLogo] = await Promise.all([
    loadAsset(instoreLogoUrl),
    loadAsset(liverpoolLogoUrl),
  ]);
  return { instoreLogo, liverpoolLogo };
}

function addLogo(
  doc: jsPDF,
  assets: PdfAssets,
  x: number,
  y: number,
  maxW: number,
): void {
  if (assets.instoreLogo) {
    try {
      doc.addImage(assets.instoreLogo, 'PNG', x, y, maxW, 8, undefined, 'FAST');
      return;
    } catch {
      // Fallback tipográfico: el reporte debe seguir generándose.
    }
  }
  txt(doc, 'in-Store Media', x, y + 5.5, { size: 11, bold: true, color: INK });
}

function addLiverpoolMark(
  doc: jsPDF,
  assets: PdfAssets,
  x: number,
  y: number,
  maxW = 22,
): void {
  if (assets.liverpoolLogo) {
    try {
      doc.addImage(assets.liverpoolLogo, 'PNG', x, y, maxW, 6, undefined, 'FAST');
      return;
    } catch {
      // Fallback tipográfico.
    }
  }
  txt(doc, 'Liverpool', x, y + 4, { size: 8, bold: true, color: PINK });
}

function header(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
  page: number,
): number {
  addLogo(doc, assets, M, 8, 52);
  txt(doc, 'REPORTE DE CAMPAÑA', PAGE_W - M, 10, {
    size: 6.5,
    color: MUTED,
    align: 'right',
  });
  txt(doc, civilDate(report.endDate), PAGE_W - M, 14, {
    size: 6.5,
    color: MUTED,
    align: 'right',
  });
  stroke(doc, HAIR);
  doc.setLineWidth(0.25);
  doc.line(M, 20, PAGE_W - M, 20);
  txt(doc, String(page).padStart(2, '0'), PAGE_W - M, PAGE_H - 9, {
    size: 7,
    bold: true,
    color: NAVY,
    align: 'right',
  });
  return 28;
}

function footer(doc: jsPDF): void {
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(M, PAGE_H - 16, PAGE_W - M, PAGE_H - 16);
  txt(doc, 'in-Store Media', M, PAGE_H - 10, { size: 6.2, bold: true });
  txt(doc, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.', M + 27, PAGE_H - 10, {
    size: 5.7,
    color: MUTED,
  });
}

function sectionLabel(doc: jsPDF, label: string, y: number): number {
  txt(doc, label.toUpperCase(), M, y, { size: 6.2, bold: true, color: BLUE });
  return y + 8;
}

function title(doc: jsPDF, value: string, y: number): number {
  txt(doc, value, M, y, { size: 19, bold: true, color: NAVY });
  return y + 8;
}

function card(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  fill(doc, SOFT);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
  txt(doc, label, x + 5, y + 7, { size: 7, bold: true, color: MUTED });
  txt(doc, value, x + 5, y + 17, { size: 16, bold: true, color: BLUE });
}

function infoBox(doc: jsPDF, y: number, value: string): void {
  fill(doc, [235, 246, 253]);
  doc.roundedRect(M, y, PAGE_W - 2 * M, 18, 2.5, 2.5, 'F');
  fill(doc, BLUE);
  doc.circle(M + 6, y + 9, 2.7, 'F');
  txt(doc, 'i', M + 6, y + 10.2, {
    size: 7,
    bold: true,
    color: WHITE,
    align: 'center',
  });
  txt(doc, value, M + 12, y + 6.5, {
    size: 6.6,
    color: MUTED,
    maxWidth: PAGE_W - 2 * M - 18,
  });
}

function drawPie(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  parts: readonly SharePoint[],
  colors: readonly RGB[],
  donut = false,
): void {
  const total = parts.reduce((sum, part) => sum + part.share, 0) || 1;
  let angle = -Math.PI / 2;
  parts.forEach((part, index) => {
    const sweep = (part.share / total) * Math.PI * 2;
    const steps = Math.max(3, Math.ceil((sweep / (Math.PI * 2)) * 72));
    fill(doc, colors[index % colors.length] ?? BLUE);
    for (let step = 0; step < steps; step += 1) {
      const a1 = angle + (sweep * step) / steps;
      const a2 = angle + (sweep * (step + 1)) / steps;
      doc.triangle(
        cx,
        cy,
        cx + Math.cos(a1) * radius,
        cy + Math.sin(a1) * radius,
        cx + Math.cos(a2) * radius,
        cy + Math.sin(a2) * radius,
        'F',
      );
    }
    angle += sweep;
  });
  if (donut) {
    fill(doc, WHITE);
    doc.circle(cx, cy, radius * 0.58, 'F');
  }
}

function pieLegend(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  parts: readonly SharePoint[],
  colors: readonly RGB[],
): void {
  parts.forEach((part, index) => {
    const rowY = y + index * 6;
    fill(doc, colors[index % colors.length] ?? BLUE);
    doc.circle(x + 1.6, rowY - 1, 1.3, 'F');
    txt(doc, part.label, x + 5, rowY, {
      size: 6.2,
      color: MUTED,
      maxWidth: width - 22,
    });
    txt(doc, formatPercent(part.share), x + width, rowY, {
      size: 6.2,
      bold: true,
      color: INK,
      align: 'right',
    });
  });
}

function lineChart(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  points: readonly DailyPoint[],
): void {
  const max = Math.max(1, ...points.map((point) => point.ots));
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  for (let tick = 0; tick <= 4; tick += 1) {
    const ty = y + h - (h * tick) / 4;
    doc.line(x, ty, x + w, ty);
    txt(doc, formatCount((max * tick) / 4), x - 2, ty + 1.2, {
      size: 5.7,
      color: MUTED,
      align: 'right',
    });
  }
  if (points.length === 0) return;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  stroke(doc, BLUE);
  doc.setLineWidth(0.8);
  points.forEach((point, index) => {
    const px = x + step * index;
    const py = y + h - (point.ots / max) * h;
    if (index > 0) {
      const previous = points[index - 1]!;
      doc.line(
        x + step * (index - 1),
        y + h - (previous.ots / max) * h,
        px,
        py,
      );
    }
    fill(doc, WHITE);
    doc.circle(px, py, 1.5, 'F');
    stroke(doc, BLUE);
    doc.circle(px, py, 1.5);
  });
  const indices = new Set([
    0,
    Math.floor((points.length - 1) / 3),
    Math.floor(((points.length - 1) * 2) / 3),
    points.length - 1,
  ]);
  indices.forEach((index) => {
    const point = points[index];
    if (!point) return;
    txt(doc, point.label, x + step * index, y + h + 5, {
      size: 5.8,
      color: MUTED,
      align: 'center',
    });
  });
}

function coverPage(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
  metrics: BrandCampaignMetrics,
): void {
  fill(doc, WHITE);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  addLogo(doc, assets, M, 14, 60);
  fill(doc, PINK);
  doc.rect(M, 31, 18, 0.9, 'F');
  txt(doc, 'REPORTE DE CAMPAÑA', M, 38, { size: 6.5, bold: true, color: MUTED });
  txt(doc, 'Reporte de Audiencia', M, 54, { size: 22, bold: true, color: NAVY });
  txt(doc, 'y Resultados de Campaña', M, 65, {
    size: 22,
    bold: true,
    color: NAVY,
  });
  txt(doc, 'Conectando marcas con personas', M, 76, {
    size: 9,
    color: MUTED,
  });
  txt(doc, 'en el momento real.', M, 82, { size: 9, color: MUTED });

  const meta = [
    ['Marca', report.campaignName],
    ['Retailer', 'Liverpool'],
    ['Periodo', `${civilDate(report.startDate)} – ${civilDate(report.endDate)}`],
    ['Formato', 'Pantallas In-Store'],
    ['Tiendas', `${metrics.totalStores} tiendas`],
  ];
  let y = 105;
  for (const [label, value] of meta) {
    fill(doc, BLUE);
    doc.circle(M + 2.5, y - 2.3, 2.4, 'F');
    txt(doc, label ?? '', M + 9, y - 1, { size: 7, bold: true, color: NAVY });
    txt(doc, value ?? '', M + 9, y + 4, { size: 7, color: MUTED, maxWidth: 70 });
    y += 17;
  }

  // Fotografía real del circuito Liverpool aprobada para el reporte.
  fill(doc, [247, 248, 250]);
  doc.rect(112, 0, 98, PAGE_H, 'F');
  try {
    doc.addImage(
      LIVERPOOL_MUPI_REPORT_IMAGE,
      'JPEG',
      112,
      35,
      98,
      205,
      undefined,
      'FAST',
    );
  } catch {
    fill(doc, [236, 239, 243]);
    doc.rect(121, 45, 72, 170, 'F');
    addLiverpoolMark(doc, assets, 143, 120, 26);
  }
  // Corte editorial blanco + acentos rosas discretos de partnership.
  fill(doc, WHITE);
  doc.triangle(112, 0, 134, 0, 112, 88, 'F');
  doc.triangle(112, 240, 142, PAGE_H, 112, PAGE_H, 'F');
  fill(doc, PINK);
  doc.triangle(104, 151, 112, 132, 112, 232, 'F');
  fill(doc, [255, 181, 220]);
  doc.triangle(108, 194, 112, 181, 112, 250, 'F');

  fill(doc, PINK);
  doc.rect(M, 260, 18, 0.8, 'F');
  txt(doc, 'AUDIENCIAS REALES.', M, 269, { size: 6.2, bold: true, color: NAVY });
  txt(doc, 'OPORTUNIDADES REALES.', M, 275, { size: 6.2, bold: true, color: NAVY });
  txt(doc, '01', PAGE_W - M, PAGE_H - 9, {
    size: 7,
    bold: true,
    color: NAVY,
    align: 'right',
  });
}

function summaryPage(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
  metrics: BrandCampaignMetrics,
): void {
  let y = header(doc, assets, report, 2);
  y = sectionLabel(doc, '01. RESUMEN', y);
  y = title(doc, 'Resumen Ejecutivo', y);
  txt(
    doc,
    'La campaña generó una audiencia significativa en el entorno In-Store, con resultados agregados y una cobertura de medición claramente identificada.',
    M,
    y,
    { size: 7.3, color: MUTED, maxWidth: 165 },
  );

  const w = 84;
  card(doc, M, 58, w, 30, 'OTS estimados campaña', formatCount(metrics.estimatedOts));
  card(doc, M + w + 6, 58, w, 30, 'OTS promedio diario', formatCount(metrics.dailyAverage));
  card(doc, M, 94, w, 30, 'OTS promedio diario / tienda', formatCount(metrics.dailyPerStore));
  card(doc, M + w + 6, 94, w, 30, 'OTS promedio diario / soporte', formatCount(metrics.dailyPerSupport));
  card(doc, M, 130, 174, 30, 'Cobertura de medición', formatPercent(metrics.coveragePercent));

  const estimatedShare = Math.max(0, 100 - metrics.coveragePercent);
  infoBox(
    doc,
    170,
    `${metrics.measuredStores} de ${metrics.totalStores} tiendas cuentan con medición directa. El ${formatPercent(estimatedShare)} restante se estima a partir del promedio de OTS observado durante el mismo periodo de campaña.`,
  );

  txt(doc, 'Datos directos', M, 207, { size: 7, bold: true, color: NAVY });
  txt(doc, formatCount(metrics.actualOts), M, 218, { size: 15, bold: true, color: BLUE });
  txt(doc, 'OTS observados', M, 224, { size: 6.3, color: MUTED });

  txt(doc, 'Estimación complementaria', 78, 207, {
    size: 7,
    bold: true,
    color: NAVY,
  });
  txt(doc, formatCount(metrics.extrapolatedOts), 78, 218, {
    size: 15,
    bold: true,
    color: BLUE,
  });
  txt(doc, 'OTS extrapolados', 78, 224, { size: 6.3, color: MUTED });

  txt(doc, 'Universo de campaña', 151, 207, { size: 7, bold: true, color: NAVY });
  txt(doc, `${metrics.totalStores}`, 151, 218, {
    size: 15,
    bold: true,
    color: BLUE,
  });
  txt(doc, 'tiendas', 151, 224, { size: 6.3, color: MUTED });

  footer(doc);
}

function coveragePage(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
  metrics: BrandCampaignMetrics,
): void {
  let y = header(doc, assets, report, 3);
  y = sectionLabel(doc, '02. COBERTURA Y EVOLUCIÓN', y);
  y = title(doc, 'Cobertura y Evolución de OTS', y);
  txt(
    doc,
    'La cobertura distingue los datos directos de la estimación complementaria y la evolución diaria se presenta de forma agregada para toda la campaña.',
    M,
    y,
    { size: 7.2, color: MUTED, maxWidth: 170 },
  );

  fill(doc, SOFT);
  doc.roundedRect(M, 62, 76, 112, 3, 3, 'F');
  txt(doc, 'Cobertura de medición', M + 6, 72, { size: 8, bold: true, color: NAVY });
  const real = metrics.coveragePercent;
  const extrapolated = Math.max(0, 100 - real);
  drawPie(
    doc,
    M + 38,
    111,
    24,
    [
      { label: 'Datos directos', share: real },
      { label: 'Extrapolado', share: extrapolated },
    ],
    [BLUE, GRAY],
    true,
  );
  txt(doc, formatPercent(real), M + 38, 109, {
    size: 15,
    bold: true,
    color: BLUE,
    align: 'center',
  });
  txt(doc, 'datos directos', M + 38, 116, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });
  pieLegend(
    doc,
    M + 9,
    150,
    58,
    [
      { label: 'Datos directos', share: real },
      { label: 'Extrapolado', share: extrapolated },
    ],
    [BLUE, GRAY],
  );

  fill(doc, SOFT);
  doc.roundedRect(97, 62, 98, 112, 3, 3, 'F');
  txt(doc, 'OTS diarios', 103, 72, { size: 8, bold: true, color: NAVY });
  lineChart(doc, 114, 84, 72, 64, buildBrandDailyEstimated(report));

  infoBox(
    doc,
    184,
    'Los resultados extrapolados complementan el universo de campaña sin exponer el desempeño individual por tienda.',
  );

  txt(doc, 'Lectura de cobertura', M, 223, { size: 8, bold: true, color: NAVY });
  txt(
    doc,
    'La estimación usa exclusivamente el comportamiento promedio observado en las tiendas con medición durante las mismas fechas. No utiliza históricos de otras campañas ni rankings de sucursales.',
    M,
    231,
    { size: 7, color: MUTED, maxWidth: 175 },
  );

  footer(doc);
}

function audiencePanel(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  titleText: string,
  parts: SharePoint[],
  colors: readonly RGB[],
): void {
  fill(doc, SOFT);
  doc.roundedRect(x, y, w, 142, 3, 3, 'F');
  txt(doc, titleText, x + w / 2, y + 11, {
    size: 8,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  drawPie(doc, x + w / 2, y + 57, 26, parts, colors);
  pieLegend(doc, x + 8, y + 99, w - 16, parts.slice(0, 5), colors);
}

function audiencePage(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
): void {
  let y = header(doc, assets, report, 4);
  y = sectionLabel(doc, '03. AUDIENCIA', y);
  y = title(doc, 'Segmentos de Audiencia', y);
  txt(
    doc,
    'Las distribuciones se presentan exclusivamente como porcentajes agregados de la audiencia observada durante la campaña.',
    M,
    y,
    { size: 7.2, color: MUTED, maxWidth: 170 },
  );

  const gender = genderShares(report);
  const age = ageShares(report);
  const dayParts = dayPartShares(report);
  const colors = [BLUE, BLUE_2, BLUE_3, BLUE_4, GRAY] as const;

  audiencePanel(doc, M, 62, 56, 'Género', gender, colors);
  audiencePanel(doc, M + 62, 62, 56, 'Rango de edad', age, colors);
  audiencePanel(doc, M + 124, 62, 56, 'Momento del día', dayParts, colors);

  infoBox(
    doc,
    214,
    'Distribuciones porcentuales de audiencia observada durante el periodo de campaña. No se muestran volúmenes absolutos por segmento.',
  );

  footer(doc);
}

function methodologyPage(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
  metrics: BrandCampaignMetrics,
): void {
  let y = header(doc, assets, report, 5);
  y = sectionLabel(doc, '04. METODOLOGÍA', y);
  y = title(doc, 'Metodología', y);
  txt(
    doc,
    'El reporte combina medición directa y estimaciones transparentes para ofrecer una visión agregada y representativa del desempeño de la campaña.',
    M,
    y,
    { size: 7.2, color: MUTED, maxWidth: 170 },
  );

  const notes = [
    'La cobertura se calcula sobre el universo de tiendas de la campaña.',
    'Cuando una tienda no cuenta con medición directa, su aportación se estima con el promedio de OTS observado durante las mismas fechas de campaña.',
    'El reporte presenta métricas agregadas de audiencia y no incluye métricas internas ni desempeño individual por tienda.',
    'Insurgentes se trata como caso especial: sus dos puntos de medición están en pisos distintos, por lo que sus OTS se consideran zonas independientes.',
    'La metodología evita rankings de sucursales y mantiene visible qué parte del resultado procede de datos directos y qué parte es estimada.',
  ];

  let cursor = 70;
  notes.forEach((note, index) => {
    fill(doc, BLUE);
    doc.circle(M + 4, cursor - 2, 4, 'F');
    txt(doc, String(index + 1), M + 4, cursor - 0.6, {
      size: 7,
      bold: true,
      color: WHITE,
      align: 'center',
    });
    txt(doc, note, M + 12, cursor, {
      size: 7,
      color: index === 3 ? NAVY : MUTED,
      bold: index === 3,
      maxWidth: 104,
    });
    const lines = doc.splitTextToSize(note, 104).length as number;
    cursor += Math.max(16, lines * 4.2 + 6);
  });

  fill(doc, [235, 246, 253]);
  doc.roundedRect(134, 70, 61, 76, 3, 3, 'F');
  txt(doc, 'Fórmulas principales', 140, 82, { size: 8, bold: true, color: BLUE });
  txt(doc, 'OTS estimados =', 164.5, 98, {
    size: 7,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  txt(doc, 'OTS directos + OTS extrapolados', 164.5, 105, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });
  stroke(doc, HAIR);
  doc.line(141, 114, 188, 114);
  txt(doc, 'Cobertura =', 164.5, 125, {
    size: 7,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  txt(doc, 'tiendas con medición / tiendas de campaña', 164.5, 133, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });

  // Cierre con la fotografía real del banner Liverpool; los shoppers de la
  // imagen fuente ya están difuminados para el uso en reporte.
  try {
    doc.addImage(
      LIVERPOOL_BANNER_REPORT_IMAGE,
      'JPEG',
      134,
      156,
      61,
      74,
      undefined,
      'FAST',
    );
  } catch {
    fill(doc, [253, 241, 248]);
    doc.roundedRect(134, 156, 61, 74, 3, 3, 'F');
    addLiverpoolMark(doc, assets, 151, 166, 27);
  }
  fill(doc, PINK);
  doc.triangle(132, 230, 145, 202, 145, 230, 'F');
  fill(doc, WHITE);
  doc.roundedRect(143, 215, 46, 11, 2, 2, 'F');
  txt(doc, `${formatPercent(metrics.coveragePercent)} cobertura directa`, 166, 222, {
    size: 6.4,
    bold: true,
    color: NAVY,
    align: 'center',
  });

  footer(doc);
}

/** Genera el informe comercial de audiencia y lo devuelve como Blob. */
export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const assets = await loadAssets();
  const metrics = buildBrandCampaignMetrics(report);
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });

  coverPage(doc, assets, report, metrics);
  doc.addPage();
  summaryPage(doc, assets, report, metrics);
  doc.addPage();
  coveragePage(doc, assets, report, metrics);
  doc.addPage();
  audiencePage(doc, assets, report);
  doc.addPage();
  methodologyPage(doc, assets, report, metrics);

  return doc.output('blob');
}

/** Nombre del archivo, sin referencias a plataformas internas. */
export function quividiCampaignPdfFileName(
  report: QuividiCampaignReport,
): string {
  const safe = report.campaignName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `Audiencia_${safe || 'campana'}_${report.startDate}_${report.endDate}.pdf`;
}
