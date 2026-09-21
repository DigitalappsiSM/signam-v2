import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import {
  INSTORE_MEDIA_LOGO_DATA_URL,
  LIVERPOOL_LOGO_DATA_URL,
} from '@/assets/ppt/logos';
import {
  ageAudienceShares,
  campaignAudienceSummary,
  dailyEstimatedOts,
  dayPartAudienceShares,
  genderAudienceShares,
  reportSupports,
  type AudienceShare,
} from './quividiClientReport';
import {
  LIVERPOOL_BANNER_METHOD_DATA_URL,
  LIVERPOOL_MUPI_COVER_DATA_URL,
} from './quividiReportPhotos';

/**
 * PDF comercial de audiencia para marcas.
 *
 * Reglas del documento:
 * - resultados agregados de campaña; nunca desglosa rendimiento por tienda;
 * - no publica métricas de mirada ni ratios derivados;
 * - la cobertura comercial se calcula por tiendas;
 * - las tiendas sin medición directa se extrapolan con el promedio observado
 *   por tienda durante las mismas fechas del reporte;
 * - la fuente tecnológica no se comunica al cliente.
 */

type RGB = readonly [number, number, number];

const DEEP: RGB = [18, 50, 122];
const BLUE: RGB = [0, 123, 203];
const PINK: RGB = [229, 0, 126];
const INK: RGB = [19, 31, 55];
const MUTED: RGB = [91, 108, 133];
const HAIR: RGB = [225, 232, 242];
const SOFT: RGB = [245, 249, 253];
const PALE_BLUE: RGB = [232, 244, 252];
const WHITE: RGB = [255, 255, 255];
const GRAY: RGB = [194, 205, 219];
const PIE_COLORS: RGB[] = [
  BLUE,
  [87, 174, 230],
  [142, 198, 235],
  [178, 205, 226],
  [110, 132, 161],
];

const M = 16;

function fill(doc: jsPDF, color: RGB): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

