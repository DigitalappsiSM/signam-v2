import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandCampaignSummary,
  brandCoverage,
  brandDaily,
  brandDwellTime,
  brandGenderAge,
  brandGenderByDay,
  brandHeader,
  brandHourlyDistribution,
  brandStoreAttribution,
  brandWeeklyEvolution,
  formatCivilDate,
  formatCount,
  formatPercent,
  weekStartOf,
  type BrandGenderDayPoint,
} from './quividiBrandReport';
import { WEEKDAY_LABELS } from './quividiMarketingAnalytics';
import {
  BLUE,
  BLUE_LIGHT,
  BLUE_PALE,
  CANVAS_H,
  CANVAS_W,
  GRAY_DARK,
  HAIR,
  MUTED,
  NAVY,
  PINK,
  PINK_PALE,
  SKY,
  SOFT,
  WHITE,
  block,
  paragraph,
  photoCover,
  fade,
  text,
  textWidth,
  u,
  type AlphaStop,
  type RGB,
} from './quividiPdfKit';

/**
 * Informe comercial de audiencia para marcas.
 *
 * El documento es deliberadamente agregado: comunica un único OTS de campaña,
 * su evolución, el perfil de la audiencia alcanzada y las tiendas con mejor
 * desempeño. No publica el proveedor de medición, las métricas de mirada ni
 * incidencias de cámara; ese detalle vive en el Excel técnico, cuya hoja
 * «Auditoría de cifras» reconstruye paso a paso la cifra que aquí se publica.
 *
 * El maquetado está en píxeles de un lienzo A4 a 96 dpi y `quividiPdfKit` lo
 * traduce a milímetros. El número de páginas se adapta al contenido: sólo
 * «Tiendas TOP» puede añadir páginas de más si el listado no cabe en una.
 */

const MIN_PAGE_COUNT = 5;
const M = 48;
const CONTENT_W = CANVAS_W - M * 2;

/**
 * Logotipo a color sobre fondo claro. El de `assets/ppt` es la versión blanca,
 * pensada para las diapositivas de fondo oscuro: sobre el blanco del informe
 * resulta invisible.
 */
const LOGO_PATH = '/report-assets/instore-media-color.png';
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
  const [logo, cover, closing] = await Promise.all([
    assetDataUrl(LOGO_PATH),
    assetDataUrl(COVER_PHOTO_PATH),
    assetDataUrl(CLOSING_PHOTO_PATH),
  ]);
  return { logo, cover, closing };
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

/** `2026-08-22` → `22/08`, para etiquetas de eje compactas. */
function shortCivilDate(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}`;
}

function weekdayShort(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? ''
    : (WEEKDAY_LABELS[parsed.getUTCDay()] ?? '');
}

const WEEKDAY_FULL = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
] as const;

/** `35.4` → `35 s`; `95` → `1 min 35 s`. Nunca más precisión de la que el dato sostiene. */
function formatDwell(seconds: number): string {
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} s`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return `${minutes} min ${String(rest).padStart(2, '0')} s`;
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
  text(doc, '“', M + 26, y + 46, { size: 48, bold: true, color: PINK });
  paragraph(doc, value, M + 62, y + 28, CONTENT_W - 86, {
    size: 11.5,
    color: dark ? WHITE : NAVY,
    lineHeight: 18,
  });
}

function legendDot(
  doc: jsPDF,
  x: number,
  y: number,
  color: RGB,
  label: string,
): number {
  block(doc, x, y - 7, 8, 8, color);
  text(doc, label, x + 13, y, { size: 8.5, color: MUTED });
  return x + 13 + textWidth(doc, label, 8.5) + 16;
}

function coverPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  const summary = brandCampaignSummary(report);
  const header = brandHeader(report);
  const coverage = brandCoverage(report);
  const attribution = brandStoreAttribution(report);
  const dwellSeconds = brandDwellTime(report);

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

  block(doc, 0, 104, CANVAS_W, 462, NAVY);

  if (assets.cover) {
    photoCover(doc, assets.cover, 'JPEG', 384, 104, 410, 330, 0.82, 0.5);
    const fromLeft: AlphaStop[] = [
      [0, 1],
      [0.06, 1],
      [0.2, 0.9],
      [0.5, 0.42],
      [1, 0.1],
    ];
    const fromBottom: AlphaStop[] = [
      [0, 1],
      [0.07, 1],
      [0.34, 0.55],
      [0.68, 0],
      [1, 0],
    ];
    fade(doc, 384, 104, 410, 330, NAVY, fromLeft, 'left');
    fade(doc, 384, 104, 410, 330, NAVY, fromBottom, 'bottom');
  }

  block(doc, M, 156, 34, 4, PINK);
  text(doc, 'AUDIENCIA MEDIDA', M, 184, {
    size: 9,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 3,
  });
  text(doc, 'EN PUNTO DE VENTA', M, 199, {
    size: 9,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 3,
  });
  const nameEnd = paragraph(
    doc,
    report.campaignName.toUpperCase(),
    M,
    248,
    324,
    { size: 30, bold: true, color: WHITE, lineHeight: 36 },
  );
  // Un nombre largo no puede empujar los metadatos sobre la cifra principal.
  const metaTop = Math.min(nameEnd + 30, 364);
  text(doc, `Circuito Liverpool · ${header.totalStores} tiendas`, M, metaTop, {
    size: 10.5,
    color: BLUE_PALE,
  });
  const supports = header.supports.join(' · ');
  if (supports) {
    text(doc, supports, M, metaTop + 19, { size: 10.5, color: BLUE_PALE });
  }

  const hero = formatCount(summary.estimatedOts);
  text(doc, hero, M, 508, { size: 66, bold: true, color: WHITE });
  const heroEnd = M + textWidth(doc, hero, 66, true) + 22;
  block(doc, heroEnd, 452, 34, 4, PINK);
  text(doc, 'OPORTUNIDADES', heroEnd, 479, {
    size: 11,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });
  text(doc, 'DE VER · OTS', heroEnd, 496, {
    size: 11,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });

  // Portada: una sola cifra protagonista. El reparto medido/estimado se
  // explica en el pie discreto, nunca como segunda cifra hero.
  const tiles: Array<[string, string]> = [
    [formatCount(summary.dailyAverage), 'OTS PROMEDIO DIARIOS'],
    [formatDwell(dwellSeconds), 'DWELL TIME PROMEDIO'],
    [
      `${formatCivilDate(report.startDate)} — ${formatCivilDate(report.endDate)}`,
      `VIGENCIA · ${header.days} DÍAS`,
    ],
  ];
  const tileW = (CONTENT_W - 28) / 3;
  const tileInnerW = tileW - 36;
  tiles.forEach(([value, label], index) => {
    const x = M + index * (tileW + 14);
    block(doc, x, 730, tileW, 96, SKY);
    block(doc, x, 730, 4, 96, BLUE);
    // El valor de cada tarjeta escala su tamaño hasta caber: un rango de
    // fechas no cabe a 22px, y forzarlo desbordaba la tarjeta hacia la
    // siguiente.
    let valueSize = 22;
    while (
      valueSize > 12 &&
      textWidth(doc, value, valueSize, true) > tileInnerW
    ) {
      valueSize -= 1;
    }
    text(doc, value, x + 18, 784, { size: valueSize, bold: true, color: NAVY });
    text(doc, label, x + 18, 806, {
      size: 9,
      bold: true,
      color: BLUE,
      tracking: 1.2,
    });
  });

  block(doc, M, 858, 22, 3, PINK);
  text(doc, 'FORMATOS QUE PARTICIPAN EN LA CIFRA', M + 34, 866, {
    size: 9,
    bold: true,
    color: MUTED,
    tracking: 1.4,
  });
  text(doc, header.supports.join(' · ') || 'Pantallas In-Store', M, 890, {
    size: 13,
    bold: true,
    color: NAVY,
  });

  // Pie discreto, sólo informativo: clasifica tiendas, no horas ni días.
  paragraph(
    doc,
    `${formatPercent(attribution.measuredStoresSharePercent, 0)} de los OTS corresponden a tiendas con medición en algún momento de la campaña (${coverage.measuredStores} de ${coverage.totalStores}) · ${formatPercent(attribution.unmeasuredStoresSharePercent, 0)} a tiendas sin medición directa (${coverage.estimatedStores} de ${coverage.totalStores}).`,
    M,
    CANVAS_H - 104,
    CONTENT_W,
    { size: 8.5, color: MUTED, lineHeight: 12 },
  );

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

