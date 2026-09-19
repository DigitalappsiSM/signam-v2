import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  type QuividiCampaignReport,
  type QuividiSupportDay,
  type QuividiSupportHour,
} from '@/domain';

/**
 * Contenido del **informe de audiencia para marca** (PDF).
 *
 * Es la capa pura que decide *qué dice* el informe; `quividiCampaignPdf.ts`
 * solo lo dibuja. Reglas de negocio que gobiernan este archivo (ver AGENTS.md,
 * sección Quividi):
 *
 * - **Ventana de exhibición**: se comunica de 10:00 a 22:00 h; las tiendas con
 *   pantalla en área de restaurante (Polanco) reportan de 08:00 a 22:00 h.
 *   Fuera de esa ventana no se comunica actividad.
 * - **Nunca se nombra al proveedor de medición**: la audiencia se presenta como
 *   medición propia de in-Store Media.
 * - **Sin comparativos entre periodos** ni métricas de costo.
 * - **Sin metodología, incidencias ni cobertura de medición**: eso vive en el
 *   Excel técnico. Aquí no se habla de cámaras, solo de tienda + soporte.
 * - Los términos (OTS, Watchers, Conversion ratio, Attention time, Dwell time)
 *   se conservan y se explican en una línea embebida junto a la cifra.
 */

/** Ventana de exhibición que se comunica por defecto. */
export const DISPLAY_WINDOW = { start: 10, end: 22 } as const;

/**
 * Ventana ampliada para tiendas cuya pantalla con medición está en el área de
 * restaurante, que opera antes que el piso de venta.
 */
export const EXTENDED_DISPLAY_WINDOW = { start: 8, end: 22 } as const;

const EXTENDED_WINDOW_STORES = ['POLANCO'] as const;

export interface DisplayWindow {
  start: number;
  end: number;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Ventana de exhibición que se comunica para una tienda. */
export function displayWindowFor(storeName: string): DisplayWindow {
  const name = normalize(storeName);
  return EXTENDED_WINDOW_STORES.some((store) => name.includes(store))
    ? { ...EXTENDED_DISPLAY_WINDOW }
    : { ...DISPLAY_WINDOW };
}

/** Horas dentro de la ventana de exhibición de cada tienda. */
export function hoursInDisplayWindow(
  report: QuividiCampaignReport,
): QuividiSupportHour[] {
  return report.supportHours.filter((row) => {
    const window = displayWindowFor(row.storeName);
    return row.hour >= window.start && row.hour < window.end;
  });
}

/** Etiqueta legible de la ventana de exhibición general. */
export function displayWindowLabel(): string {
  const hh = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
  return `${hh(DISPLAY_WINDOW.start)} – ${hh(DISPLAY_WINDOW.end)} h`;
}

/**
 * Tiendas del informe con ventana ampliada, para la nota al pie. Se comunica
 * como un plus del emplazamiento, nunca como una excepción técnica.
 */
export function extendedWindowStores(report: QuividiCampaignReport): string[] {
  const names = report.supportDays
    .filter(
      (row) => displayWindowFor(row.storeName).start < DISPLAY_WINDOW.start,
    )
    .map((row) => row.storeName);
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, 'es'));
}

// ── Formato ────────────────────────────────────────────────────────────────

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

/** `2026-08-11` → `11/08/2026`. Fechas civiles, sin zona horaria. */
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

// ── Agregación ─────────────────────────────────────────────────────────────

