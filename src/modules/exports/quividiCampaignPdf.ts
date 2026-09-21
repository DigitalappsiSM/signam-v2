import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandAge,
  brandCampaignSummary,
  brandDaily,
  brandGender,
  brandHeader,
  formatCount,
  formatPercent,
  type BrandShare,
} from './quividiBrandReport';

/**
 * Informe comercial de audiencia para marcas.
 *
 * El PDF es deliberadamente agregado: comunica OTS, cobertura, extrapolación y
 * perfil porcentual de audiencia. No publica el proveedor de medición, métricas
 * de mirada/conversión ni rendimiento de una tienda individual. El Excel
 * técnico conserva el detalle operativo original.
 */

type RGB = readonly [number, number, number];

const NAVY: RGB = [17, 38, 78];
const BLUE: RGB = [0, 126, 203];
const SKY: RGB = [233, 246, 253];
const PINK: RGB = [226, 18, 111];
const INK: RGB = [25, 31, 44];
const MUTED: RGB = [91, 104, 125];
const HAIR: RGB = [222, 230, 239];
const SOFT: RGB = [247, 250, 253];
const WHITE: RGB = [255, 255, 255];
const GRAY: RGB = [197, 208, 220];

const M = 16;
const PAGE_COUNT = 5;
const LOGO_PATH = '/report-assets/in-store-media-logo.png';
const COVER_PHOTO_PATH = '/report-assets/liverpool-mupi-cover.jpg';
const CLOSING_PHOTO_PATH = '/report-assets/liverpool-banner-closing.jpg';

interface PdfAssets {
  logo: string | null;
  cover: string | null;
  closing: string | null;
}

interface KpiCardData {
  label: string;
  value: string;
  note?: string;
}

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
  } = {},
): void {
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(options.size ?? 9);
  ink(doc, options.color ?? INK);
  doc.text(value, x, y, { align: options.align ?? 'left' });
}

function paragraph(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  width: number,
  options: { size?: number; color?: RGB; bold?: boolean; lineHeight?: number } = {},
): number {
  const size = options.size ?? 8;
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  ink(doc, options.color ?? MUTED);
  const lines = doc.splitTextToSize(value, width) as string[];
  const lineHeight = options.lineHeight ?? size * 0.42 + 1.3;
  doc.text(lines, x, y, { lineHeightFactor: 1.2 });
  return y + Math.max(1, lines.length) * lineHeight;
}

function pageHeader(
  doc: jsPDF,
  assets: PdfAssets,
  title: string,
  page: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  if (assets.logo) {
    doc.addImage(assets.logo, 'PNG', M, 7.5, 61, 8.3, undefined, 'FAST');
  } else {
    text(doc, 'in-Store Media', M, 13, { size: 11, bold: true, color: NAVY });
  }
  text(doc, 'Reporte de Campaña', pageW - M, 10, {
    size: 6.5,
    color: MUTED,
    align: 'right',
  });
  text(doc, title, pageW - M, 14, {
    size: 6.5,
    color: MUTED,
    align: 'right',
  });
  stroke(doc, HAIR);
  doc.setLineWidth(0.25);
  doc.line(M, 19, pageW - M, 19);
  text(doc, String(page).padStart(2, '0'), pageW - M, 286, {
    size: 7,
    bold: true,
    color: NAVY,
    align: 'right',
  });
  return 29;
}

function pageFooter(doc: jsPDF): void {
  const pageW = doc.internal.pageSize.getWidth();
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(M, 278, pageW - M, 278);
  text(doc, 'in-Store Media', M, 283, { size: 6.2, bold: true, color: NAVY });
  text(doc, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.', M + 28, 283, {
    size: 5.8,
    color: MUTED,
  });
}

function sectionEyebrow(doc: jsPDF, label: string, y: number): number {
  fill(doc, PINK);
  doc.rect(M, y - 2.2, 8, 0.9, 'F');
  text(doc, label.toUpperCase(), M, y + 2.5, {
    size: 6.6,
    bold: true,
    color: BLUE,
  });
  return y + 8;
}

