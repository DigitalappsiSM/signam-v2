import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandCampaignSummary,
  brandCoverage,
  brandDaily,
  brandDwellTime,
  brandGender,
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
  CANVAS_H,
  CANVAS_W,
  GRAY_DARK,
  HAIR,
  MUTED,
  NAVY,
  PINK,
  PINK_PALE,
  SKY,
  WHITE,
  block,
  calendarIcon,
  clockIcon,
  eyeIcon,
  fade,
  paragraph,
  peopleIcon,
  photoCover,
  sparkline,
  text,
  textWidth,
  trendIcon,
  u,
  type AlphaStop,
} from './quividiPdfKit';

/**
 * Informe comercial de audiencia para marcas — formato A4 horizontal.
 *
 * Seis secciones, cada una con un solo visual protagonista: Portada,
 * Evolución, Audiencia, Horarios, Tiendas TOP y Cierre. No publica el
 * proveedor de medición, las métricas de mirada ni incidencias de cámara; ese
 * detalle vive en el Excel técnico, cuya hoja «Auditoría de cifras»
 * reconstruye paso a paso la cifra que aquí se publica.
 *
 * El maquetado está en píxeles de un lienzo A4 horizontal a 96 dpi
 * (1123 × 794) y `quividiPdfKit` lo traduce a milímetros. El número de
 * páginas se adapta al contenido: sólo «Tiendas TOP» puede añadir páginas de
 * más si el listado no cabe en una.
 */

const MIN_PAGE_COUNT = 6;
const M = 56;
const CONTENT_W = CANVAS_W - M * 2;

const LOGO_PATH = '/report-assets/instore-media-color.png';
const COVER_PHOTO_PATH = '/report-assets/liverpool-mupi-cover.jpg';
const CLOSING_PHOTO_PATH = '/report-assets/liverpool-banner-closing.jpg';
/** Proporción real del logo (799×108 px), para no deformarlo al escalar. */
const LOGO_ASPECT = 799 / 108;

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
  h: number,
): void {
  const w = h * LOGO_ASPECT;
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
  text(doc, 'in-Store Media', x, y + h * 0.8, {
    size: h * 0.55,
    bold: true,
    color: NAVY,
  });
}

/** Cabecera común: logo a la izquierda, campaña y vigencia a la derecha. */
function pageHeader(
  doc: jsPDF,
  assets: PdfAssets,
  report: QuividiCampaignReport,
): void {
  logo(doc, assets, M, 22, 22);
  text(doc, report.campaignName.toUpperCase(), CANVAS_W - M, 32, {
    size: 10,
    bold: true,
    color: PINK,
    align: 'right',
    tracking: 1.6,
  });
  text(
    doc,
    `${formatCivilDate(report.startDate)} — ${formatCivilDate(report.endDate)} · ${brandHeader(report).days} días`,
    CANVAS_W - M,
    48,
    { size: 10, color: MUTED, align: 'right' },
  );
  block(doc, M, 66, CONTENT_W, 1, HAIR);
}

function pageFooter(
  doc: jsPDF,
  page: number,
  note: string,
  rightNote?: string,
): void {
  block(doc, M, CANVAS_H - 40, CONTENT_W, 1, HAIR);
  text(doc, 'in-Store Media', M, CANVAS_H - 20, {
    size: 9,
    bold: true,
    color: NAVY,
  });
  text(doc, note, M + 76, CANVAS_H - 20, {
    size: 8,
    color: MUTED,
    tracking: 1,
  });
  if (rightNote) {
    text(doc, rightNote, CANVAS_W - M - 32, CANVAS_H - 20, {
      size: 8,
      color: GRAY_DARK,
      align: 'right',
    });
  }
  block(doc, CANVAS_W - M - 24, CANVAS_H - 34, 24, 18, NAVY);
  text(doc, String(page).padStart(2, '0'), CANVAS_W - M - 12, CANVAS_H - 22, {
    size: 10,
    bold: true,
    color: WHITE,
    align: 'center',
  });
}

type IconFn = (
  doc: jsPDF,
  x: number,
  y: number,
  size: number,
  color: readonly [number, number, number],
) => void;

/** Barra rosa, rótulo de sección y un icono pequeño de apoyo. */
function eyebrow(doc: jsPDF, label: string, y: number, icon?: IconFn): void {
  block(doc, M, y, 20, 4, PINK);
  text(doc, label, M + 30, y + 7, {
    size: 9.5,
    bold: true,
    color: PINK,
    tracking: 1.4,
  });
  if (icon) {
    const labelW = textWidth(doc, label, 9.5, true) + label.length * 1.4;
    icon(doc, M + 30 + labelW + 10, y - 3, 13, PINK);
  }
}