interface Aggregable {
  ots: number;
  watchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sumOts(rows: readonly { ots: number }[]): number {
  return rows.reduce((total, row) => total + numeric(row.ots), 0);
}

function sumWatchers(rows: readonly { watchers: number }[]): number {
  return rows.reduce((total, row) => total + numeric(row.watchers), 0);
}

/** Promedio ponderado por Watchers: un segundo vale lo que la gente que miró. */
function weightedSeconds(
  rows: readonly Aggregable[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number {
  const watchers = sumWatchers(rows);
  if (watchers <= 0) return 0;
  return (
    rows.reduce(
      (total, row) => total + numeric(row[field]) * numeric(row.watchers),
      0,
    ) / watchers
  );
}

function conversionRatio(ots: number, watchers: number): number {
  return ots > 0 ? (watchers / ots) * 100 : 0;
}

function weekdayOf(date: string): number {
  const parsed = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(parsed) ? 0 : new Date(parsed).getUTCDay();
}

export const WEEKDAY_LABELS = [
  'Dom',
  'Lun',
  'Mar',
  'Mié',
  'Jue',
  'Vie',
  'Sáb',
] as const;

// ── Encabezado ─────────────────────────────────────────────────────────────

export interface BrandHeader {
  campaignName: string;
  periodLabel: string;
  days: number;
  stores: number;
  screens: number;
  supports: string[];
  windowLabel: string;
}

export function brandHeader(report: QuividiCampaignReport): BrandHeader {
  const measured = report.supportDays.filter((row) => row.status !== 'missing');
  return {
    campaignName: report.campaignName,
    periodLabel: `${formatCivilDate(report.startDate)} – ${formatCivilDate(report.endDate)}`,
    days: periodDays(report),
    stores: new Set(measured.map((row) => row.storeNumber)).size,
    screens: screenCount(report),
    supports: Array.from(new Set(measured.map((row) => row.support))).sort(
      (a, b) => a.localeCompare(b, 'es'),
    ),
    windowLabel: displayWindowLabel(),
  };
}

/**
 * Pantallas del informe. Se cuentan las ubicaciones con medición y, si el
 * reporte no trae ese detalle, las configuradas por tienda + soporte.
 */
export function screenCount(report: QuividiCampaignReport): number {
  const located = new Set(report.cameraDays.map((row) => row.locationId)).size;
  if (located > 0) return located;
  const byPair = new Map<string, number>();
  for (const row of report.supportDays) {
    const key = `${row.storeNumber}|${row.support}`;
    byPair.set(
      key,
      Math.max(byPair.get(key) ?? 0, Math.max(row.configuredCameras, 1)),
    );
  }
  return Array.from(byPair.values()).reduce((total, value) => total + value, 0);
}

// ── KPIs de portada ────────────────────────────────────────────────────────

export interface BrandKpi {
  label: string;
  value: string;
  unit: string;
  /** Definición embebida: el informe no lleva glosario. */
  meaning: string;
}

export function brandKpis(report: QuividiCampaignReport): BrandKpi[] {
  const days = report.supportDays;
  const ots = sumOts(days);
  const watchers = sumWatchers(days);
  const pairs = new Set(
    days
      .filter((row) => row.status !== 'missing')
      .map((row) => `${row.storeNumber}|${row.support}`),
  ).size;
  const periodLength = periodDays(report);
  const dailyAverage =
    pairs > 0 && periodLength > 0 ? ots / periodLength / pairs : 0;

  return [
    {
      label: 'OTS',
      value: formatCount(ots),
      unit: 'personas alcanzadas en el periodo',
      meaning: 'Personas con oportunidad de ver el soporte.',
    },
    {
      label: 'Watchers',
      value: formatCount(watchers),
      unit: 'personas',
      meaning: 'De ellas, las que dirigieron la mirada a la pantalla.',
    },
    {
      label: 'Conversion ratio',
      value: formatPercent(conversionRatio(ots, watchers)),
      unit: 'Watchers / OTS',
      meaning: 'Proporción de personas expuestas que miraron la pantalla.',
    },
    {
      label: 'Attention time',
      value: formatSeconds(weightedSeconds(days, 'attentionSeconds')),
      unit: 'promedio por persona',
      meaning: 'Segundos de mirada sostenida sobre la pantalla.',
    },
    {
      label: 'Dwell time',
      value: formatSeconds(weightedSeconds(days, 'dwellSeconds')),
      unit: 'promedio por persona',
      meaning: 'Permanencia promedio frente o cerca del soporte.',
    },
    {
      label: 'OTS diario promedio',
      value: formatCount(dailyAverage),
      unit: 'personas por día',
      meaning:
        'OTS por tienda-soporte al día: comparable entre tiendas de distinto tamaño.',
    },
  ];
}

// ── Evolución diaria ───────────────────────────────────────────────────────

export interface BrandDailyPoint {
  date: string;
  label: string;
  ots: number;
  watchers: number;
  weekend: boolean;
}

export function brandDaily(report: QuividiCampaignReport): BrandDailyPoint[] {
  const groups = new Map<string, QuividiSupportDay[]>();
  for (const row of report.supportDays) {
    const current = groups.get(row.date) ?? [];
    current.push(row);
    groups.set(row.date, current);
  }
  return Array.from(groups, ([date, rows]) => {
    const weekday = weekdayOf(date);
    return {
      date,
      label: date.slice(8, 10),
      ots: sumOts(rows),
      watchers: sumWatchers(rows),
      weekend: weekday === 0 || weekday === 6,
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

// ── Jornada ────────────────────────────────────────────────────────────────

export interface BrandHourPoint {
  hour: number;
  ots: number;
  watchers: number;
  conversion: number;
}

export function brandHours(report: QuividiCampaignReport): BrandHourPoint[] {
  const rows = hoursInDisplayWindow(report);
  const groups = new Map<number, QuividiSupportHour[]>();
  for (const row of rows) {
    const current = groups.get(row.hour) ?? [];
    current.push(row);
    groups.set(row.hour, current);
  }
  return Array.from(groups, ([hour, hourRows]) => {
    const ots = sumOts(hourRows);
    const watchers = sumWatchers(hourRows);
    return { hour, ots, watchers, conversion: conversionRatio(ots, watchers) };
  }).sort((a, b) => a.hour - b.hour);
}

export interface BrandDayPart {
  label: string;
  range: string;
  ots: number;
  share: number;
  conversion: number;
}

const DAY_PARTS = [
  { label: 'Apertura', start: 8, end: 13 },
  { label: 'Mediodía', start: 13, end: 16 },
  { label: 'Tarde', start: 16, end: 19 },
  { label: 'Cierre', start: 19, end: 22 },
] as const;

/**
 * Momentos de la jornada. No son una propuesta de compra —el circuito no se
 * comercializa por franja— sino la referencia para reforzar promotoría.
 */
export function brandDayParts(report: QuividiCampaignReport): BrandDayPart[] {
  const rows = hoursInDisplayWindow(report);
  const total = sumOts(rows);
  return DAY_PARTS.map((part) => {
    const partRows = rows.filter(
      (row) => row.hour >= part.start && row.hour < part.end,
    );
    const ots = sumOts(partRows);
    const watchers = sumWatchers(partRows);
    return {
      label: part.label,
      range:
        part.start < DISPLAY_WINDOW.start
          ? `hasta ${String(part.end).padStart(2, '0')} h`
          : `${String(part.start).padStart(2, '0')}–${String(part.end).padStart(2, '0')} h`,
      ots,
      share: total > 0 ? (ots / total) * 100 : 0,
      conversion: conversionRatio(ots, watchers),
    };
  }).filter((part) => part.ots > 0);
}

export interface BrandWeekday {
  weekday: number;
  label: string;
  ots: number;
  share: number;
  weekend: boolean;
}

export function brandWeekdays(report: QuividiCampaignReport): BrandWeekday[] {
  const rows = hoursInDisplayWindow(report);
  const total = sumOts(rows);
  const groups = new Map<number, number>();
  for (const row of rows) {
    const weekday = weekdayOf(row.date);
    groups.set(weekday, (groups.get(weekday) ?? 0) + numeric(row.ots));
  }
  return [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const ots = groups.get(weekday) ?? 0;
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday] ?? '',
      ots,
      share: total > 0 ? (ots / total) * 100 : 0,
      weekend: weekday === 0 || weekday === 6,
    };
  });
}

export interface BrandPeak {
  date: string;
  label: string;
  store: string;
  support: string;
  ots: number;
  watchers: number;
  conversion: number;
}

/** Picos de audiencia del periodo: referencia para programar equipo en piso. */
export function brandPeaks(
  report: QuividiCampaignReport,
  limit = 3,
): BrandPeak[] {
  const rows = hoursInDisplayWindow(report);
  const groups = new Map<string, QuividiSupportHour[]>();
  for (const row of rows) {
    const key = `${row.date}|${row.hour}|${row.storeNumber}|${row.support}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .map((peakRows) => {
      const first = peakRows[0];
      const ots = sumOts(peakRows);
      const watchers = sumWatchers(peakRows);
      const date = first?.date ?? '';
      const hour = first?.hour ?? 0;
      return {
        date,
        label: `${WEEKDAY_LABELS[weekdayOf(date)] ?? ''} ${formatCivilDate(date).slice(0, 5)} · ${String(hour).padStart(2, '0')}–${String(hour + 1).padStart(2, '0')} h`,
        store: first?.storeName ?? '',
        support: first?.support ?? '',
        ots,
        watchers,
        conversion: conversionRatio(ots, watchers),
      };
    })
    .sort((a, b) => b.ots - a.ots)
    .slice(0, Math.max(0, limit));
}

// ── Audiencia ──────────────────────────────────────────────────────────────

export interface BrandShare {
  label: string;
  watchers: number;
  share: number;
}

function shareBy(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): BrandShare[] {
  const groups = new Map<number, number>();
  for (const row of report.demographics) {
    groups.set(
      row[field],
      (groups.get(row[field]) ?? 0) + numeric(row.watchers),
    );
  }
  const total = Array.from(groups.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  return Array.from(groups, ([key, watchers]) => ({
    label: labels[key] ?? `Código ${key}`,
    watchers,
    share: total > 0 ? (watchers / total) * 100 : 0,
  })).sort((a, b) => b.watchers - a.watchers);
}

export function brandGender(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'gender', QUIVIDI_GENDER_LABELS);
}

export function brandAge(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'age', QUIVIDI_AGE_LABELS);
}

export interface BrandSegment {
  label: string;
  watchers: number;
  share: number;
}

/** Segmentos género × edad, de mayor a menor peso. */
export function brandSegments(
  report: QuividiCampaignReport,
  limit = 6,
): BrandSegment[] {
  const groups = new Map<string, number>();
  for (const row of report.demographics) {
    const gender = QUIVIDI_GENDER_LABELS[row.gender] ?? 'Sin determinar';
    const age = QUIVIDI_AGE_LABELS[row.age] ?? 'Sin determinar';
    const key = `${gender} · ${age}`;
    groups.set(key, (groups.get(key) ?? 0) + numeric(row.watchers));
  }
  const total = Array.from(groups.values()).reduce(
    (sum, value) => sum + value,
    0,
  );
  return Array.from(groups, ([label, watchers]) => ({
    label,
    watchers,
    share: total > 0 ? (watchers / total) * 100 : 0,
  }))
    .sort((a, b) => b.watchers - a.watchers)
    .slice(0, Math.max(0, limit));
}

// ── Tienda + soporte ───────────────────────────────────────────────────────

export interface BrandStoreRow {
  store: string;
  support: string;
  screens: number;
  ots: number;
  share: number;
  watchers: number;
  conversion: number;
  dailyOts: number;
  index: number;
  peakWeekday: string;
  peakHour: string;
}

/**
 * Una fila por **tienda + soporte**: es la unidad comercial y la única que se
 * comunica a la marca. El índice compara cada fila con la mediana del circuito
 * en el mismo periodo (100 = mediana), sin comparar contra otros periodos.
 */
export function brandStoreRows(report: QuividiCampaignReport): BrandStoreRow[] {
  const groups = new Map<string, QuividiSupportDay[]>();
  for (const row of report.supportDays) {
    const key = `${row.storeNumber}|${row.support}`;
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  const hourRows = hoursInDisplayWindow(report);
  const totalOts = sumOts(report.supportDays);
  const days = periodDays(report);

  const rows = Array.from(groups, ([key, dayRows]) => {
    const first = dayRows[0];
    const ots = sumOts(dayRows);
    const watchers = sumWatchers(dayRows);
    const scoped = hourRows.filter(
      (row) => `${row.storeNumber}|${row.support}` === key,
    );

    const byWeekday = new Map<number, number>();
    const byHour = new Map<number, number>();
    for (const row of scoped) {
      const weekday = weekdayOf(row.date);
      byWeekday.set(weekday, (byWeekday.get(weekday) ?? 0) + numeric(row.ots));
      byHour.set(row.hour, (byHour.get(row.hour) ?? 0) + numeric(row.ots));
    }
    const topWeekday = Array.from(byWeekday.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const topHour = Array.from(byHour.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      store: first?.storeName || `Tienda ${first?.storeNumber ?? ''}`.trim(),
      support: first?.support ?? '',
      screens: Math.max(
        1,
        ...dayRows.map((row) => Math.max(row.configuredCameras, 1)),
      ),
      ots,
      share: totalOts > 0 ? (ots / totalOts) * 100 : 0,
      watchers,
      conversion: conversionRatio(ots, watchers),
      dailyOts: days > 0 ? ots / days : 0,
      index: 0,
      peakWeekday: topWeekday ? (WEEKDAY_LABELS[topWeekday[0]] ?? '—') : '—',
      peakHour: topHour
        ? `${String(topHour[0]).padStart(2, '0')}–${String(topHour[0] + 1).padStart(2, '0')} h`
        : '—',
    };
  }).sort((a, b) => b.ots - a.ots);

  const median = medianOf(rows.map((row) => row.dailyOts));
  return rows.map((row) => ({
    ...row,
    index: median > 0 ? Math.round((row.dailyOts / median) * 100) : 0,
  }));
}

export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

// ── Lecturas y siguientes pasos ────────────────────────────────────────────

export interface BrandNote {
  title: string;
  body: string;
}

/**
 * Hallazgos del periodo, redactados en positivo. No comparan contra otros
 * periodos ni señalan carencias: describen lo que la campaña consiguió.
 */
export function brandFindings(report: QuividiCampaignReport): BrandNote[] {
  const header = brandHeader(report);
  const days = report.supportDays;
  const ots = sumOts(days);
  const watchers = sumWatchers(days);
  const ratio = conversionRatio(ots, watchers);
  const notes: BrandNote[] = [];

  notes.push({
    title: 'El alcance se sostuvo en toda la vigencia',
    body: `${formatCount(ots)} OTS y ${formatCount(watchers)} Watchers en ${header.stores} ${header.stores === 1 ? 'tienda' : 'tiendas'} durante ${header.days} días de exhibición.`,
  });

  if (ratio > 0) {
    const oneIn = Math.max(1, Math.round(100 / ratio));
    notes.push({
      title: 'La audiencia respondió al soporte',
      body: `Conversion ratio de ${formatPercent(ratio)}: aproximadamente una de cada ${oneIn} personas expuestas dirigió la mirada a la pantalla.`,
    });
  }

  const segments = brandSegments(report, 2);
  const lead = segments[0];
  if (lead) {
    const second = segments[1];
    const combined = lead.share + (second?.share ?? 0);
    notes.push({
      title: 'El perfil de audiencia está definido',
      body: second
        ? `${lead.label} y ${second.label} concentran el ${formatPercent(combined)} de los Watchers del periodo.`
        : `${lead.label} concentra el ${formatPercent(lead.share)} de los Watchers del periodo.`,
    });
  }

  const parts = brandDayParts(report);
  const topPart = [...parts].sort((a, b) => b.share - a.share)[0];
  if (topPart) {
    notes.push({
      title: 'La jornada tiene un ritmo claro',
      body: `La franja de ${topPart.range} concentra el ${formatPercent(topPart.share)} de los OTS dentro del horario de exhibición.`,
    });
  }

  return notes.slice(0, 3);
}

/**
 * Siguientes pasos. El circuito **no se comercializa por franja ni por día**,
 * así que nunca se recomienda segmentar la pauta: las palancas son promotoría,
 * número de tiendas, duración del flight y creatividad.
 */
export function brandRecommendations(
  report: QuividiCampaignReport,
): BrandNote[] {
  const notes: BrandNote[] = [];
  const parts = brandDayParts(report);
  const sortedParts = [...parts].sort((a, b) => b.share - a.share);
  const bestPart = sortedParts[0];
  const weekdays = brandWeekdays(report);
  const weekendShare = weekdays
    .filter((day) => day.weekend)
    .reduce((total, day) => total + day.share, 0);

  if (bestPart) {
    notes.push({
      title: 'Reforzar promotoría en los momentos de mayor audiencia',
      body: `La franja de ${bestPart.range} concentra el ${formatPercent(bestPart.share)} de los OTS${weekendShare > 0 ? ` y el fin de semana aporta el ${formatPercent(weekendShare)} de la semana` : ''}: es donde el equipo en piso convierte la exposición en venta.`,
    });
  }

  const stores = brandStoreRows(report);
  const top = stores.slice(0, 3);
  if (top.length > 0) {
    const share = top.reduce((total, row) => total + row.share, 0);
    notes.push({
      title: 'Sumar tiendas de perfil comparable',
      body: `${top.map((row) => row.store).join(', ')} aportan el ${formatPercent(share)} de los OTS; ampliar el circuito a tiendas con ese perfil es la palanca más directa de alcance.`,
    });
  }

  const header = brandHeader(report);
  const ots = sumOts(report.supportDays);
  notes.push({
    title: 'Extender la duración del flight',
    body: `${header.days} días entregaron ${formatCount(ots)} OTS: un periodo más largo sostiene la frecuencia sobre la misma audiencia.`,
  });

  const dwell = weightedSeconds(report.supportDays, 'dwellSeconds');
  if (dwell > 0) {
    notes.push({
      title: 'Aprovechar el dwell time con un mensaje claro desde el inicio',
      body: `${formatSeconds(dwell)} frente al soporte dan espacio a una pieza que se entienda completa.`,
    });
  }

  return notes;
}
