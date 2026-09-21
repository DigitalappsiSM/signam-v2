import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import { INSTORE_MEDIA_LOGO_DATA_URL } from '@/assets/ppt/logos';
import {
  brandAge,
  brandCampaignSummary,
  brandDaily,
  brandGender,
  brandHeader,
  brandTimeOfDay,
  formatCivilDate,
  formatCount,
  formatPercent,
} from './quividiBrandReport';
import {
  BLUE,
  BLUE_LIGHT,
  BLUE_MID,
  BLUE_PALE,
  CANVAS_H,
  CANVAS_W,
  GRAY,
  HAIR,
  MUTED,
  NAVY,
  PINK,
  PINK_PALE,
  SKY,
  SOFT,
  WHITE,
  block,
  donut,
  fade,
  paragraph,
  photoCover,
  storeGlyph,
  text,
  textWidth,
  u,
  type AlphaStop,
  type RGB,
} from './quividiPdfKit';

/**
 * Informe comercial de audiencia para marcas.
 *
 * El documento es deliberadamente agregado: comunica OTS, cobertura, perfil de
 * audiencia y el criterio con que se completa el universo contratado. No
 * publica el proveedor de medición, las métricas de mirada ni el rendimiento de
 * una tienda concreta; ese detalle vive en el Excel técnico, cuya hoja
 * «Auditoría de cifras» reconstruye paso a paso la cifra que aquí se publica.
 *
 * El maquetado está en píxeles de un lienzo A4 a 96 dpi y `quividiPdfKit` lo
 * traduce a milímetros.
 */

const PAGE_COUNT = 5;
const M = 48;
const CONTENT_W = CANVAS_W - M * 2;

const COVER_PHOTO_PATH = '/report-assets/liverpool-mupi-cover.jpg';
const CLOSING_PHOTO_PATH = '/report-assets/liverpool-banner-closing.jpg';

interface PdfAssets {
  logo: string | null;
  cover: string | null;
  closing: string | null;
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
  const [cover, closing] = await Promise.all([
    assetDataUrl(COVER_PHOTO_PATH),
    assetDataUrl(CLOSING_PHOTO_PATH),
  ]);
  return { logo: INSTORE_MEDIA_LOGO_DATA_URL, cover, closing };
}

/** Etiqueta corta de periodo para la cabecera: `Junio — Julio 2026`. */
function periodLabel(report: QuividiCampaignReport): string {
  const months = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  const from = report.startDate.split('-');
  const to = report.endDate.split('-');
  const fromMonth = months[Number(from[1]) - 1];
  const toMonth = months[Number(to[1]) - 1];
  if (!fromMonth || !toMonth) return '';
  if (fromMonth === toMonth && from[0] === to[0])
    return `${fromMonth} ${to[0]}`;
  return `${fromMonth} — ${toMonth} ${to[0]}`;
}

function logo(
  doc: jsPDF,
  assets: PdfAssets,
  x: number,
  y: number,
  w: number,
): void {
  const h = (w * 108) / 799;
  if (assets.logo) {
    try {
      doc.addImage(
        assets.logo,
        'PNG',
        u(x),
        u(y),
        u(w),
        u(h),
        undefined,
        'FAST',
      );
      return;
    } catch {
      // Sin logotipo utilizable, el nombre lo sustituye.
    }
  }
  text(doc, 'in-Store Media', x, y + h * 0.75, {
    size: 16,
    bold: true,
    color: NAVY,
  });
}

/** Cabecera común de las páginas interiores. */
function pageHeader(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
): void {
  logo(doc, assets, M, 34, 192);
  text(doc, report.campaignName.toUpperCase(), CANVAS_W - M, 45, {
    size: 9,
    bold: true,
    color: PINK,
    align: 'right',
    tracking: 2,
  });
  text(
    doc,
    `${formatCivilDate(report.startDate)} — ${formatCivilDate(report.endDate)} · ${brandHeader(report).days} días`,
    CANVAS_W - M,
    62,
    { size: 9, color: MUTED, align: 'right' },
  );
  block(doc, M, 88, CONTENT_W, 1, HAIR);
}