function sectionLabel(doc: jsPDF, label: string, x: number, y: number): void {
  text(doc, label, x, y, {
    size: 8.5,
    bold: true,
    color: MUTED,
    tracking: 1.1,
  });
}

function coverPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  const summary = brandCampaignSummary(report);
  const header = brandHeader(report);
  const dwellSeconds = brandDwellTime(report);
  const daily = brandDaily(report);

  logo(doc, assets, M, 24, 28);
  block(doc, CANVAS_W - M - 26, 24, 26, 3, PINK);
  text(doc, 'REPORTE DE CAMPAÑA', CANVAS_W - M, 40, {
    size: 9,
    bold: true,
    color: PINK,
    align: 'right',
    tracking: 2.2,
  });
  text(doc, periodLabel(report), CANVAS_W - M, 56, {
    size: 10,
    bold: true,
    color: NAVY,
    align: 'right',
  });

  const LEFT_W = 615;
  const PHOTO_X = LEFT_W;
  const PHOTO_W = CANVAS_W - LEFT_W;
  const BODY_TOP = 82;

  // Panel de foto: a todo lo alto, sin desenfoque — el soporte debe
  // distinguirse con nitidez. El degradado sólo vela el lado del texto.
  if (assets.cover) {
    photoCover(
      doc,
      assets.cover,
      'JPEG',
      PHOTO_X,
      BODY_TOP,
      PHOTO_W,
      CANVAS_H - BODY_TOP,
      0.86,
      0.42,
    );
    const fromLeft: AlphaStop[] = [
      [0, 1],
      [0.18, 0.92],
      [0.34, 0.55],
      [0.52, 0.06],
      [0.62, 0],
    ];
    const fromBottom: AlphaStop[] = [
      [0, 0.5],
      [0.3, 0],
    ];
    fade(
      doc,
      PHOTO_X,
      BODY_TOP,
      PHOTO_W,
      CANVAS_H - BODY_TOP,
      NAVY,
      fromLeft,
      'left',
    );
    fade(
      doc,
      PHOTO_X,
      BODY_TOP,
      PHOTO_W,
      CANVAS_H - BODY_TOP,
      NAVY,
      fromBottom,
      'bottom',
    );
  } else {
    block(doc, PHOTO_X, BODY_TOP, PHOTO_W, CANVAS_H - BODY_TOP, NAVY);
  }
  block(doc, PHOTO_X + 36, CANVAS_H - 90, 30, 3, PINK);
  text(doc, 'AUDIENCIAS REALES.', PHOTO_X + 36, CANVAS_H - 62, {
    size: 12,
    bold: true,
    color: WHITE,
    tracking: 1.6,
  });
  text(doc, 'OPORTUNIDADES REALES.', PHOTO_X + 36, CANVAS_H - 44, {
    size: 12,
    bold: true,
    color: WHITE,
    tracking: 1.6,
  });

  // Columna de datos.
  block(doc, M, 100, 22, 4, PINK);
  text(doc, 'AUDIENCIA MEDIDA EN PUNTO DE VENTA', M, 122, {
    size: 10,
    bold: true,
    color: MUTED,
    tracking: 2.2,
  });
  text(doc, report.campaignName.toUpperCase(), M, 158, {
    size: 34,
    bold: true,
    color: NAVY,
  });
  text(
    doc,
    `Circuito Liverpool · ${header.totalStores} tiendas · ${header.supports.join(' · ') || 'Pantallas In-Store'}`,
    M,
    182,
    { size: 12, color: MUTED },
  );
  block(doc, M, 198, LEFT_W - M - 40, 1, HAIR);

  const hero = formatCount(summary.estimatedOts);
  text(doc, hero, M, 292, { size: 78, bold: true, color: NAVY });
  const heroW = textWidth(doc, hero, 78, true);
  if (daily.length >= 2) {
    sparkline(
      doc,
      daily.map((point) => point.estimatedOts),
      M + heroW + 18,
      248,
      110,
      32,
      SKY,
      BLUE,
    );
  }
  block(doc, M, 306, 20, 3, PINK);
  text(doc, 'OPORTUNIDADES DE VER · OTS', M + 30, 314, {
    size: 10.5,
    bold: true,
    color: NAVY,
    tracking: 1.4,
  });

  const statsY = 366;
  const stats: Array<[IconFn, string, string]> = [
    [eyeIcon, formatCount(summary.dailyAverage), 'OTS PROMEDIO DIARIOS'],
    [clockIcon, formatDwell(dwellSeconds), 'DWELL TIME PROMEDIO'],
    [
      calendarIcon,
      `${formatCivilDate(report.startDate)} — ${formatCivilDate(report.endDate)}`,
      `VIGENCIA · ${header.days} DÍAS`,
    ],
  ];
  const statColW = (LEFT_W - M - 40) / 3;
  stats.forEach(([icon, value, label], index) => {
    const x = M + index * statColW;
    const accent = index === 1 ? PINK : BLUE;
    if (index > 0) block(doc, x - 14, statsY - 4, 1, 62, HAIR);
    icon(doc, x, statsY, 16, accent);
    let valueSize = 22;
    const maxW = statColW - 30;
    while (valueSize > 12 && textWidth(doc, value, valueSize, true) > maxW) {
      valueSize -= 1;
    }
    text(doc, value, x, statsY + 44, {
      size: valueSize,
      bold: true,
      color: accent === PINK ? PINK : NAVY,
    });
    text(doc, label, x, statsY + 58, {
      size: 8.5,
      bold: true,
      color: accent,
      tracking: 1,
    });
  });

  text(doc, 'FORMATOS', M, 464, {
    size: 9,
    bold: true,
    color: MUTED,
    tracking: 1.2,
  });
  text(doc, header.supports.join(' · ') || 'Pantallas In-Store', M + 62, 464, {
    size: 12,
    bold: true,
    color: NAVY,
  });

  block(doc, CANVAS_W - M - 24, CANVAS_H - 34, 24, 18, NAVY);
  text(doc, '01', CANVAS_W - M - 12, CANVAS_H - 22, {
    size: 10,
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
  emphasis?: boolean;
}

/** Barras finas (≤26px), con valor rotulado y sin rejillas: la etiqueta ya lo dice todo. */
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
  const chartH = h - 40;
  const max = niceCeiling(Math.max(1, ...points.map((point) => point.value)));
  const slotW = w / points.length;
  const barW = Math.max(3, Math.min(26, slotW * 0.62));
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
    text(doc, compact(point.value), barX + barW / 2, y + chartH - barH - 6, {
      size: 8.5,
      bold: isPeak,
      color: isPeak ? PINK : NAVY,
      align: 'center',
    });
    if (point.top) {
      text(doc, point.top, barX + barW / 2, y + chartH + 16, {
        size: 8.5,
        bold: isPeak,
        color: isPeak ? PINK : NAVY,
        align: 'center',
      });
    }
    text(
      doc,
      point.bottom,
      barX + barW / 2,
      y + chartH + (point.top ? 28 : 16),
      { size: 7.5, color: isPeak ? PINK : MUTED, align: 'center' },
    );
  });
  block(doc, x, y + chartH, w, 1, NAVY);
}