/** Techo redondeado del eje, para que la barra más alta no toque el borde. */
function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find(
    (candidate) => normalized <= candidate,
  );
  return (step ?? 10) * magnitude;
}

/** `1,120,000` → `1.12M`; `920,000` → `920K`. Etiquetas cortas sobre barra. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return formatCount(value);
}

interface EvolutionPoint {
  value: number;
  top: string;
  bottom: string;
}

/**
 * Barras de evolución con eje adaptativo: hasta 28 puntos quedan legibles con
 * su valor rotulado; por encima, sólo se rotula el pico para no amontonar
 * texto. El ancho de barra y el tamaño de las etiquetas escalan con la
 * cantidad de puntos para que ninguno quede ilegible.
 */
function drawEvolutionChart(
  doc: jsPDF,
  points: EvolutionPoint[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (points.length === 0) {
    text(doc, 'Sin datos de evolución para esta vigencia.', x, y + 40, {
      size: 11,
      color: MUTED,
    });
    return;
  }
  const chartH = h - 60;
  const max = niceCeiling(Math.max(1, ...points.map((point) => point.value)));
  const slotW = w / points.length;
  const barW = Math.max(3, Math.min(48, slotW * 0.68));
  const showValues = points.length <= 20;
  const labelSize = points.length > 20 ? 7 : points.length > 14 ? 7.5 : 8.5;
  const peak = points.reduce(
    (best, point) => (point.value > best.value ? point : best),
    points[0]!,
  );

  points.forEach((point, index) => {
    const barX = x + (index + 0.5) * slotW - barW / 2;
    const barH = (point.value / max) * chartH;
    const isPeak = point.value === peak.value && point.value > 0;
    block(
      doc,
      barX,
      y + chartH - barH,
      barW,
      Math.max(1, barH),
      isPeak ? PINK : BLUE,
    );
    if (showValues) {
      text(doc, compact(point.value), barX + barW / 2, y + chartH - barH - 6, {
        size: labelSize + 1,
        bold: isPeak,
        color: isPeak ? PINK : NAVY,
        align: 'center',
      });
    }
    if (point.top) {
      text(doc, point.top, barX + barW / 2, y + chartH + 16, {
        size: labelSize,
        bold: isPeak,
        color: isPeak ? PINK : NAVY,
        align: 'center',
      });
    }
    text(
      doc,
      point.bottom,
      barX + barW / 2,
      y + chartH + 16 + (point.top ? labelSize + 4 : 0),
      { size: labelSize - 0.5, color: isPeak ? PINK : MUTED, align: 'center' },
    );
  });
}

function evolutionPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const header = brandHeader(report);
  const useWeekly = header.days > 28;

  eyebrow(doc, '01 · EVOLUCIÓN', 118);
  text(doc, 'Cómo evolucionó la audiencia', M, 158, {
    size: 30,
    bold: true,
    color: NAVY,
  });
  paragraph(
    doc,
    useWeekly
      ? `Serie semanal de OTS ajustados del circuito medible: cada barra suma los días con medición de esa semana a lo largo de los ${header.days} días de vigencia.`
      : `Serie diaria de OTS ajustados del circuito medible a lo largo de los ${header.days} días de vigencia. Cada barra concilia con la cifra de portada.`,
    M,
    190,
    620,
    { size: 11.5, lineHeight: 18 },
  );

  block(doc, M, 244, CONTENT_W, 560, SOFT);
  sectionLabel(
    doc,
    useWeekly
      ? 'OTS AJUSTADOS POR SEMANA DE CAMPAÑA'
      : 'OTS AJUSTADOS POR DÍA DE CAMPAÑA',
    M + 26,
    278,
  );

  const points: EvolutionPoint[] = useWeekly
    ? brandWeeklyEvolution(report).map((week, index) => ({
        value: week.estimatedOts,
        top: `Sem. ${index + 1}`,
        bottom: `${shortCivilDate(week.weekStart)}–${shortCivilDate(week.weekEnd)}`,
      }))
    : brandDaily(report).map((point) => ({
        value: point.estimatedOts,
        top: weekdayShort(point.date),
        bottom: point.label,
      }));

  drawEvolutionChart(doc, points, M + 26, 306, CONTENT_W - 52, 400);

  text(
    doc,
    useWeekly
      ? 'Serie agregada de los soportes con medición, sumada por semana natural (lunes a domingo).'
      : 'Serie agregada de los soportes con medición, incluyendo su estimación.',
    M + 26,
    724,
    { size: 9.5, color: MUTED },
  );

  quote(
    doc,
    useWeekly
      ? 'Cada semana suma días ya completados formato a formato con el promedio de ese mismo formato en la vigencia: un hueco de medición nunca se dibuja como una caída de audiencia.'
      : 'Cada día se completa formato a formato con el promedio de ese mismo formato en la vigencia: un hueco de medición nunca se dibuja como una caída de audiencia.',
    850,
    84,
  );

  pageFooter(
    doc,
    doc.getNumberOfPages(),
    'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
  );
}