function card(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  fill(doc, SOFT);
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.roundedRect(x, y, w, h, 2.2, 2.2, 'FD');
}

function kpiCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  data: KpiCardData,
): void {
  card(doc, x, y, w, h);
  fill(doc, BLUE);
  doc.circle(x + 8, y + 9, 3.2, 'F');
  text(doc, data.label, x + 15, y + 7.2, { size: 6.6, bold: true, color: NAVY });
  text(doc, data.value, x + 15, y + 16.2, { size: 15.5, bold: true, color: BLUE });
  if (data.note) {
    paragraph(doc, data.note, x + 15, y + 21, w - 19, { size: 5.6, color: MUTED });
  }
}

function infoBox(doc: jsPDF, value: string, x: number, y: number, w: number): number {
  fill(doc, SKY);
  doc.roundedRect(x, y, w, 22, 2.2, 2.2, 'F');
  fill(doc, BLUE);
  doc.circle(x + 8, y + 11, 3.2, 'F');
  text(doc, 'i', x + 8, y + 12.2, {
    size: 8,
    bold: true,
    color: WHITE,
    align: 'center',
  });
  paragraph(doc, value, x + 15, y + 7, w - 20, { size: 7, color: NAVY });
  return y + 22;
}

async function assetDataUrl(path: string): Promise<string | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (typeof FileReader === 'undefined') return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () =>
        resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadAssets(): Promise<PdfAssets> {
  const [logo, cover, closing] = await Promise.all([
    assetDataUrl(LOGO_PATH),
    assetDataUrl(COVER_PHOTO_PATH),
    assetDataUrl(CLOSING_PHOTO_PATH),
  ]);
  return { logo, cover, closing };
}

function lineChart(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  labels: string[],
  values: number[],
): void {
  const max = Math.max(1, ...values);
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  for (let tick = 0; tick <= 4; tick += 1) {
    const ty = y + h - (h * tick) / 4;
    doc.line(x, ty, x + w, ty);
    text(doc, formatCount((max * tick) / 4), x - 2, ty + 1.3, {
      size: 5.4,
      color: MUTED,
      align: 'right',
    });
  }
  if (values.length === 0) return;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  stroke(doc, BLUE);
  doc.setLineWidth(0.8);
  values.forEach((value, index) => {
    const px = x + step * index;
    const py = y + h - (value / max) * h;
    if (index > 0) {
      const previous = values[index - 1] ?? 0;
      const ppx = x + step * (index - 1);
      const ppy = y + h - (previous / max) * h;
      doc.line(ppx, ppy, px, py);
    }
    fill(doc, WHITE);
    stroke(doc, BLUE);
    doc.circle(px, py, 1.2, 'FD');
  });
  labels.forEach((label, index) => {
    if (index !== 0 && index !== labels.length - 1 && index % 3 !== 0) return;
    text(doc, label, x + step * index, y + h + 5, {
      size: 5.7,
      color: MUTED,
      align: 'center',
    });
  });
}

function donut(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  percent: number,
): void {
  const clamped = Math.max(0, Math.min(100, percent));
  const drawArc = (from: number, to: number, color: RGB) => {
    stroke(doc, color);
    doc.setLineWidth(6.2);
    const steps = Math.max(2, Math.ceil(Math.abs(to - from) * 20));
    let previousX = cx + Math.cos(from) * radius;
    let previousY = cy + Math.sin(from) * radius;
    for (let i = 1; i <= steps; i += 1) {
      const angle = from + ((to - from) * i) / steps;
      const currentX = cx + Math.cos(angle) * radius;
      const currentY = cy + Math.sin(angle) * radius;
      doc.line(previousX, previousY, currentX, currentY);
      previousX = currentX;
      previousY = currentY;
    }
  };
  const start = -Math.PI / 2;
  const measuredEnd = start + Math.PI * 2 * (clamped / 100);
  drawArc(start, start + Math.PI * 2, GRAY);
  if (clamped > 0) drawArc(start, measuredEnd, BLUE);
  doc.setLineWidth(0.2);
  text(doc, formatPercent(clamped), cx, cy - 1, {
    size: 16,
    bold: true,
    color: BLUE,
    align: 'center',
  });
  text(doc, 'cobertura', cx, cy + 5, {
    size: 6.2,
    color: MUTED,
    align: 'center',
  });
}