function topWeekdayLabel(
  daily: ReturnType<typeof brandDaily>,
): { label: string; ots: number } | null {
  if (daily.length === 0) return null;
  const totals = new Map<number, number>();
  for (const point of daily) {
    const parsed = new Date(`${point.date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = parsed.getUTCDay();
    totals.set(day, (totals.get(day) ?? 0) + point.estimatedOts);
  }
  const best = Array.from(totals.entries()).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const label = WEEKDAY_FULL[best[0]];
  return label ? { label, ots: best[1] } : null;
}

/** Día concreto con más OTS ajustados (para el rótulo del pico en el eje). */
function peakDay(
  daily: ReturnType<typeof brandDaily>,
): { date: string; ots: number } | null {
  if (daily.length === 0) return null;
  const best = daily.reduce(
    (top, point) => (point.estimatedOts > top.estimatedOts ? point : top),
    daily[0]!,
  );
  return { date: best.date, ots: best.estimatedOts };
}

/** % de diferencia entre el promedio de fin de semana y el de entre semana. */
function weekendDelta(daily: ReturnType<typeof brandDaily>): number | null {
  let weekendSum = 0;
  let weekendCount = 0;
  let weekdaySum = 0;
  let weekdayCount = 0;
  for (const point of daily) {
    const parsed = new Date(`${point.date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) continue;
    const day = parsed.getUTCDay();
    if (day === 0 || day === 6) {
      weekendSum += point.estimatedOts;
      weekendCount += 1;
    } else {
      weekdaySum += point.estimatedOts;
      weekdayCount += 1;
    }
  }
  if (weekendCount === 0 || weekdayCount === 0) return null;
  const weekendAvg = weekendSum / weekendCount;
  const weekdayAvg = weekdaySum / weekdayCount;
  if (weekdayAvg <= 0) return null;
  return ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;
}

function evolutionPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const header = brandHeader(report);
  const summary = brandCampaignSummary(report);
  const coverage = brandCoverage(report);
  const useWeekly = header.days > 28;
  const daily = brandDaily(report);

  eyebrow(doc, '01 · EVOLUCIÓN', 88, trendIcon);
  text(doc, 'Cómo evolucionó la audiencia', M, 122, {
    size: 24,
    bold: true,
    color: NAVY,
  });

  sectionLabel(
    doc,
    useWeekly ? 'OTS POR SEMANA DE CAMPAÑA' : 'OTS POR DÍA DE CAMPAÑA',
    M,
    166,
  );

  const points: EvolutionPoint[] = useWeekly
    ? brandWeeklyEvolution(report).map((week, index) => ({
        value: week.estimatedOts,
        top: `Sem. ${index + 1}`,
        bottom: `${shortCivilDate(week.weekStart)}–${shortCivilDate(week.weekEnd)}`,
      }))
    : daily.map((point) => ({
        value: point.estimatedOts,
        top: weekdayShort(point.date),
        bottom: point.label,
      }));

  drawEvolutionChart(doc, points, M, 190, CONTENT_W, 250);

  // Conclusiones, no metodología: lo que la marca necesita saber.
  const conclusions: Array<[string, string]> = [
    [formatCount(summary.dailyAverage), 'OTS PROMEDIO / DÍA'],
    [formatCount(summary.dailyPerStore), 'OTS PROMEDIO / DÍA / TIENDA'],
  ];
  const peak = peakDay(daily);
  if (peak) {
    conclusions.push([
      weekdayShort(peak.date)
        ? `${WEEKDAY_FULL[new Date(`${peak.date}T12:00:00Z`).getUTCDay()]}`
        : peak.date,
      `DÍA PICO · ${compact(peak.ots)} OTS`,
    ]);
  }
  const delta = weekendDelta(daily);
  if (delta !== null) {
    conclusions.push([
      `${delta >= 0 ? '+' : ''}${Math.round(delta)}%`,
      'FIN DE SEMANA VS. ENTRE SEMANA',
    ]);
  }

  const rowY = 490;
  const colW = CONTENT_W / conclusions.length;
  conclusions.forEach(([value, label], index) => {
    const x = M + index * colW;
    if (index > 0) block(doc, x - 12, rowY - 4, 1, 46, HAIR);
    const accent = label.startsWith('DÍA PICO') ? PINK : BLUE;
    text(doc, value, x, rowY + 22, { size: 21, bold: true, color: NAVY });
    text(doc, label, x, rowY + 36, {
      size: 8.5,
      bold: true,
      color: accent,
      tracking: 0.8,
    });
  });

  pageFooter(
    doc,
    doc.getNumberOfPages(),
    'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
    `${formatPercent(coverage.measuredPercent, 0)} tiendas con cámara · ${formatPercent(coverage.estimatedPercent, 0)} tiendas proyectadas`,
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

function audiencePage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const header = brandHeader(report);
  const genderByDay = brandGenderByDay(report);
  const genderPoints =
    header.days > 28 ? bucketGenderWeekly(genderByDay) : genderByDay;
  const pyramid = brandGenderAge(report).slice(0, 4);

  eyebrow(doc, '02 · AUDIENCIA', 88, peopleIcon);
  text(doc, 'Quién vio la campaña', M, 122, {
    size: 24,
    bold: true,
    color: NAVY,
  });

  // El género de portada sale de `brandGender` (todo el público, incluido el
  // no identificado), no de la pirámide: ésta sólo cruza los géneros
  // conocidos y ya está renormalizada a 100, así que derivar el «no
  // identificado» de ahí siempre daría cero.
  const genderShares = brandGender(report);
  const shareFor = (label: string) =>
    genderShares.find((item) => item.label === label)?.share ?? 0;
  const femaleTotal = shareFor('Femenino');
  const maleTotal = shareFor('Masculino');
  const unknownTotal = shareFor('Desconocido');
  const headline: Array<[string, string, readonly [number, number, number]]> = [
    [formatPercent(femaleTotal, 0), 'MUJERES', PINK],
    [formatPercent(maleTotal, 0), 'HOMBRES', BLUE],
    [formatPercent(unknownTotal, 0), 'NO IDENTIF.', GRAY_DARK],
  ];
  let headX = CANVAS_W - M;
  [...headline].reverse().forEach(([value, label, color]) => {
    text(doc, label, headX, 108, {
      size: 8.5,
      bold: true,
      color: MUTED,
      align: 'right',
      tracking: 0.8,
    });
    text(doc, value, headX, 96, {
      size: 22,
      bold: true,
      color,
      align: 'right',
    });
    headX -= Math.max(textWidth(doc, value, 22, true), 60) + 28;
  });

  // Hero: la pirámide, centrada y con aire.
  const axis = CANVAS_W / 2;
  const labelHalf = 110;
  const maxBar = 200;
  const peak = Math.max(
    ...pyramid.map((row) => Math.max(row.female, row.male)),
    1,
  );
  text(doc, 'MUJERES', axis - labelHalf - 8, 158, {
    size: 9,
    bold: true,
    color: PINK,
    align: 'right',
    tracking: 1.2,
  });
  text(doc, 'HOMBRES', axis + labelHalf + 8, 158, {
    size: 9,
    bold: true,
    color: BLUE,
    tracking: 1.2,
  });

  if (pyramid.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', axis, 220, {
      size: 11,
      color: MUTED,
      align: 'center',
    });
  } else {
    pyramid.forEach((row, index) => {
      const y = 178 + index * 42;
      const femaleW = (row.female / peak) * maxBar;
      const maleW = (row.male / peak) * maxBar;
      if (femaleW > 0)
        block(doc, axis - labelHalf - femaleW, y, femaleW, 24, PINK);
      if (maleW > 0) block(doc, axis + labelHalf, y, maleW, 24, BLUE);
      text(
        doc,
        formatPercent(row.female, 0),
        axis - labelHalf - femaleW - 8,
        y + 17,
        {
          size: 13,
          bold: true,
          color: NAVY,
          align: 'right',
        },
      );
      text(
        doc,
        formatPercent(row.male, 0),
        axis + labelHalf + maleW + 8,
        y + 17,
        {
          size: 13,
          bold: true,
          color: NAVY,
        },
      );
      text(doc, row.age, axis, y + 17, {
        size: 10.5,
        color: MUTED,
        align: 'center',
      });
    });

    const top = pyramid[0]!;
    const topShare = Math.round(top.female + top.male);
    const pillLabel = `${topShare}% de la audiencia está en el rango "${top.age}"`;
    const pillW = textWidth(doc, pillLabel, 12) + 44;
    block(doc, axis - pillW / 2, 340, pillW, 30, PINK_PALE);
    text(doc, pillLabel, axis, 359, { size: 12, color: NAVY, align: 'center' });
  }

  // Secundario y discreto: la tendencia diaria, en línea — nunca apilada.
  sectionLabel(doc, 'COMPOSICIÓN POR GÉNERO — EVOLUCIÓN DÍA A DÍA (%)', M, 420);
  if (genderPoints.length === 0) {
    text(doc, 'Sin datos demográficos en el periodo', M, 460, {
      size: 10.5,
      color: MUTED,
    });
  } else {
    const chartX = M;
    const chartY = 434;
    const chartW = CONTENT_W - 140;
    const chartH = 96;
    const maleSeries = genderPoints.map((p) => p.male);
    const femaleSeries = genderPoints.map((p) => p.female);
    // Dominio compartido: mujeres y hombres deben leerse en la misma escala,
    // o una diferencia de medio punto se dibuja como un zigzag violento.
    const combined = [...maleSeries, ...femaleSeries];
    const domainMin = Math.min(...combined);
    const domainMax = Math.max(...combined);
    const pad = Math.max(1, (domainMax - domainMin) * 0.2);
    const domain: [number, number] = [domainMin - pad, domainMax + pad];
    sparkline(
      doc,
      maleSeries,
      chartX,
      chartY,
      chartW,
      chartH,
      BLUE,
      BLUE,
      domain,
    );
    sparkline(
      doc,
      femaleSeries,
      chartX,
      chartY,
      chartW,
      chartH,
      PINK,
      PINK,
      domain,
    );
    const last = genderPoints[genderPoints.length - 1]!;
    text(
      doc,
      `${formatPercent(last.female, 0)} mujeres`,
      chartX + chartW + 14,
      chartY + 24,
      { size: 10.5, bold: true, color: PINK },
    );
    text(
      doc,
      `${formatPercent(last.male, 0)} hombres`,
      chartX + chartW + 14,
      chartY + 60,
      { size: 10.5, bold: true, color: BLUE },
    );
    const first = genderPoints[0]!;
    text(doc, shortCivilDate(first.date), chartX, chartY + chartH + 16, {
      size: 8,
      color: MUTED,
    });
    text(
      doc,
      shortCivilDate(last.date),
      chartX + chartW,
      chartY + chartH + 16,
      {
        size: 8,
        color: MUTED,
        align: 'right',
      },
    );
  }

  pageFooter(
    doc,
    doc.getNumberOfPages(),
    'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
  );
}