/** Reagrupa la composición diaria por género en semanas naturales, ponderando por watchers del día. */
function bucketGenderWeekly(
  points: readonly BrandGenderDayPoint[],
): BrandGenderDayPoint[] {
  const weeks = new Map<string, BrandGenderDayPoint[]>();
  for (const point of points) {
    const key = weekStartOf(point.date);
    const bucket = weeks.get(key) ?? [];
    bucket.push(point);
    weeks.set(key, bucket);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, bucket]) => {
      const totalWatchers = bucket.reduce((sum, p) => sum + p.totalWatchers, 0);
      const weighted = (field: 'female' | 'male' | 'unknown') =>
        totalWatchers > 0
          ? bucket.reduce((sum, p) => sum + p[field] * p.totalWatchers, 0) /
            totalWatchers
          : 0;
      return {
        date: weekStart,
        female: weighted('female'),
        male: weighted('male'),
        unknown: weighted('unknown'),
        totalWatchers,
      };
    });
}

function drawGenderChart(
  doc: jsPDF,
  points: readonly BrandGenderDayPoint[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (points.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', x, y + 40, {
      size: 11,
      color: MUTED,
    });
    return;
  }
  const barsH = h - 30;
  const slotW = w / points.length;
  const barW = Math.max(3, Math.min(40, slotW * 0.72));
  const showLabels = points.length <= 20;

  points.forEach((point, index) => {
    const barX = x + (index + 0.5) * slotW - barW / 2;
    const femaleH = (point.female / 100) * barsH;
    const maleH = (point.male / 100) * barsH;
    const unknownH = (point.unknown / 100) * barsH;
    let cursor = y + barsH;
    if (unknownH > 0) {
      block(doc, barX, cursor - unknownH, barW, unknownH, GRAY_DARK);
      cursor -= unknownH;
    }
    if (maleH > 0) {
      block(doc, barX, cursor - maleH, barW, maleH, BLUE);
      cursor -= maleH;
    }
    if (femaleH > 0) {
      block(doc, barX, cursor - femaleH, barW, femaleH, PINK);
    }
    if (showLabels) {
      text(doc, shortCivilDate(point.date), barX + barW / 2, y + barsH + 16, {
        size: 7.5,
        color: MUTED,
        align: 'center',
      });
    }
  });
}