function stroke(doc: jsPDF, color: RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function ink(doc: jsPDF, color: RGB): void {
  doc.setTextColor(color[0], color[1], color[2]);
}

function text(
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
  const lines = options.maxWidth
    ? (doc.splitTextToSize(value, options.maxWidth) as string[])
    : value;
  doc.text(lines, x, y, { align: options.align ?? 'left' });
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function periodLabel(report: QuividiCampaignReport): string {
  const fmt = (iso: string) => {
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  };
  return `${fmt(report.startDate)} – ${fmt(report.endDate)}`;
}

function addBrandHeader(
  doc: jsPDF,
  report: QuividiCampaignReport,
  section: string,
  page: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  fill(doc, DEEP);
  doc.rect(0, 0, pageW, 18, 'F');
  try {
    doc.addImage(INSTORE_MEDIA_LOGO_DATA_URL, 'PNG', M, 4, 38, 8);
  } catch {
    text(doc, 'in-Store Media', M, 10, { size: 9, bold: true, color: WHITE });
  }
  fill(doc, PINK);
  doc.rect(pageW - 47, 0, 1.2, 18, 'F');
  text(doc, 'Reporte de Campaña', pageW - M, 7, {
    size: 6.2,
    color: WHITE,
    align: 'right',
  });
  text(doc, periodLabel(report), pageW - M, 11.5, {
    size: 6.2,
    color: [210, 225, 245],
    align: 'right',
  });
  text(doc, `0${page}. ${section.toUpperCase()}`, M, 28, {
    size: 7,
    bold: true,
    color: DEEP,
  });
  return 34;
}

function footer(doc: jsPDF, page: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(M, pageH - 12, pageW - M, pageH - 12);
  text(doc, 'in-Store Media  |  AUDIENCIAS REALES. OPORTUNIDADES REALES.', M, pageH - 7, {
    size: 6.2,
    color: MUTED,
  });
  text(doc, `0${page}`, pageW - M, pageH - 7, {
    size: 7,
    bold: true,
    color: DEEP,
    align: 'right',
  });
}

function title(
  doc: jsPDF,
  value: string,
  y: number,
  subtitle?: string,
): number {
  text(doc, value, M, y, { size: 18, bold: true, color: INK });
  if (subtitle) {
    text(doc, subtitle, M, y + 7, { size: 8, color: MUTED, maxWidth: 176 });
    return y + 17;
  }
  return y + 10;
}

function infoBox(doc: jsPDF, value: string, x: number, y: number, w: number): void {
  fill(doc, PALE_BLUE);
  doc.roundedRect(x, y, w, 18, 2, 2, 'F');
  fill(doc, BLUE);
  doc.circle(x + 6, y + 9, 2.6, 'F');
  text(doc, 'i', x + 6, y + 10.2, {
    size: 7,
    bold: true,
    color: WHITE,
    align: 'center',
  });
  text(doc, value, x + 12, y + 6.5, {
    size: 6.8,
    color: MUTED,
    maxWidth: w - 16,
  });
}

function kpiCard(
  doc: jsPDF,
  label: string,
  value: string,
  x: number,
  y: number,
  w: number,
  accent: RGB = BLUE,
): void {
  fill(doc, SOFT);
  doc.roundedRect(x, y, w, 28, 2.5, 2.5, 'F');
  fill(doc, accent);
  doc.circle(x + 8, y + 9, 3.2, 'F');
  text(doc, label, x + 15, y + 8, {
    size: 6.8,
    bold: true,
    color: INK,
    maxWidth: w - 18,
  });
  text(doc, value, x + 8, y + 21, {
    size: 14.5,
    bold: true,
    color: accent,
  });
}

function lineChart(
  doc: jsPDF,
  points: readonly { date: string; ots: number }[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const max = Math.max(1, ...points.map((point) => point.ots));
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  for (let i = 0; i <= 4; i += 1) {
    const ty = y + h - (h * i) / 4;
    doc.line(x, ty, x + w, ty);
    text(doc, formatCount((max * i) / 4), x - 2, ty + 1.5, {
      size: 5.4,
      color: MUTED,
      align: 'right',
    });
  }
  if (points.length === 0) {
    text(doc, 'Sin datos diarios disponibles', x + w / 2, y + h / 2, {
      size: 7,
      color: MUTED,
      align: 'center',
    });
    return;
  }
  const step = points.length > 1 ? w / (points.length - 1) : w;
  stroke(doc, BLUE);
  doc.setLineWidth(0.8);
  points.forEach((point, index) => {
    const px = x + step * index;
    const py = y + h - (point.ots / max) * h;
    if (index > 0) {
      const previous = points[index - 1]!;
      const prevY = y + h - (previous.ots / max) * h;
      doc.line(x + step * (index - 1), prevY, px, py);
    }
    fill(doc, WHITE);
    stroke(doc, BLUE);
    doc.circle(px, py, 1.2, 'FD');
  });
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  for (const index of Array.from(new Set(labels))) {
    const point = points[index];
    if (!point) continue;
    text(doc, point.date.slice(5), x + step * index, y + h + 5, {
      size: 5.6,
      color: MUTED,
      align: 'center',
    });
  }
}

function donutChart(
  doc: jsPDF,
  percent: number,
  x: number,
  y: number,
  radius: number,
): void {
  fill(doc, GRAY);
  doc.circle(x, y, radius, 'F');
  const clamped = Math.max(0, Math.min(100, percent));
  const steps = Math.max(1, Math.round(clamped * 0.72));
  fill(doc, BLUE);
  for (let i = 0; i < steps; i += 1) {
    const start = -Math.PI / 2 + (i / 72) * Math.PI * 2;
    const end = -Math.PI / 2 + ((i + 1.2) / 72) * Math.PI * 2;
    const pts: [number, number][] = [
      [x, y],
      [x + Math.cos(start) * radius, y + Math.sin(start) * radius],
      [x + Math.cos(end) * radius, y + Math.sin(end) * radius],
    ];
    doc.lines(
      [
        [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]],
        [pts[2][0] - pts[1][0], pts[2][1] - pts[1][1]],
        [pts[0][0] - pts[2][0], pts[0][1] - pts[2][1]],
      ],
      pts[0][0],
      pts[0][1],
      [1, 1],
      'F',
      true,
    );
  }
  fill(doc, WHITE);
  doc.circle(x, y, radius * 0.62, 'F');
  text(doc, formatPercent(clamped), x, y - 1, {
    size: 15,
    bold: true,
    color: BLUE,
    align: 'center',
  });
  text(doc, 'datos directos', x, y + 4, {
    size: 5.8,
    color: MUTED,
    align: 'center',
  });
}

function pieChart(
  doc: jsPDF,
  shares: readonly AudienceShare[],
  x: number,
  y: number,
  radius: number,
): void {
  if (shares.length === 0) {
    fill(doc, HAIR);
    doc.circle(x, y, radius, 'F');
    text(doc, 'Sin datos', x, y + 1, {
      size: 7,
      color: MUTED,
      align: 'center',
    });
    return;
  }
  let start = -Math.PI / 2;
  shares.forEach((part, index) => {
    const span = (Math.max(0, part.share) / 100) * Math.PI * 2;
    const segments = Math.max(2, Math.ceil(span / (Math.PI / 18)));
    const deltas: [number, number][] = [];
    let px = x;
    let py = y;
    const firstX = x + Math.cos(start) * radius;
    const firstY = y + Math.sin(start) * radius;
    deltas.push([firstX - px, firstY - py]);
    px = firstX;
    py = firstY;
    for (let i = 1; i <= segments; i += 1) {
      const angle = start + (span * i) / segments;
      const nx = x + Math.cos(angle) * radius;
      const ny = y + Math.sin(angle) * radius;
      deltas.push([nx - px, ny - py]);
      px = nx;
      py = ny;
    }
    deltas.push([x - px, y - py]);
    fill(doc, PIE_COLORS[index % PIE_COLORS.length]!);
    doc.lines(deltas, x, y, [1, 1], 'F', true);
    if (part.share >= 10) {
      const middle = start + span / 2;
      text(
        doc,
        formatPercent(part.share),
        x + Math.cos(middle) * radius * 0.57,
        y + Math.sin(middle) * radius * 0.57 + 1,
        { size: 6.3, bold: true, color: WHITE, align: 'center' },
      );
    }
    start += span;
  });
}

function pieLegend(
  doc: jsPDF,
  shares: readonly AudienceShare[],
  x: number,
  y: number,
  maxWidth: number,
): void {
  let cursorY = y;
  shares.slice(0, 5).forEach((part, index) => {
    fill(doc, PIE_COLORS[index % PIE_COLORS.length]!);
    doc.circle(x + 1.5, cursorY - 1, 1.4, 'F');
    text(doc, `${part.label} · ${formatPercent(part.share)}`, x + 5, cursorY, {
      size: 5.6,
      color: MUTED,
      maxWidth: maxWidth - 5,
    });
    cursorY += 5;
  });
}

function coverPage(doc: jsPDF, report: QuividiCampaignReport): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const summary = campaignAudienceSummary(report);
  const supports = reportSupports(report);

  fill(doc, WHITE);
  doc.rect(0, 0, pageW, pageH, 'F');
  fill(doc, DEEP);
  doc.rect(0, 0, pageW, 19, 'F');
  try {
    doc.addImage(INSTORE_MEDIA_LOGO_DATA_URL, 'PNG', M, 4, 42, 8.8);
  } catch {
    text(doc, 'in-Store Media', M, 11, { size: 10, bold: true, color: WHITE });
  }

  fill(doc, PINK);
  doc.rect(M, 29, 17, 1.2, 'F');
  text(doc, 'REPORTE DE CAMPAÑA', M, 36, {
    size: 7,
    bold: true,
    color: DEEP,
  });
  text(doc, 'Reporte de Audiencia', M, 52, {
    size: 22,
    bold: true,
    color: INK,
  });
  text(doc, 'y Resultados de Campaña', M, 63, {
    size: 22,
    bold: true,
    color: INK,
  });
  text(doc, 'Conectando marcas con personas', M, 74, {
    size: 9,
    color: MUTED,
  });
  text(doc, 'en el momento real.', M, 79, { size: 9, color: MUTED });

  const photoX = 112;
  const photoY = 26;
  const photoW = 82;
  const photoH = 122;
  try {
    doc.addImage(LIVERPOOL_MUPI_COVER_DATA_URL, 'JPEG', photoX, photoY, photoW, photoH);
  } catch {
    fill(doc, SOFT);
    doc.rect(photoX, photoY, photoW, photoH, 'F');
  }
  fill(doc, PINK);
  doc.triangle(photoX - 7, photoY + 112, photoX + 4, photoY + 88, photoX + 4, photoY + 112, 'F');

  const rows = [
    ['Campaña', report.campaignName],
    ['Retailer', 'Liverpool'],
    ['Periodo', periodLabel(report)],
    ['Formato', supports.join(' · ') || 'Pantallas In-Store'],
    ['Tiendas', String(summary.totalStores)],
  ];
  let y = 99;
  rows.forEach(([label, value]) => {
    fill(doc, BLUE);
    doc.circle(M + 2, y - 1.2, 1.7, 'F');
    text(doc, label!, M + 8, y, { size: 7, bold: true, color: INK });
    text(doc, value!, M + 8, y + 5, { size: 7.5, color: MUTED, maxWidth: 82 });
    y += 17;
  });

  fill(doc, PINK);
  doc.rect(M, pageH - 28, 18, 1, 'F');
  text(doc, 'AUDIENCIAS REALES.', M, pageH - 19, {
    size: 6.6,
    bold: true,
    color: DEEP,
  });
  text(doc, 'OPORTUNIDADES REALES.', M, pageH - 14, {
    size: 6.6,
    bold: true,
    color: DEEP,
  });
  text(doc, '01', pageW - M, pageH - 10, {
    size: 7,
    bold: true,
    color: DEEP,
    align: 'right',
  });
}

function executivePage(doc: jsPDF, report: QuividiCampaignReport): void {
  let y = addBrandHeader(doc, report, 'Resumen', 2);
  y = title(
    doc,
    'Resumen Ejecutivo',
    y,
    'Resultados agregados de la campaña, con cobertura de medición y estimación transparente del universo no medido.',
  );
  const s = campaignAudienceSummary(report);
  const gap = 6;
  const w = (178 - gap) / 2;
  kpiCard(doc, 'OTS estimados campaña', formatCount(s.estimatedOts), M, y, w);
  kpiCard(doc, 'OTS promedio diario', formatCount(s.averageDailyOts), M + w + gap, y, w);
  kpiCard(doc, 'OTS promedio diario / tienda', formatCount(s.averageDailyPerStore), M, y + 34, w);
  kpiCard(doc, 'OTS promedio diario / soporte', formatCount(s.averageDailyPerSupport), M + w + gap, y + 34, w);
  kpiCard(doc, 'Cobertura de medición', formatPercent(s.coveragePercent), M, y + 68, 178, PINK);
  infoBox(
    doc,
    `${s.measuredStores} de ${s.totalStores} tiendas cuentan con medición directa. El ${formatPercent(100 - s.coveragePercent)} restante se estima a partir del comportamiento promedio de OTS observado durante el mismo periodo de campaña.`,
    M,
    y + 103,
    178,
  );
  footer(doc, 2);
}

function coveragePage(doc: jsPDF, report: QuividiCampaignReport): void {
  let y = addBrandHeader(doc, report, 'Cobertura y evolución', 3);
  y = title(
    doc,
    'Cobertura y Evolución de OTS',
    y,
    'La cobertura se expresa por tiendas y la evolución diaria muestra el resultado agregado de toda la campaña.',
  );
  const s = campaignAudienceSummary(report);
  const daily = dailyEstimatedOts(report);

  fill(doc, SOFT);
  doc.roundedRect(M, y, 72, 93, 2.5, 2.5, 'F');
  text(doc, 'Cobertura de medición', M + 6, y + 9, { size: 8, bold: true });
  donutChart(doc, s.coveragePercent, M + 36, y + 42, 23);
  fill(doc, BLUE);
  doc.circle(M + 9, y + 76, 1.6, 'F');
  text(doc, `${formatPercent(s.coveragePercent)} datos directos`, M + 14, y + 78, {
    size: 6.4,
    color: MUTED,
  });
  fill(doc, GRAY);
  doc.circle(M + 9, y + 84, 1.6, 'F');
  text(doc, `${formatPercent(100 - s.coveragePercent)} extrapolado`, M + 14, y + 86, {
    size: 6.4,
    color: MUTED,
  });

  fill(doc, SOFT);
  doc.roundedRect(M + 78, y, 100, 93, 2.5, 2.5, 'F');
  text(doc, 'OTS diarios', M + 84, y + 9, { size: 8, bold: true });
  lineChart(doc, daily, M + 94, y + 19, 76, 55);

  infoBox(
    doc,
    'Los resultados extrapolados complementan el universo de campaña sin exponer el desempeño individual por tienda.',
    M,
    y + 101,
    178,
  );
  footer(doc, 3);
}

function audiencePage(doc: jsPDF, report: QuividiCampaignReport): void {
  let y = addBrandHeader(doc, report, 'Audiencia', 4);
  y = title(
    doc,
    'Segmentos de Audiencia',
    y,
    'Distribución porcentual agregada de los principales segmentos observados durante la campaña.',
  );
  const groups = [
    { title: 'Género', data: genderAudienceShares(report) },
    { title: 'Rango de edad', data: ageAudienceShares(report) },
    { title: 'Momento del día', data: dayPartAudienceShares(report) },
  ];
  const cardW = 56;
  groups.forEach((group, index) => {
    const x = M + index * 61;
    fill(doc, SOFT);
    doc.roundedRect(x, y, cardW, 119, 2.4, 2.4, 'F');
    text(doc, group.title, x + cardW / 2, y + 10, {
      size: 8,
      bold: true,
      align: 'center',
    });
    pieChart(doc, group.data, x + cardW / 2, y + 43, 22);
    pieLegend(doc, group.data, x + 5, y + 73, cardW - 10);
  });
  infoBox(
    doc,
    'Las gráficas muestran participaciones porcentuales de audiencia; el reporte comercial no publica conteos individuales ni resultados por sucursal.',
    M,
    y + 128,
    178,
  );
  footer(doc, 4);
}

function methodologyPage(doc: jsPDF, report: QuividiCampaignReport): void {
  let y = addBrandHeader(doc, report, 'Metodología', 5);
  y = title(
    doc,
    'Metodología',
    y,
    'El reporte combina medición directa y estimaciones para representar el universo completo de campaña de forma agregada.',
  );
  const s = campaignAudienceSummary(report);
  const items = [
    'La cobertura se calcula sobre el total de tiendas incluidas en la campaña.',
    'Cuando una tienda no cuenta con medición directa, su aportación se estima con el promedio de OTS observado por tienda durante el mismo periodo.',
    'El reporte presenta únicamente resultados agregados de campaña y no publica desempeño individual por tienda.',
    'Insurgentes se trata como caso especial: sus 2 cámaras están en pisos distintos, por lo que sus OTS se consideran zonas independientes. En las demás tiendas se conserva la regla actual de ponderación.',
    'La metodología busca ofrecer una visión representativa del desempeño de la campaña, manteniendo la confidencialidad de la información por sucursal.',
  ];
  let cursor = y + 1;
  items.forEach((item, index) => {
    fill(doc, BLUE);
    doc.circle(M + 5, cursor + 2, 4, 'F');
    text(doc, String(index + 1), M + 5, cursor + 3.3, {
      size: 7,
      bold: true,
      color: WHITE,
      align: 'center',
    });
    text(doc, item, M + 13, cursor, {
      size: 7,
      color: MUTED,
      maxWidth: 105,
    });
    cursor += index === 3 ? 28 : 22;
  });

  fill(doc, PALE_BLUE);
  doc.roundedRect(132, y, 62, 57, 2.5, 2.5, 'F');
  text(doc, 'Fórmulas principales', 138, y + 9, {
    size: 8,
    bold: true,
    color: BLUE,
  });
  text(doc, 'OTS estimados =', 163, y + 21, {
    size: 7,
    bold: true,
    align: 'center',
  });
  text(doc, 'OTS directos + OTS extrapolados', 163, y + 27, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });
  text(doc, 'Cobertura =', 163, y + 39, {
    size: 7,
    bold: true,
    align: 'center',
  });
  text(doc, `${s.measuredStores} tiendas con medición / ${s.totalStores} tiendas`, 163, y + 46, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });

  // Fotografía real: se mantiene pequeña y de baja resolución para que las
  // personas del entorno queden deliberadamente difuminadas/no identificables.
  try {
    doc.addImage(LIVERPOOL_BANNER_METHOD_DATA_URL, 'JPEG', 139, y + 69, 55, 68);
    fill(doc, PINK);
    doc.triangle(132, y + 137, 142, y + 113, 142, y + 137, 'F');
  } catch {
    fill(doc, SOFT);
    doc.rect(139, y + 69, 55, 68, 'F');
  }

  infoBox(
    doc,
    `Cobertura del reporte: ${formatPercent(s.coveragePercent)} con medición directa y ${formatPercent(100 - s.coveragePercent)} estimado sobre el comportamiento medio del mismo periodo.`,
    M,
    y + 144,
    178,
  );
  footer(doc, 5);
}

export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });

  coverPage(doc, report);
  doc.addPage();
  executivePage(doc, report);
  doc.addPage();
  coveragePage(doc, report);
  doc.addPage();
  audiencePage(doc, report);
  doc.addPage();
  methodologyPage(doc, report);

  return doc.output('blob');
}

export function quividiCampaignPdfFileName(
  report: QuividiCampaignReport,
): string {
  const safe = report.campaignName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `Audiencia_${safe || 'campana'}_${report.startDate}_${report.endDate}.pdf`;
}