function audienceDonut(
  doc: jsPDF,
  cx: number,
  cy: number,
  radius: number,
  shares: readonly BrandShare[],
  colors: readonly RGB[],
): void {
  if (shares.length === 0) {
    stroke(doc, GRAY);
    doc.setLineWidth(6);
    doc.circle(cx, cy, radius, 'S');
    text(doc, 'Sin datos', cx, cy + 1.5, {
      size: 7,
      color: MUTED,
      align: 'center',
    });
    return;
  }
  let start = -Math.PI / 2;
  shares.forEach((part, index) => {
    const radians = Math.PI * 2 * (part.share / 100);
    const end = start + radians;
    stroke(doc, colors[index % colors.length] ?? BLUE);
    doc.setLineWidth(7.5);
    const steps = Math.max(2, Math.ceil(Math.abs(end - start) * 18));
    let previousX = cx + Math.cos(start) * radius;
    let previousY = cy + Math.sin(start) * radius;
    for (let step = 1; step <= steps; step += 1) {
      const angle = start + ((end - start) * step) / steps;
      const currentX = cx + Math.cos(angle) * radius;
      const currentY = cy + Math.sin(angle) * radius;
      doc.line(previousX, previousY, currentX, currentY);
      previousX = currentX;
      previousY = currentY;
    }
    start = end;
  });
  doc.setLineWidth(0.2);
}

function legendShares(
  doc: jsPDF,
  x: number,
  y: number,
  shares: readonly BrandShare[],
  colors: readonly RGB[],
  maxWidth: number,
): void {
  let cursor = y;
  shares.forEach((part, index) => {
    const color = colors[index % colors.length] ?? BLUE;
    fill(doc, color);
    doc.circle(x + 1.4, cursor - 1, 1.4, 'F');
    text(doc, part.label, x + 5, cursor, { size: 6.5, color: NAVY });
    text(doc, formatPercent(part.share), x + maxWidth, cursor, {
      size: 6.5,
      bold: true,
      color: NAVY,
      align: 'right',
    });
    cursor += 6;
  });
}

function coverPage(doc: jsPDF, report: QuividiCampaignReport, assets: PdfAssets): void {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const header = brandHeader(report);

  fill(doc, WHITE);
  doc.rect(0, 0, pageW, pageH, 'F');
  if (assets.cover) {
    doc.addImage(assets.cover, 'JPEG', 115, 0, pageW - 115, pageH, undefined, 'FAST');
    fill(doc, WHITE);
    doc.triangle(76, 0, 124, 0, 115, pageH, 'F');
    fill(doc, PINK);
    doc.triangle(105, 108, 116, 102, 113, 190, 'F');
  } else {
    fill(doc, SKY);
    doc.rect(120, 0, pageW - 120, pageH, 'F');
  }

  if (assets.logo) {
    doc.addImage(assets.logo, 'PNG', M, 13, 72, 9.7, undefined, 'FAST');
  } else {
    text(doc, 'in-Store Media', M, 20, { size: 13, bold: true, color: NAVY });
  }

  fill(doc, PINK);
  doc.rect(M, 34, 13, 0.9, 'F');
  text(doc, 'REPORTE DE CAMPAÑA', M, 41, { size: 6.4, bold: true, color: BLUE });
  text(doc, 'Reporte de Audiencia', M, 55, { size: 19, bold: true, color: NAVY });
  text(doc, 'y Resultados de Campaña', M, 64, { size: 19, bold: true, color: NAVY });
  paragraph(
    doc,
    'Conectando marcas con personas en el momento real.',
    M,
    74,
    78,
    { size: 9, color: MUTED },
  );

  const metadata = [
    ['Marca / campaña', header.campaignName],
    ['Retailer', 'Liverpool'],
    ['Periodo', header.periodLabel],
    ['Formato', header.supports.join(' · ') || 'Pantallas In-Store'],
    ['Tiendas', `${header.totalStores} tiendas`],
  ] as const;
  let y = 101;
  metadata.forEach(([label, value]) => {
    fill(doc, BLUE);
    doc.circle(M + 3, y - 1, 2.2, 'F');
    text(doc, label, M + 9, y, { size: 6.8, bold: true, color: NAVY });
    y = paragraph(doc, value, M + 9, y + 4.2, 75, { size: 7.3, color: MUTED }) + 6;
  });

  fill(doc, PINK);
  doc.rect(M, 253, 13, 0.9, 'F');
  text(doc, 'AUDIENCIAS REALES.', M, 261, { size: 6.3, bold: true, color: NAVY });
  text(doc, 'OPORTUNIDADES REALES.', M, 266, { size: 6.3, bold: true, color: NAVY });
  text(doc, '01', pageW - M, pageH - 11, {
    size: 8,
    bold: true,
    color: WHITE,
    align: 'right',
  });
}