/** Barras finas de distribución horaria, con el pico resaltado. */
function drawHourlyChart(
  doc: jsPDF,
  points: ReturnType<typeof brandHourlyDistribution>,
  x: number,
  y: number,
  w: number,
  h: number,
  peakHour: number | null,
): void {
  const max = niceCeiling(Math.max(1, ...points.map((point) => point.share)));
  const slotW = w / points.length;
  const barW = Math.max(4, Math.min(26, slotW * 0.6));

  points.forEach((point, index) => {
    const barX = x + (index + 0.5) * slotW - barW / 2;
    const barH = (point.share / max) * h;
    const isPeak = point.hour === peakHour;
    block(
      doc,
      barX,
      y + h - barH,
      barW,
      Math.max(1, barH),
      isPeak ? PINK : BLUE,
    );
    text(
      doc,
      `${Math.round(point.share)}%`,
      barX + barW / 2,
      y + h - barH - 6,
      {
        size: 8.5,
        bold: isPeak,
        color: isPeak ? PINK : NAVY,
        align: 'center',
      },
    );
    text(
      doc,
      `${String(point.hour).padStart(2, '0')}h`,
      barX + barW / 2,
      y + h + 16,
      {
        size: 8,
        bold: isPeak,
        color: isPeak ? PINK : MUTED,
        align: 'center',
      },
    );
  });
  block(doc, x, y + h, w, 1, NAVY);
}