function pageFooter(doc: jsPDF, page: number, note: string): void {
  block(doc, M, CANVAS_H - 62, CONTENT_W, 1, HAIR);
  text(doc, 'in-Store Media', M, CANVAS_H - 36, {
    size: 9.5,
    bold: true,
    color: NAVY,
  });
  text(doc, note, M + 84, CANVAS_H - 36, {
    size: 8.5,
    color: MUTED,
    tracking: 1,
  });
  block(doc, CANVAS_W - M - 30, CANVAS_H - 54, 30, 30, NAVY);
  text(doc, String(page).padStart(2, '0'), CANVAS_W - M - 15, CANVAS_H - 34, {
    size: 12,
    bold: true,
    color: WHITE,
    align: 'center',
  });
}

/** Barra rosa más rótulo de sección. */
function eyebrow(doc: jsPDF, label: string, y: number): void {
  block(doc, M, y, 26, 4, PINK);
  text(doc, label, M + 36, y + 7, {
    size: 10,
    bold: true,
    color: BLUE,
    tracking: 2.4,
  });
}

function sectionLabel(doc: jsPDF, label: string, x: number, y: number): void {
  text(doc, label, x, y, { size: 9, bold: true, color: NAVY, tracking: 1.6 });
}

/** Cita destacada sobre fondo rosa pálido o azul marino. */
function quote(
  doc: jsPDF,
  value: string,
  y: number,
  height: number,
  dark = false,
): void {
  block(doc, M, y, CONTENT_W, height, dark ? NAVY : PINK_PALE);
  if (!dark) block(doc, M, y, 5, height, PINK);
  text(doc, '"', M + 26, y + 44, { size: 46, bold: true, color: PINK });
  paragraph(doc, value, M + 62, y + 28, CONTENT_W - 86, {
    size: 11.5,
    color: dark ? WHITE : NAVY,
    lineHeight: 18,
  });
}

function coverPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  const summary = brandCampaignSummary(report);
  const header = brandHeader(report);

  logo(doc, assets, M, 34, 236);
  block(doc, CANVAS_W - M - 26, 34, 26, 3, PINK);
  text(doc, 'REPORTE DE CAMPAÑA', CANVAS_W - M, 51, {
    size: 9,
    bold: true,
    color: PINK,
    align: 'right',
    tracking: 2.2,
  });
  text(doc, periodLabel(report), CANVAS_W - M, 68, {
    size: 10,
    bold: true,
    color: NAVY,
    align: 'right',
  });

  block(doc, 0, 104, CANVAS_W, 616, NAVY);

  if (assets.cover) {
    photoCover(doc, assets.cover, 'JPEG', 384, 104, 410, 456, 0.82, 0.5);
    const toRight: AlphaStop[] = [
      [0, 1],
      [0.16, 0.9],
      [0.48, 0.42],
      [1, 0.1],
    ];
    const toBottom: AlphaStop[] = [
      [0, 0],
      [0.34, 0],
      [0.7, 0.55],
      [1, 1],
    ];
    fade(doc, 384, 104, 410, 456, NAVY, toRight, 'right');
    fade(doc, 384, 104, 410, 456, NAVY, toBottom, 'down');
  }

  block(doc, M, 168, 34, 4, PINK);
  text(doc, 'AUDIENCIA MEDIDA', M, 196, {
    size: 9,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 3,
  });
  text(doc, 'EN PUNTO DE VENTA', M, 211, {
    size: 9,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 3,
  });
  const nameEnd = paragraph(
    doc,
    report.campaignName.toUpperCase(),
    M,
    260,
    324,
    { size: 30, bold: true, color: WHITE, lineHeight: 35 },
  );
  // Un nombre largo no puede empujar los metadatos sobre la cifra principal.
  const metaTop = Math.min(nameEnd + 18, 470);
  text(doc, `Circuito Liverpool · ${header.totalStores} tiendas`, M, metaTop, {
    size: 10.5,
    color: BLUE_PALE,
  });
  const supports = header.supports.join(' · ');
  if (supports) {
    text(doc, supports, M, metaTop + 17, { size: 10.5, color: BLUE_PALE });
  }

  const hero = formatCount(summary.estimatedOts);
  text(doc, hero, M, 638, { size: 78, bold: true, color: WHITE });
  const heroEnd = M + textWidth(doc, hero, 78, true) + 22;
  block(doc, heroEnd, 570, 34, 4, PINK);
  text(doc, 'OPORTUNIDADES', heroEnd, 597, {
    size: 11,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });
  text(doc, 'DE VER · OTS', heroEnd, 614, {
    size: 11,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });

  const tiles: Array<[string, string, RGB, RGB]> = [
    [formatCount(summary.dailyAverage), 'OTS PROMEDIO DIARIO', SKY, BLUE],
    [String(header.totalStores), 'TIENDAS LIVERPOOL', SKY, BLUE],
    [
      formatPercent(summary.coverage.storeDayPercent, 1),
      'MEDICIÓN DIRECTA',
      PINK_PALE,
      PINK,
    ],
  ];
  const tileW = (CONTENT_W - 28) / 3;
  tiles.forEach(([value, label, background, accent], index) => {
    const x = M + index * (tileW + 14);
    block(doc, x, 756, tileW, 86, background);
    block(doc, x, 756, 4, 86, accent);
    text(doc, value, x + 18, 806, { size: 30, bold: true, color: NAVY });
    text(doc, label, x + 18, 826, {
      size: 9,
      bold: true,
      color: accent,
      tracking: 1.2,
    });
  });

  const meta: Array<[string, string]> = [
    ['RETAILER', 'Liverpool'],
    [
      'VIGENCIA',
      `${formatCivilDate(report.startDate)} — ${formatCivilDate(report.endDate)} · ${header.days} días`,
    ],
    ['FORMATOS', header.supports.join(' · ') || 'Pantallas In-Store'],
  ];
  let metaX = M;
  meta.forEach(([label, value]) => {
    text(doc, label, metaX, 897, {
      size: 9,
      bold: true,
      color: MUTED,
      tracking: 1.4,
    });
    text(doc, value, metaX, 917, { size: 13, bold: true, color: NAVY });
    metaX +=
      Math.max(
        textWidth(doc, value, 13, true),
        textWidth(doc, label, 9, true),
      ) + 40;
  });

  block(doc, M, CANVAS_H - 84, 40, 4, PINK);
  text(doc, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.', M, CANVAS_H - 59, {
    size: 12,
    bold: true,
    color: NAVY,
    tracking: 2.4,
  });
  block(doc, CANVAS_W - M - 30, CANVAS_H - 74, 30, 30, NAVY);
  text(doc, '01', CANVAS_W - M - 15, CANVAS_H - 54, {
    size: 12,
    bold: true,
    color: WHITE,
    align: 'center',
  });
}

function summaryPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const summary = brandCampaignSummary(report);
  const { coverage, basis } = summary;

  eyebrow(doc, '01 · RESUMEN EJECUTIVO', 118);
  text(doc, 'La campaña en una cifra', M, 158, {
    size: 31,
    bold: true,
    color: NAVY,
  });
  paragraph(
    doc,
    'Resultado agregado del circuito Liverpool durante la vigencia. Combina medición directa en tienda con estimación sobre la parte del universo contratado que no se midió.',
    M,
    190,
    560,
    { size: 11.5, lineHeight: 18 },
  );

  block(doc, M, 262, CONTENT_W, 206, NAVY);
  const hero = formatCount(summary.estimatedOts);
  text(doc, hero, M + 32, 348, { size: 62, bold: true, color: WHITE });
  const heroEnd = M + 32 + textWidth(doc, hero, 62, true) + 18;
  text(doc, 'OTS ESTIMADOS', heroEnd, 328, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });
  text(doc, 'DE CAMPAÑA', heroEnd, 343, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });

  // Reparto medido / extrapolado, proporcional a los OTS y no a las tiendas.
  const barW = CONTENT_W - 64;
  const measuredShare =
    summary.estimatedOts > 0 ? summary.measuredOts / summary.estimatedOts : 0;
  const measuredW = Math.max(0, Math.min(barW, barW * measuredShare));
  block(doc, M + 32, 388, measuredW, 26, BLUE);
  block(doc, M + 32 + measuredW, 388, barW - measuredW, 26, BLUE_MID);
  text(doc, formatCount(summary.measuredOts), M + 32, 436, {
    size: 15,
    bold: true,
    color: WHITE,
  });
  text(doc, 'OTS MEDIDOS', M + 32, 452, {
    size: 9,
    bold: true,
    color: BLUE_PALE,
    tracking: 1.2,
  });
  // La etiqueta derecha sigue al corte de la barra, sin salirse de la caja.
  const rightX = Math.min(
    M + 32 + Math.max(measuredW, 120),
    M + CONTENT_W - 170,
  );
  text(doc, formatCount(summary.extrapolatedOts), rightX, 436, {
    size: 15,
    bold: true,
    color: WHITE,
  });
  text(doc, 'OTS EXTRAPOLADOS', rightX, 452, {
    size: 9,
    bold: true,
    color: BLUE_PALE,
    tracking: 1.2,
  });

  const stats: Array<[string, string, string]> = [
    [
      formatCount(summary.dailyAverage),
      'OTS / DÍA',
      `Promedio sobre los ${basis.days} días de vigencia.`,
    ],
    [
      formatCount(summary.dailyPerStore),
      'OTS / DÍA / TIENDA',
      `Repartido entre las ${coverage.totalStores} tiendas del universo.`,
    ],
    [
      formatCount(summary.dailyPerSupport),
      'OTS / DÍA / SOPORTE',
      `Sobre los ${basis.totalPairs} pares tienda-soporte.`,
    ],
  ];
  const statW = (CONTENT_W - 28) / 3;
  stats.forEach(([value, label, note], index) => {
    const x = M + index * (statW + 14);
    block(doc, x, 488, statW, 132, SOFT);
    block(doc, x, 488, statW, 4, BLUE);
    text(doc, value, x + 20, 536, { size: 28, bold: true, color: NAVY });
    text(doc, label, x + 20, 556, {
      size: 9,
      bold: true,
      color: BLUE,
      tracking: 1.2,
    });
    paragraph(doc, note, x + 20, 578, statW - 40, { size: 9, lineHeight: 13 });
  });

  block(doc, M, 640, 258, 270, SOFT);
  sectionLabel(doc, 'COMPLETITUD DE MEDICIÓN', M + 22, 674);
  donut(doc, M + 129, 787, 60, 26, coverage.storeDayPercent);
  text(doc, formatPercent(coverage.storeDayPercent, 1), M + 129, 795, {
    size: 32,
    bold: true,
    color: NAVY,
    align: 'center',
  });
  text(doc, 'tienda-día medidos', M + 129, 814, {
    size: 10,
    color: MUTED,
    align: 'center',
  });
  paragraph(
    doc,
    `${formatCount(coverage.measuredStoreDays)} de ${formatCount(coverage.totalStoreDays)} tienda-día con dato directo. El resto se estima.`,
    M + 22,
    880,
    214,
    { size: 9.5, align: 'center', lineHeight: 14 },
  );

  const rightCardX = M + 272;
  const rightCardW = CONTENT_W - 272;
  block(doc, rightCardX, 640, rightCardW, 270, SOFT);
  sectionLabel(doc, 'DESPLIEGUE DE CÁMARAS', rightCardX + 22, 674);
  text(doc, String(coverage.measuredStores), rightCardX + 22, 720, {
    size: 44,
    bold: true,
    color: BLUE,
  });
  const deployedEnd =
    rightCardX +
    22 +
    textWidth(doc, String(coverage.measuredStores), 44, true) +
    14;
  text(doc, `de ${coverage.totalStores} tiendas`, deployedEnd, 703, {
    size: 11,
    bold: true,
    color: NAVY,
  });
  text(doc, 'tienen cámara instalada', deployedEnd, 718, {
    size: 11,
    bold: true,
    color: NAVY,
  });

  // Una tienda por icono: los llenos midieron, los grises no tienen cámara.
  // Por encima de 48 no caben sin mentir por omisión, así que se dibuja la
  // proporción como barra.
  const perRow = 12;
  const glyph = 21;
  const glyphGap = 7;
  const asGlyphs = coverage.totalStores > 0 && coverage.totalStores <= 48;
  let legendY: number;
  if (asGlyphs) {
    for (let i = 0; i < coverage.totalStores; i += 1) {
      storeGlyph(
        doc,
        rightCardX + 22 + (i % perRow) * (glyph + glyphGap),
        742 + Math.floor(i / perRow) * (glyph + glyphGap),
        glyph,
        i < coverage.measuredStores ? BLUE : GRAY,
        SOFT,
      );
    }
    legendY =
      742 + Math.ceil(coverage.totalStores / perRow) * (glyph + glyphGap) + 18;
  } else {
    const track = rightCardW - 44;
    const filled =
      coverage.totalStores > 0
        ? (coverage.measuredStores / coverage.totalStores) * track
        : 0;
    block(doc, rightCardX + 22, 748, track, 26, GRAY);
    if (filled > 0) block(doc, rightCardX + 22, 748, filled, 26, BLUE);
    legendY = 810;
  }
  block(doc, rightCardX + 22, legendY - 9, 9, 9, BLUE);
  text(doc, 'Con medición', rightCardX + 38, legendY, { size: 9, color: NAVY });
  block(doc, rightCardX + 130, legendY - 9, 9, 9, GRAY);
  text(doc, 'Sin cámara', rightCardX + 146, legendY, { size: 9, color: NAVY });
  paragraph(
    doc,
    'El despliegue describe dónde hay cámara. La completitud, a la izquierda, mide cuántos días esa cámara realmente reportó.',
    rightCardX + 22,
    legendY + 24,
    rightCardW - 44,
    { size: 9.5, lineHeight: 14 },
  );

  quote(
    doc,
    `${formatPercent(coverage.storeDayPercent, 0)} de los tienda-día se midieron directamente en punto de venta. La parte restante del universo contratado se estima con el promedio real observado, nunca con un supuesto de mercado.`,
    926,
    84,
  );
  pageFooter(doc, 2, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.');
}