function summaryPage(doc: jsPDF, report: QuividiCampaignReport, assets: PdfAssets): void {
  let y = pageHeader(doc, assets, 'Resumen', 2);
  const summary = brandCampaignSummary(report);
  y = sectionEyebrow(doc, '01. Resumen', y);
  text(doc, 'Resumen Ejecutivo', M, y, { size: 18, bold: true, color: NAVY });
  y = paragraph(
    doc,
    'La campaña consolidó sus resultados de audiencia en una lectura agregada del circuito, combinando medición directa y estimación únicamente donde no existe cobertura.',
    M,
    y + 7,
    176,
    { size: 8, color: MUTED },
  );

  const gap = 5;
  const cardW = (178 - gap) / 2;
  const cards: KpiCardData[] = [
    { label: 'OTS estimados campaña', value: formatCount(summary.estimatedOts) },
    { label: 'OTS promedio diario', value: formatCount(summary.dailyAverage) },
    {
      label: 'OTS promedio diario / tienda',
      value: formatCount(summary.dailyPerStore),
    },
    {
      label: 'OTS promedio diario / soporte',
      value: formatCount(summary.dailyPerSupport),
      note: 'Promedio por tienda-soporte del universo de campaña.',
    },
  ];
  y += 5;
  cards.forEach((item, index) => {
    const row = Math.floor(index / 2);
    const col = index % 2;
    kpiCard(doc, M + col * (cardW + gap), y + row * 34, cardW, 29, item);
  });
  kpiCard(
    doc,
    M,
    y + 70,
    178,
    29,
    {
      label: 'Cobertura de medición',
      value: formatPercent(summary.coverage.measuredPercent),
      note: `${summary.coverage.measuredStores} de ${summary.coverage.totalStores} tiendas con medición directa.`,
    },
  );

  const direct = summary.coverage.measuredStores;
  const total = summary.coverage.totalStores;
  const estimated = summary.coverage.estimatedStores;
  infoBox(
    doc,
    `${direct} de ${total} tiendas cuentan con medición directa (${formatPercent(summary.coverage.measuredPercent)} de cobertura). Para las ${estimated} tiendas restantes (${formatPercent(summary.coverage.estimatedPercent)} del universo), los OTS se estiman usando el promedio observado en las tiendas medidas durante las mismas fechas de campaña.`,
    M,
    y + 106,
    178,
  );
  pageFooter(doc);
}