function topHourLabel(
  hourly: ReturnType<typeof brandHourlyDistribution>,
): number | null {
  if (hourly.length === 0) return null;
  const best = hourly.reduce(
    (top, point) => (point.share > top.share ? point : top),
    hourly[0]!,
  );
  return best.hour;
}

/** Ventana contigua de horas con mayor concentración de OTS observados. */
function peakWindow(
  hourly: ReturnType<typeof brandHourlyDistribution>,
  windowSize = 5,
): { startHour: number; endHour: number; percent: number } | null {
  if (hourly.length === 0) return null;
  const size = Math.min(windowSize, hourly.length);
  let bestStart = 0;
  let bestSum = -1;
  for (let i = 0; i + size <= hourly.length; i += 1) {
    const sum = hourly
      .slice(i, i + size)
      .reduce((total, point) => total + point.share, 0);
    if (sum > bestSum) {
      bestSum = sum;
      bestStart = i;
    }
  }
  const startHour = hourly[bestStart]!.hour;
  const endHour = hourly[bestStart + size - 1]!.hour + 1;
  return { startHour, endHour, percent: bestSum };
}

function horariosPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  pageHeader(doc, assets, report);
  const hourly = brandHourlyDistribution(report);
  const peak = topHourLabel(hourly);
  const window = peakWindow(hourly);

  eyebrow(doc, '03 · HORARIOS', 88, clockIcon);
  text(doc, 'Cuándo te vio tu público', M, 122, {
    size: 24,
    bold: true,
    color: NAVY,
  });

  if (peak !== null) {
    text(doc, `${String(peak).padStart(2, '0')}:00 h`, CANVAS_W - M, 108, {
      size: 22,
      bold: true,
      color: PINK,
      align: 'right',
    });
    text(doc, 'HORA DE MAYOR TRÁNSITO', CANVAS_W - M, 122, {
      size: 8.5,
      bold: true,
      color: MUTED,
      align: 'right',
      tracking: 0.8,
    });
  }

  if (window) {
    paragraph(
      doc,
      `La franja de ${String(window.startHour).padStart(2, '0')}:00 a ${String(window.endHour).padStart(2, '0')}:00 h concentra ${formatPercent(window.percent, 0)} de los OTS con medición directa de la campaña.`,
      M,
      158,
      680,
      { size: 12.5, color: NAVY, lineHeight: 17 },
    );
  }

  if (hourly.length === 0) {
    paragraph(
      doc,
      'El reporte de esta campaña no incluye detalle horario, por lo que no se publica el reparto por hora.',
      M,
      210,
      CONTENT_W,
      { size: 11.5, lineHeight: 17 },
    );
  } else {
    drawHourlyChart(doc, hourly, M, 220, CONTENT_W, 400, peak);
  }

  pageFooter(
    doc,
    doc.getNumberOfPages(),
    'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
  );
}