function drawHourlyChart(
  doc: jsPDF,
  points: ReturnType<typeof brandHourlyDistribution>,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const chartH = h - 34;
  const max = niceCeiling(Math.max(1, ...points.map((point) => point.share)));
  const slotW = w / points.length;
  const barW = Math.max(4, Math.min(48, slotW * 0.7));

  points.forEach((point, index) => {
    const barX = x + (index + 0.5) * slotW - barW / 2;
    const barH = (point.share / max) * chartH;
    block(doc, barX, y + chartH - barH, barW, Math.max(1, barH), BLUE);
    text(
      doc,
      `${Math.round(point.share)}%`,
      barX + barW / 2,
      y + chartH - barH - 6,
      { size: 7.5, bold: true, color: NAVY, align: 'center' },
    );
    text(
      doc,
      `${String(point.hour).padStart(2, '0')}h`,
      barX + barW / 2,
      y + chartH + 14,
      {
        size: 7.5,
        color: MUTED,
        align: 'center',
      },
    );
  });
}

function profilePage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const header = brandHeader(report);
  const genderByDay = brandGenderByDay(report);
  const genderPoints =
    header.days > 28 ? bucketGenderWeekly(genderByDay) : genderByDay;
  const hourly = brandHourlyDistribution(report);
  const pyramid = brandGenderAge(report).slice(0, 5);

  eyebrow(doc, '02 · PERFIL Y HORARIOS', 118);
  text(doc, 'Quién vio la campaña y cuándo', M, 158, {
    size: 26,
    bold: true,
    color: NAVY,
  });

  // Bloque A: composición por género, día a día (o semana a semana en
  // vigencias largas).
  block(doc, M, 196, CONTENT_W, 196, SOFT);
  sectionLabel(doc, 'COMPOSICIÓN POR GÉNERO · POR DÍA (%)', M + 22, 226);
  let legendX = CANVAS_W - M - 22 - 230;
  legendX = legendDot(doc, legendX, 226, PINK, 'Femenino');
  legendX = legendDot(doc, legendX, 226, BLUE, 'Masculino');
  legendDot(doc, legendX, 226, GRAY_DARK, 'No identificado');
  drawGenderChart(doc, genderPoints, M + 22, 246, CONTENT_W - 44, 116);
  text(
    doc,
    'El % "No identificado" se conserva tal cual lo reporta la medición; nunca se redistribuye entre mujeres y hombres.',
    M + 22,
    380,
    { size: 8.5, color: MUTED },
  );

  // Bloque B: distribución horaria de OTS con medición directa.
  block(doc, M, 410, CONTENT_W, 196, SOFT);
  sectionLabel(
    doc,
    'DISTRIBUCIÓN HORARIA DE OTS CON MEDICIÓN DIRECTA',
    M + 22,
    440,
  );
  if (hourly.length === 0) {
    paragraph(
      doc,
      'El reporte de esta campaña no incluye detalle horario, por lo que no se publica el reparto por hora.',
      M + 22,
      478,
      CONTENT_W - 44,
      { size: 10.5, lineHeight: 16 },
    );
  } else {
    drawHourlyChart(doc, hourly, M + 22, 454, CONTENT_W - 44, 136);
  }

  // Bloque C: pirámide de género y edad.
  sectionLabel(doc, 'PERFIL POR GÉNERO Y EDAD (% SOBRE EL TOTAL)', M, 646);
  if (pyramid.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', M, 700, {
      size: 11,
      color: MUTED,
    });
  } else {
    const axis = CANVAS_W / 2;
    const labelHalf = 78;
    const maxBar = 200;
    const peak = Math.max(
      ...pyramid.map((row) => Math.max(row.female, row.male)),
      1,
    );
    text(doc, 'MUJERES', axis - labelHalf - 8, 672, {
      size: 9,
      bold: true,
      color: PINK,
      align: 'right',
      tracking: 1.2,
    });
    text(doc, 'HOMBRES', axis + labelHalf + 8, 672, {
      size: 9,
      bold: true,
      color: BLUE,
      tracking: 1.2,
    });
    pyramid.forEach((row, index) => {
      const y = 684 + index * 27;
      const femaleW = (row.female / peak) * maxBar;
      const maleW = (row.male / peak) * maxBar;
      if (femaleW > 0) {
        block(doc, axis - labelHalf - femaleW, y, femaleW, 15, PINK);
      }
      if (maleW > 0) block(doc, axis + labelHalf, y, maleW, 15, BLUE);
      text(
        doc,
        formatPercent(row.female, 0),
        axis - labelHalf - femaleW - 7,
        y + 12,
        { size: 10, bold: true, color: NAVY, align: 'right' },
      );
      text(
        doc,
        formatPercent(row.male, 0),
        axis + labelHalf + maleW + 7,
        y + 12,
        {
          size: 10,
          bold: true,
          color: NAVY,
        },
      );
      text(doc, row.age, axis, y + 12, {
        size: 9,
        color: NAVY,
        align: 'center',
      });
    });
  }

  quote(
    doc,
    'Las distribuciones describen el perfil agregado del público alcanzado durante toda la vigencia y se aplican al universo ajustado, sin describir los segmentos extrapolados como medición directa. No se incluyen conteos absolutos de personas ni resultados desglosados por tienda.',
    900,
    88,
    true,
  );
  pageFooter(
    doc,
    doc.getNumberOfPages(),
    'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
  );
}