function coveragePage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const { basis } = brandCampaignSummary(report);
  const daily = brandDaily(report);

  eyebrow(doc, '02 · COBERTURA Y EVOLUCIÓN', 118);
  text(doc, 'Cómo se midió la campaña', M, 158, {
    size: 31,
    bold: true,
    color: NAVY,
  });
  paragraph(
    doc,
    `Cada tienda y cada soporte debían medirse los ${basis.days} días de vigencia. Esta es la rejilla completa y qué parte de ella tiene dato real.`,
    M,
    190,
    600,
    { size: 11.5, lineHeight: 18 },
  );

  sectionLabel(doc, 'REJILLA TIENDA-SOPORTE-DÍA DE LA CAMPAÑA', M, 268);
  text(
    doc,
    `${basis.totalPairs} soportes × ${basis.days} días = ${formatCount(basis.totalPairDays)}`,
    CANVAS_W - M,
    268,
    { size: 9, color: MUTED, align: 'right' },
  );

  const segments: Array<[number, RGB, string, string, RGB]> = [
    [
      basis.completePairDays,
      BLUE,
      'MEDICIÓN COMPLETA',
      'Todas las cámaras del soporte reportaron la jornada.',
      BLUE,
    ],
    [
      basis.partialPairDays,
      BLUE_LIGHT,
      'MEDICIÓN PARCIAL',
      'Jornada incompleta. El dato se usa y se registra.',
      BLUE,
    ],
    [
      basis.missingPairDays,
      PINK,
      'SIN DATO',
      'Hay cámara, pero no reportó ese día.',
      PINK,
    ],
    [
      basis.uncoveredPairDays,
      GRAY,
      'SIN CÁMARA',
      'Soportes del universo aún sin medición.',
      MUTED,
    ],
  ];
  const total = Math.max(1, basis.totalPairDays);
  let barX = M;
  segments.forEach(([count, color], index) => {
    const isLast = index === segments.length - 1;
    const width = isLast
      ? Math.max(0, M + CONTENT_W - barX)
      : (count / total) * CONTENT_W;
    if (width > 0) block(doc, barX, 292, width, 40, color);
    barX += width;
  });

  const legendW = (CONTENT_W - 36) / 4;
  segments.forEach(([count, color, label, note, labelColor], index) => {
    const x = M + index * (legendW + 12);
    block(doc, x, 352, legendW, 4, color);
    text(doc, formatCount(count), x, 382, {
      size: 22,
      bold: true,
      color: NAVY,
    });
    text(doc, label, x, 400, { size: 9, bold: true, color: labelColor });
    paragraph(doc, note, x, 418, legendW, { size: 9, lineHeight: 13 });
  });

  block(doc, M, 468, CONTENT_W, 340, SOFT);
  sectionLabel(doc, 'EVOLUCIÓN DE LA AUDIENCIA', M + 26, 502);
  text(doc, 'OTS estimados por día de campaña', CANVAS_W - M - 26, 502, {
    size: 9,
    color: MUTED,
    align: 'right',
  });

  // En vigencias largas la serie diaria se agrupa por semanas: 60 barras no
  // caben legibles en A4 y el gerente lee tendencia, no día a día.
  const buckets = groupDaily(daily);
  const chartX = M + 26;
  const chartW = CONTENT_W - 52;
  const chartBottom = 748;
  const chartH = 216;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.value));
  const slotW = chartW / Math.max(1, buckets.length);
  const barW = Math.min(59, slotW * 0.72);
  const peak = buckets.reduce(
    (best, bucket) => (bucket.value > best.value ? bucket : best),
    buckets[0] ?? { label: '', value: 0 },
  );

  buckets.forEach((bucket) => {
    const height = (bucket.value / max) * chartH;
    const x = chartX + (buckets.indexOf(bucket) + 0.5) * slotW - barW / 2;
    const isPeak = bucket.value === peak.value && bucket.value > 0;
    block(doc, x, chartBottom - height, barW, height, isPeak ? PINK : BLUE);
    text(doc, compact(bucket.value), x + barW / 2, chartBottom - height - 8, {
      size: 10,
      bold: true,
      color: isPeak ? PINK : NAVY,
      align: 'center',
    });
    text(doc, bucket.label, x + barW / 2, chartBottom + 18, {
      size: 9,
      bold: isPeak,
      color: isPeak ? PINK : MUTED,
      align: 'center',
    });
  });

  text(
    doc,
    'Serie agregada del circuito, incluyendo extrapolación.',
    M + 26,
    790,
    {
      size: 9.5,
      color: MUTED,
    },
  );

  quote(
    doc,
    'Cada periodo se escala por los soportes que realmente midieron en él. Así, un fallo de medición nunca se dibuja como una caída de audiencia: la curva refleja al público, no al estado de las cámaras.',
    834,
    84,
  );
  pageFooter(doc, 3, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.');
}