const TOP_STORES_ROWS_PER_PAGE = 8;

function topStoresPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  assets: PdfAssets,
): void {
  const attribution = brandStoreAttribution(report);
  const stores = attribution.stores.filter((store) => store.everMeasured);

  if (stores.length === 0) {
    pageHeader(doc, assets, report);
    eyebrow(doc, '04 · TIENDAS TOP', 88);
    text(doc, 'Tiendas TOP', M, 130, { size: 30, bold: true, color: NAVY });
    paragraph(
      doc,
      'Ninguna tienda registró medición directa durante esta vigencia.',
      M,
      168,
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

  const maxDwell = Math.max(...stores.map((store) => store.dwellSeconds), 1);
  const maxOts = stores[0]!.adjustedOts || 1;
  const pageCount = Math.max(
    1,
    Math.ceil(stores.length / TOP_STORES_ROWS_PER_PAGE),
  );

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage();
    pageHeader(doc, assets, report);
    eyebrow(
      doc,
      pageIndex === 0 ? '04 · TIENDAS TOP' : '04 · TIENDAS TOP — CONTINUACIÓN',
      88,
    );
    let bodyTop = 148;
    if (pageIndex === 0) {
      text(doc, 'Tiendas TOP', M, 130, { size: 30, bold: true, color: NAVY });
      text(
        doc,
        'Tiendas con medición válida en algún momento de la campaña.',
        M,
        152,
        { size: 11, color: MUTED },
      );
      bodyTop = 190;
      text(doc, 'DWELL TIME', CANVAS_W - M, bodyTop - 14, {
        size: 8,
        bold: true,
        color: MUTED,
        align: 'right',
        tracking: 0.8,
      });
    }

    const slice = stores.slice(
      pageIndex * TOP_STORES_ROWS_PER_PAGE,
      (pageIndex + 1) * TOP_STORES_ROWS_PER_PAGE,
    );
    const rowH = 56;
    const barAreaX = M + 236;
    const barAreaW = CONTENT_W - 236 - 130;
    slice.forEach((store, index) => {
      const rank = pageIndex * TOP_STORES_ROWS_PER_PAGE + index + 1;
      const rowY = bodyTop + index * rowH;
      const accent = rank === 1 ? PINK : BLUE;
      text(doc, String(rank).padStart(2, '0'), M, rowY + 20, {
        size: 20,
        bold: true,
        color: rank === 1 ? PINK_PALE : HAIR,
      });
      text(doc, store.storeName, M + 46, rowY + 16, {
        size: 13.5,
        bold: true,
        color: NAVY,
      });
      const barW = Math.max(4, (store.adjustedOts / maxOts) * barAreaW);
      block(doc, barAreaX, rowY, barW, 22, accent);
      text(
        doc,
        formatCount(store.adjustedOts),
        barAreaX + barW + 10,
        rowY + 16,
        {
          size: 13,
          bold: true,
          color: NAVY,
        },
      );

      const dwellColX = CANVAS_W - M - 64;
      text(doc, formatDwell(store.dwellSeconds), dwellColX + 64, rowY + 4, {
        size: 11,
        bold: true,
        color: NAVY,
        align: 'right',
      });
      const dwellBarW = Math.max(3, (store.dwellSeconds / maxDwell) * 64);
      block(doc, dwellColX + 64 - 64, rowY + 12, 64, 4, HAIR);
      block(doc, dwellColX + 64 - 64, rowY + 12, dwellBarW, 4, SKY);
      block(doc, dwellColX + 64 - dwellBarW, rowY + 12, dwellBarW, 4, accent);
      if (index < slice.length - 1) {
        block(doc, M, rowY + rowH - 14, CONTENT_W, 1, HAIR);
      }
    });

    pageFooter(
      doc,
      doc.getNumberOfPages(),
      'AUDIENCIAS REALES. OPORTUNIDADES REALES.',
    );
  }
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

  const LEFT_W = 615;

  block(doc, M, 90, 20, 4, PINK);
  text(doc, '05 · CIERRE', M + 30, 97, {
    size: 9.5,
    bold: true,
    color: PINK,
    tracking: 1.4,
  });
  text(doc, 'Cómo aprovechar estos resultados', M, 130, {
    size: 22,
    bold: true,
    color: NAVY,
  });

  const recommendations: Array<[string, string]> = [];
  const weekday = topWeekdayLabel(daily);
  if (weekday) {
    recommendations.push([
      'Refuerza el día de mayor audiencia',
      `Los ${weekday.label.toLowerCase()}s concentran la mayor proporción de OTS ajustados de la campaña. Si el calendario lo permite, prioriza ahí el material con la oferta principal.`,
    ]);
  }
  const peakHour = topHourLabel(hourly);
  if (peakHour !== null) {
    recommendations.push([
      'Aprovecha la franja de mayor tránsito',
      `La hora ${String(peakHour).padStart(2, '0')}:00 concentra la mayor proporción de OTS con medición directa; es una referencia útil para calendarizar activaciones puntuales.`,
    ]);
  }
  const topAge = pyramid[0]?.age;
  if (topAge) {
    recommendations.push([
      'Habla al público que efectivamente llega',
      `${topAge} es el rango de edad con mayor presencia observada. Es una buena referencia para el tono creativo de la próxima campaña.`,
    ]);
  }
  if (recommendations.length === 0) {
    recommendations.push([
      'Resultado agregado del circuito',
      'Esta vigencia no reunió suficiente detalle horario o demográfico para desglosar recomendaciones puntuales.',
    ]);
  }

  recommendations.slice(0, 3).forEach(([title, body], index) => {
    const y = 200 + index * 96;
    text(doc, String(index + 1).padStart(2, '0'), M, y + 22, {
      size: 22,
      bold: true,
      color: PINK,
    });
    block(doc, M + 34, y - 4, 1, 54, HAIR);
    text(doc, title, M + 52, y + 8, { size: 13, bold: true, color: NAVY });
    paragraph(doc, body, M + 52, y + 28, LEFT_W - M - 52, {
      size: 10.5,
      lineHeight: 15,
    });
  });

  // Cortinilla: panel de foto a todo lo alto, simétrico con la portada.
  const PHOTO_X = LEFT_W;
  const PHOTO_W = CANVAS_W - LEFT_W;
  if (assets.closing) {
    photoCover(
      doc,
      assets.closing,
      'JPEG',
      PHOTO_X,
      0,
      PHOTO_W,
      CANVAS_H,
      0.47,
      0.45,
    );
    // Esta foto trae un pilar gráfico de alto contraste cerca del texto de
    // cierre: se ensombrece más terreno que en portada para que la frase se
    // lea encima sin perder por completo el soporte, que sigue nítido y
    // reconocible en el último tercio del panel.
    const fromLeft: AlphaStop[] = [
      [0, 1],
      [0.22, 0.95],
      [0.4, 0.72],
      [0.58, 0.26],
      [0.7, 0],
    ];
    fade(doc, PHOTO_X, 0, PHOTO_W, CANVAS_H, NAVY, fromLeft, 'left');
  } else {
    block(doc, PHOTO_X, 0, PHOTO_W, CANVAS_H, NAVY);
  }
  block(doc, PHOTO_X + 36, 70, 30, 3, PINK);
  paragraph(
    doc,
    'Medimos lo que pasa frente a la pantalla, no lo que suponemos.',
    PHOTO_X + 36,
    112,
    300,
    { size: 20, bold: true, color: WHITE, lineHeight: 26 },
  );
  text(doc, 'AUDIENCIAS REALES.', PHOTO_X + 36, CANVAS_H - 60, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });
  text(doc, 'OPORTUNIDADES REALES.', PHOTO_X + 36, CANVAS_H - 44, {
    size: 10,
    bold: true,
    color: BLUE_LIGHT,
    tracking: 1.8,
  });

  const pageNumber = doc.getNumberOfPages();
  text(doc, 'in-Store Media', M, CANVAS_H - 20, {
    size: 9,
    bold: true,
    color: NAVY,
  });
  text(doc, 'Reporte de audiencia de campaña', M + 76, CANVAS_H - 20, {
    size: 8,
    color: MUTED,
    tracking: 1,
  });
  block(doc, CANVAS_W - M - 24, CANVAS_H - 34, 24, 18, NAVY);
  text(
    doc,
    String(pageNumber).padStart(2, '0'),
    CANVAS_W - M - 12,
    CANVAS_H - 22,
    { size: 10, bold: true, color: WHITE, align: 'center' },
  );
}

/** Genera el informe de audiencia de marca y lo devuelve como Blob. */
export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const assets = await loadAssets();
  const doc = new JsPdf({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.setLineWidth(u(0.75));

  coverPage(doc, report, assets);
  doc.addPage();
  evolutionPage(doc, report, assets);
  doc.addPage();
  audiencePage(doc, report, assets);
  doc.addPage();
  horariosPage(doc, report, assets);
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