function coveragePage(doc: jsPDF, report: QuividiCampaignReport, assets: PdfAssets): void {
  let y = pageHeader(doc, assets, 'Cobertura y evolución', 3);
  const summary = brandCampaignSummary(report);
  const daily = brandDaily(report);
  y = sectionEyebrow(doc, '02. Cobertura y evolución', y);
  text(doc, 'Cobertura y Evolución de OTS', M, y, {
    size: 18,
    bold: true,
    color: NAVY,
  });
  y = paragraph(
    doc,
    'La evolución muestra el comportamiento agregado de la campaña. La estimación completa el universo contratado sin revelar resultados de una tienda individual.',
    M,
    y + 7,
    176,
    { size: 8, color: MUTED },
  );

  const top = y + 8;
  card(doc, M, top, 62, 102);
  text(doc, 'Cobertura de medición', M + 6, top + 10, {
    size: 8,
    bold: true,
    color: NAVY,
  });
  donut(doc, M + 31, top + 42, 17, summary.coverage.measuredPercent);
  fill(doc, BLUE);
  doc.circle(M + 9, top + 75, 1.6, 'F');
  text(
    doc,
    `${formatPercent(summary.coverage.measuredPercent)} Datos medidos`,
    M + 14,
    top + 76.5,
    { size: 6.6, color: NAVY },
  );
  fill(doc, GRAY);
  doc.circle(M + 9, top + 84, 1.6, 'F');
  text(
    doc,
    `${formatPercent(summary.coverage.estimatedPercent)} Extrapolado`,
    M + 14,
    top + 85.5,
    { size: 6.6, color: NAVY },
  );

  card(doc, M + 67, top, 111, 102);
  text(doc, 'OTS diarios', M + 73, top + 10, { size: 8, bold: true, color: NAVY });
  lineChart(
    doc,
    M + 82,
    top + 20,
    86,
    58,
    daily.map((point) => point.label),
    daily.map((point) => point.estimatedOts),
  );
  text(doc, 'Serie agregada de campaña, incluyendo extrapolación.', M + 73, top + 91, {
    size: 6,
    color: MUTED,
  });

  infoBox(
    doc,
    `OTS medidos: ${formatCount(summary.measuredOts)}. OTS extrapolados: ${formatCount(summary.extrapolatedOts)}. OTS estimados de campaña: ${formatCount(summary.estimatedOts)}. La cobertura se expresa por tiendas, no por número de cámaras.`,
    M,
    top + 111,
    178,
  );
  pageFooter(doc);
}