interface Bucket {
  label: string;
  value: number;
}

/** Agrupa la serie diaria para que quepa legible: días, o semanas si son muchos. */
function groupDaily(daily: ReturnType<typeof brandDaily>): Bucket[] {
  if (daily.length === 0) return [];
  if (daily.length <= 12) {
    return daily.map((point) => ({
      label: point.label,
      value: point.estimatedOts,
    }));
  }
  const perBucket = Math.ceil(daily.length / 9);
  const buckets: Bucket[] = [];
  for (let start = 0; start < daily.length; start += perBucket) {
    const slice = daily.slice(start, start + perBucket);
    if (slice.length === 0) continue;
    const totalOts = slice.reduce((sum, point) => sum + point.estimatedOts, 0);
    buckets.push({
      label: `S${buckets.length + 1}`,
      value: totalOts / slice.length,
    });
  }
  return buckets;
}

/** `1,120,000` → `1.12M`; `920,000` → `920K`. Etiquetas cortas sobre barra. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return formatCount(value);
}

function audiencePage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const gender = brandGender(report);
  const age = brandAge(report).slice(0, 5);
  const bands = brandTimeOfDay(report);

  eyebrow(doc, '03 · PERFIL DE AUDIENCIA', 118);
  text(doc, 'Quién vio la campaña', M, 158, {
    size: 31,
    bold: true,
    color: NAVY,
  });
  paragraph(
    doc,
    'Composición agregada del público alcanzado. Se expresa siempre en porcentaje: el informe no publica conteos de personas ni resultados por tienda.',
    M,
    190,
    600,
    { size: 11.5, lineHeight: 18 },
  );

  block(doc, M, 244, CONTENT_W, 186, SOFT);
  sectionLabel(doc, 'GÉNERO', M + 26, 276);
  const topGender = gender.slice(0, 2);
  if (topGender.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', M + 26, 340, {
      size: 11,
      color: MUTED,
    });
  } else {
    topGender.forEach((share, index) => {
      const x = M + 26 + index * ((CONTENT_W - 52) / 2);
      const accent = index === 0 ? PINK : BLUE;
      text(doc, formatPercent(share.share, 0), x, 366, {
        size: 52,
        bold: true,
        color: NAVY,
      });
      text(doc, share.label.toUpperCase(), x, 392, {
        size: 11,
        bold: true,
        color: accent,
        tracking: 1.4,
      });
      block(doc, x, 300, 34, 4, accent);
    });
    if (topGender.length === 2) {
      block(doc, M + 26 + (CONTENT_W - 52) / 2 - 22, 300, 1, 96, HAIR);
    }
  }

  block(doc, M, 450, CONTENT_W, 236, SOFT);
  sectionLabel(doc, 'RANGO DE EDAD', M + 26, 482);
  const ageColors: RGB[] = [BLUE, BLUE_LIGHT, BLUE_MID, BLUE_PALE, GRAY];
  const trackW = 380;
  age.forEach((share, index) => {
    const y = 516 + index * 32;
    text(doc, share.label, M + 26, y + 13, { size: 10.5, color: NAVY });
    block(doc, M + 200, y, trackW, 18, HAIR);
    const width = Math.max(0, Math.min(trackW, (share.share / 100) * trackW));
    if (width > 0) {
      block(doc, M + 200, y, width, 18, ageColors[index] ?? BLUE);
    }
    text(doc, formatPercent(share.share, 0), M + 596, y + 14, {
      size: 14,
      bold: true,
      color: NAVY,
    });
  });
  if (age.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', M + 26, 540, {
      size: 11,
      color: MUTED,
    });
  }

  sectionLabel(doc, 'MOMENTO DEL DÍA', M, 716);
  if (bands.length === 0) {
    block(doc, M, 730, CONTENT_W, 126, SOFT);
    paragraph(
      doc,
      'El reporte de esta campaña no incluye detalle horario, por lo que no se publica el reparto por franja del día.',
      M + 20,
      768,
      CONTENT_W - 40,
      { size: 10.5, lineHeight: 16 },
    );
  } else {
    const leader = bands.reduce(
      (best, band) => (band.share > best.share ? band : best),
      bands[0] ?? { label: '', hours: '', share: 0 },
    );
    const bandW = (CONTENT_W - 28) / 3;
    bands.forEach((band, index) => {
      const x = M + index * (bandW + 14);
      const isLeader = band.label === leader.label;
      const accent = isLeader ? PINK : index === 0 ? BLUE_LIGHT : BLUE_MID;
      block(doc, x, 730, bandW, 126, isLeader ? PINK_PALE : SOFT);
      block(doc, x, 730, bandW, 4, accent);
      text(doc, formatPercent(band.share, 0), x + 20, 790, {
        size: 34,
        bold: true,
        color: NAVY,
      });
      text(doc, band.label.toUpperCase(), x + 20, 812, {
        size: 10,
        bold: true,
        color: isLeader ? PINK : NAVY,
      });
      text(doc, band.hours, x + 20, 828, { size: 9, color: MUTED });
    });
  }

  quote(
    doc,
    'Las distribuciones describen el perfil agregado del público alcanzado durante toda la vigencia. No se incluyen conteos absolutos de personas ni resultados desglosados por tienda.',
    884,
    84,
    true,
  );
  pageFooter(doc, 4, 'AUDIENCIAS REALES. OPORTUNIDADES REALES.');
}

function closingPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);

  eyebrow(doc, '04 · CÓMO SE OBTIENE ESTE DATO', 122);
  paragraph(
    doc,
    'Audiencia medida, no estimada de mercado',
    M,
    172,
    CONTENT_W,
    {
      size: 31,
      bold: true,
      color: NAVY,
      lineHeight: 36,
    },
  );

  const notes: Array<[string, string, string]> = [
    [
      '01',
      'Se mide en tienda',
      'La audiencia se registra en punto de venta, soporte a soporte y día a día, durante toda la vigencia contratada.',
    ],
    [
      '02',
      'El universo se completa con el dato real',
      'La parte del circuito sin medición directa se estima con el promedio observado en lo que sí se midió, nunca con un supuesto de mercado.',
    ],
    [
      '03',
      'Los resultados son agregados',
      'El informe reporta el circuito como conjunto y no publica el rendimiento individual de ninguna tienda.',
    ],
  ];
  const noteW = (CONTENT_W - 44) / 3;
  notes.forEach(([number, title, body], index) => {
    const x = M + index * (noteW + 22);
    block(doc, x, 250, noteW, 3, HAIR);
    text(doc, number, x, 294, { size: 26, bold: true, color: PINK });
    paragraph(doc, title, x, 318, noteW, {
      size: 12,
      bold: true,
      color: NAVY,
      lineHeight: 16,
    });
    paragraph(doc, body, x, 356, noteW, { size: 10, lineHeight: 16 });
  });

  block(doc, 0, 420, CANVAS_W, 590, NAVY);
  if (assets.closing) {
    photoCover(doc, assets.closing, 'JPEG', 380, 420, 414, 590, 0.36, 0.5);
    const toRight: AlphaStop[] = [
      [0, 1],
      [0.15, 0.9],
      [0.44, 0.34],
      [1, 0.06],
    ];
    const vertical: AlphaStop[] = [
      [0, 1],
      [0.12, 0.35],
      [0.32, 0],
      [0.68, 0],
      [0.88, 0.45],
      [1, 1],
    ];
    fade(doc, 380, 420, 414, 590, NAVY, toRight, 'right');
    fade(doc, 380, 420, 414, 590, NAVY, vertical, 'down');
  }

  block(doc, M, 560, 40, 4, PINK);
  paragraph(
    doc,
    'Medimos lo que pasa frente a la pantalla, no lo que suponemos.',
    M,
    612,
    300,
    { size: 24, bold: true, color: WHITE, lineHeight: 31 },
  );
  paragraph(
    doc,
    'Toda la audiencia de este informe procede de medición real en punto de venta durante la vigencia contratada.',
    M,
    742,
    300,
    { size: 11, color: BLUE_PALE, lineHeight: 19 },
  );
  block(doc, M, 800, 90, 1, BLUE_MID);
  text(doc, 'AUDIENCIAS REALES.', M, 834, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 2.2,
  });
  text(doc, 'OPORTUNIDADES REALES.', M, 852, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 2.2,
  });

  text(doc, 'in-Store Media', M, CANVAS_H - 36, {
    size: 9.5,
    bold: true,
    color: NAVY,
  });
  text(doc, 'Reporte de audiencia de campaña', M + 84, CANVAS_H - 36, {
    size: 8.5,
    color: MUTED,
    tracking: 1,
  });
  block(doc, CANVAS_W - M - 30, CANVAS_H - 54, 30, 30, NAVY);
  text(doc, '05', CANVAS_W - M - 15, CANVAS_H - 34, {
    size: 12,
    bold: true,
    color: WHITE,
    align: 'center',
  });
}

/** Genera el informe de audiencia de marca y lo devuelve como Blob. */
export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const assets = await loadAssets();
  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  doc.setLineWidth(u(0.75));

  coverPage(doc, report, assets);
  doc.addPage();
  summaryPage(doc, report, assets);
  doc.addPage();
  coveragePage(doc, report, assets);
  doc.addPage();
  audiencePage(doc, report, assets);
  doc.addPage();
  closingPage(doc, report, assets);

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