const TOP_STORES_ROWS_PER_PAGE = 16;

function topStoresPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  const attribution = brandStoreAttribution(report);
  const stores = attribution.stores.filter((store) => store.everMeasured);

  if (stores.length === 0) {
    pageHeader(doc, assets, report);
    eyebrow(doc, '03 · TIENDAS TOP', 118);
    text(doc, 'Tiendas TOP', M, 168, { size: 32, bold: true, color: NAVY });
    paragraph(
      doc,
      'Ninguna tienda registró medición directa durante esta vigencia.',
      M,
      210,
      CONTENT_W,
      { size: 11.5, lineHeight: 17 },
    );
    pageFooter(
      doc,
      doc.getNumberOfPages(),
      'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
    );
    return;
  }

  const hasInsurgentes = stores.some((store) =>
    store.storeName.toUpperCase().includes('INSURGENTES'),
  );
  const pageCount = Math.max(
    1,
    Math.ceil(stores.length / TOP_STORES_ROWS_PER_PAGE),
  );

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage();
    pageHeader(doc, assets, report);
    eyebrow(
      doc,
      pageIndex === 0 ? '03 · TIENDAS TOP' : '03 · TIENDAS TOP — CONTINUACIÓN',
      118,
    );
    text(doc, 'Tiendas TOP', M, 168, { size: 32, bold: true, color: NAVY });
    let tableTop = 220;
    if (pageIndex === 0) {
      tableTop = paragraph(
        doc,
        'Tiendas con medición válida en algún momento de la campaña. Los OTS ajustados incluyen las horas y días faltantes estimados para esa tienda.',
        M,
        202,
        620,
        { size: 11.5, lineHeight: 17 },
      );
      tableTop += 20;
    }

    text(doc, 'TIENDA', M + 16, tableTop, {
      size: 9.5,
      bold: true,
      color: MUTED,
      tracking: 1,
    });
    text(doc, 'OTS AJUSTADOS', M + CONTENT_W - 210, tableTop, {
      size: 9.5,
      bold: true,
      color: MUTED,
      tracking: 1,
      align: 'right',
    });
    text(doc, 'DWELL TIME PROM.', M + CONTENT_W - 16, tableTop, {
      size: 9.5,
      bold: true,
      color: MUTED,
      tracking: 1,
      align: 'right',
    });
    block(doc, M, tableTop + 8, CONTENT_W, 2, NAVY);

    const slice = stores.slice(
      pageIndex * TOP_STORES_ROWS_PER_PAGE,
      (pageIndex + 1) * TOP_STORES_ROWS_PER_PAGE,
    );
    const rowH = 38;
    const rowsTop = tableTop + 30;
    slice.forEach((store, index) => {
      const rowY = rowsTop + index * rowH;
      if (index % 2 === 0) block(doc, M, rowY - 16, CONTENT_W, rowH, SKY);
      text(doc, store.storeName, M + 16, rowY, {
        size: 12,
        bold: true,
        color: NAVY,
      });
      text(doc, formatCount(store.adjustedOts), M + CONTENT_W - 210, rowY, {
        size: 12,
        bold: true,
        color: NAVY,
        align: 'right',
      });
      text(doc, formatDwell(store.dwellSeconds), M + CONTENT_W - 16, rowY, {
        size: 12,
        color: NAVY,
        align: 'right',
      });
    });

    if (pageIndex === pageCount - 1) {
      let noteY = rowsTop + slice.length * rowH + 20;
      noteY = paragraph(
        doc,
        'La suma de esta tabla no equivale al total de campaña: la diferencia corresponde, entre otros factores, a las tiendas sin medición cuyos OTS estimados sí forman parte del total de portada pero no se listan aquí.',
        M,
        noteY,
        CONTENT_W,
        { size: 9.5, lineHeight: 14 },
      );
      if (hasInsurgentes) {
        quote(
          doc,
          'Insurgentes tiene dos cámaras que miden zonas distintas del mismo soporte; sus OTS válidos se suman (no se promedian) para esta vista comercial. La tienda cuenta una sola vez en el universo de campaña.',
          Math.min(noteY + 20, CANVAS_H - 176),
          76,
        );
      }
    }

    pageFooter(
      doc,
      doc.getNumberOfPages(),
      'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
    );
  }
}