function audiencePage(doc: jsPDF, report: QuividiCampaignReport, assets: PdfAssets): void {
  let y = pageHeader(doc, assets, 'Audiencia', 4);
  y = sectionEyebrow(doc, '03. Audiencia', y);
  text(doc, 'Segmentos de Audiencia', M, y, { size: 18, bold: true, color: NAVY });
  y = paragraph(
    doc,
    'La composición se presenta exclusivamente en porcentajes para describir el perfil agregado de la audiencia durante la campaña.',
    M,
    y + 7,
    176,
    { size: 8, color: MUTED },
  );

  const gender = brandGender(report).slice(0, 4);
  const age = brandAge(report).slice(0, 6);
  const colors: readonly RGB[] = [BLUE, [96, 183, 231], [156, 205, 232], GRAY, [78, 111, 159], PINK];
  const top = y + 10;
  const cardW = 86.5;

  card(doc, M, top, cardW, 135);
  text(doc, 'Género', M + cardW / 2, top + 12, {
    size: 9,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  audienceDonut(doc, M + cardW / 2, top + 50, 23, gender, colors);
  legendShares(doc, M + 12, top + 88, gender, colors, cardW - 24);

  card(doc, M + cardW + 5, top, cardW, 135);
  text(doc, 'Rango de edad', M + cardW + 5 + cardW / 2, top + 12, {
    size: 9,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  audienceDonut(
    doc,
    M + cardW + 5 + cardW / 2,
    top + 50,
    23,
    age,
    colors,
  );
  legendShares(doc, M + cardW + 17, top + 88, age, colors, cardW - 24);

  infoBox(
    doc,
    'Las gráficas muestran distribuciones porcentuales agregadas. No se incluyen conteos absolutos de personas ni resultados desglosados por tienda.',
    M,
    top + 145,
    178,
  );
  pageFooter(doc);
}

function methodologyPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  let y = pageHeader(doc, assets, 'Metodología', 5);
  const summary = brandCampaignSummary(report);
  y = sectionEyebrow(doc, '04. Metodología', y);
  text(doc, 'Metodología', M, y, { size: 18, bold: true, color: NAVY });
  y = paragraph(
    doc,
    'El reporte combina medición directa y estimación para representar el universo completo de tiendas contratado durante la vigencia de la campaña.',
    M,
    y + 7,
    126,
    { size: 8, color: MUTED },
  );

  const bullets = [
    'La cobertura se calcula sobre el total de tiendas de la campaña, nunca sobre el número de cámaras.',
    'Cuando una tienda no cuenta con medición directa, su aportación se estima con el promedio de OTS observado en las tiendas medidas durante las mismas fechas de campaña.',
    'El informe comunica resultados agregados y no publica el rendimiento individual de cada tienda.',
    'Insurgentes es la única excepción a la consolidación habitual de varias cámaras: sus dos cámaras están en pisos distintos y sus OTS se consideran zonas independientes, por lo que no se promedian entre sí.',
    'La estimación se identifica explícitamente para diferenciar la parte medida de la parte extrapolada del universo de campaña.',
  ];
  let cursor = y + 8;
  bullets.forEach((bullet, index) => {
    fill(doc, BLUE);
    doc.circle(M + 4, cursor - 1, 3.3, 'F');
    text(doc, String(index + 1), M + 4, cursor + 0.6, {
      size: 7,
      bold: true,
      color: WHITE,
      align: 'center',
    });
    cursor = paragraph(doc, bullet, M + 11, cursor, 113, { size: 7, color: NAVY }) + 7;
  });

  card(doc, M, 210, 119, 48);
  text(doc, 'Fórmulas principales', M + 8, 220, { size: 8.5, bold: true, color: BLUE });
  text(doc, 'OTS estimados = OTS medidos + OTS extrapolados', M + 8, 232, {
    size: 7.3,
    bold: true,
    color: NAVY,
  });
  text(doc, 'Cobertura = tiendas con medición / tiendas de campaña', M + 8, 243, {
    size: 7.3,
    bold: true,
    color: NAVY,
  });
  text(
    doc,
    `${summary.coverage.measuredStores}/${summary.coverage.totalStores} tiendas = ${formatPercent(summary.coverage.measuredPercent)} de cobertura`,
    M + 8,
    252,
    { size: 6.5, color: MUTED },
  );

  if (assets.closing) {
    doc.addImage(assets.closing, 'JPEG', 143, 77, 51, 181, undefined, 'FAST');
    fill(doc, WHITE);
    doc.triangle(128, 77, 148, 77, 143, 258, 'F');
    fill(doc, PINK);
    doc.triangle(136, 168, 144, 158, 143, 244, 'F');
  } else {
    fill(doc, SKY);
    doc.rect(143, 77, 51, 181, 'F');
  }
  pageFooter(doc);
}

/** Genera el informe de audiencia de marca y lo devuelve como Blob. */
export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const assets = await loadAssets();
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });

  coverPage(doc, report, assets);
  doc.addPage();
  summaryPage(doc, report, assets);
  doc.addPage();
  coveragePage(doc, report, assets);
  doc.addPage();
  audiencePage(doc, report, assets);
  doc.addPage();
  methodologyPage(doc, report, assets);

  if (doc.getNumberOfPages() !== PAGE_COUNT) {
    throw new Error('El informe comercial debe contener cinco páginas.');
  }
  return doc.output('blob');
}

/** Nombre de archivo comercial, sin referencias a la plataforma de medición. */
export function quividiCampaignPdfFileName(
  report: QuividiCampaignReport,
): string {
  const safe = report.campaignName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `Audiencia_${safe || 'campana'}_${report.startDate}_${report.endDate}.pdf`;
}