function topWeekdayLabel(daily: ReturnType<typeof brandDaily>): string | null {
  if (daily.length === 0) return null;
  const totals = new Map<number, number>();
  for (const point of daily) {
    const parsed = new Date(`${point.date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = parsed.getUTCDay();
    totals.set(day, (totals.get(day) ?? 0) + point.estimatedOts);
  }
  const best = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0];
  return best ? (WEEKDAY_FULL[best[0]] ?? null) : null;
}

function topHourLabel(
  hourly: ReturnType<typeof brandHourlyDistribution>,
): string | null {
  if (hourly.length === 0) return null;
  const best = hourly.reduce(
    (top, point) => (point.share > top.share ? point : top),
    hourly[0]!,
  );
  return `${String(best.hour).padStart(2, '0')}:00`;
}

function closingPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const daily = brandDaily(report);
  const hourly = brandHourlyDistribution(report);
  const pyramid = brandGenderAge(report);

  eyebrow(doc, '04 · CIERRE', 122);
  paragraph(doc, 'Cómo aprovechar estos resultados', M, 172, CONTENT_W, {
    size: 27,
    bold: true,
    color: NAVY,
    lineHeight: 33,
  });

  const recommendations: Array<[string, string]> = [];
  const weekday = topWeekdayLabel(daily);
  if (weekday) {
    recommendations.push([
      'Refuerza el día de mayor audiencia',
      `Los ${weekday.toLowerCase()}s concentran la mayor proporción de OTS ajustados de la campaña. Si el calendario lo permite, prioriza ahí el material con la oferta principal.`,
    ]);
  }
  const hour = topHourLabel(hourly);
  if (hour) {
    recommendations.push([
      'Aprovecha la franja de mayor tránsito',
      `La hora ${hour} concentra la mayor proporción de OTS con medición directa durante la vigencia; es una referencia útil para calendarizar activaciones puntuales.`,
    ]);
  }
  const topAge = pyramid[0]?.age;
  if (topAge) {
    recommendations.push([
      'Habla al público que efectivamente llega',
      `${topAge} es el rango de edad con mayor presencia observada. Es una referencia útil para el tono creativo, no una garantía de conversión: la audiencia medida no equivale a ventas.`,
    ]);
  }
  if (recommendations.length === 0) {
    recommendations.push([
      'Resultado agregado del circuito',
      'Esta vigencia no reunió suficiente detalle horario o demográfico para desglosar recomendaciones puntuales; los resultados generales de campaña se mantienen disponibles en el resto del informe.',
    ]);
  }

  recommendations.slice(0, 3).forEach(([title, body], index) => {
    const y = 234 + index * 120;
    text(doc, String(index + 1).padStart(2, '0'), M, y + 28, {
      size: 28,
      bold: true,
      color: PINK,
    });
    block(doc, M + 44, y - 4, 1, 66, HAIR);
    text(doc, title, M + 66, y + 10, { size: 13, bold: true, color: NAVY });
    paragraph(doc, body, M + 66, y + 34, CONTENT_W - 66, {
      size: 10.5,
      lineHeight: 16,
    });
  });

  // La franja de cierre acompaña, no domina: mantiene la identidad visual del
  // informe actual.
  const bandY = 700;
  const bandH = 236;
  block(doc, 0, bandY, CANVAS_W, bandH, NAVY);
  if (assets.closing) {
    photoCover(doc, assets.closing, 'JPEG', 380, bandY, 414, bandH, 0.5, 0.42);
    const fromLeft: AlphaStop[] = [
      [0, 1],
      [0.06, 1],
      [0.2, 0.9],
      [0.46, 0.34],
      [1, 0.06],
    ];
    const fromTop: AlphaStop[] = [
      [0, 0.5],
      [0.22, 0],
      [1, 0],
    ];
    const fromBottom: AlphaStop[] = [
      [0, 0.55],
      [0.26, 0],
      [1, 0],
    ];
    fade(doc, 380, bandY, 414, bandH, NAVY, fromLeft, 'left');
    fade(doc, 380, bandY, 414, bandH, NAVY, fromTop, 'top');
    fade(doc, 380, bandY, 414, bandH, NAVY, fromBottom, 'bottom');
  }

  block(doc, M, bandY + 40, 34, 4, PINK);
  paragraph(
    doc,
    'Medimos lo que pasa frente a la pantalla, no lo que suponemos.',
    M,
    bandY + 84,
    296,
    { size: 19, bold: true, color: WHITE, lineHeight: 25 },
  );
  text(doc, 'AUDIENCIAS REALES.', M, bandY + 182, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 2.2,
  });
  text(doc, 'OPORTUNIDADES REALES.', M, bandY + 200, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 2.2,
  });

  const pageNumber = doc.getNumberOfPages();
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
  text(
    doc,
    String(pageNumber).padStart(2, '0'),
    CANVAS_W - M - 15,
    CANVAS_H - 34,
    { size: 12, bold: true, color: WHITE, align: 'center' },
  );
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
  evolutionPage(doc, report, assets);
  doc.addPage();
  profilePage(doc, report, assets);
  doc.addPage();
  topStoresPage(doc, report, assets);
  doc.addPage();
  closingPage(doc, report, assets);

  if (doc.getNumberOfPages() < MIN_PAGE_COUNT) {
    throw new Error(
      `El informe comercial debe contener al menos ${MIN_PAGE_COUNT} páginas.`,
    );
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
