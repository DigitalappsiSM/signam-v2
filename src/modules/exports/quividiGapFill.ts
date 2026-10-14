import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiDemographicRow,
  QuividiGapFillAmount,
  QuividiSupportDay,
} from '@/domain';
import { brandGridDates } from './quividiBrandReport';

/**
 * Relleno de huecos con el promedio **propio** de cada pantalla.
 *
 * Regla de negocio (octubre 2026, caso LEGO): cada tienda tiene su propio
 * tráfico, así que un día sin dato se completa con el promedio de ESA misma
 * tienda + formato + pantalla, nunca con el del formato en todo el circuito:
 *
 * - **Día sin dato** de una pantalla que sí midió otros días: promedio de sus
 *   días medidos del mismo tipo — entre semana (lunes a viernes) o fin de
 *   semana (sábado y domingo). Si no midió ningún día de ese tipo, promedio de
 *   todos sus días medidos.
 * - **Zona partida con 2+ cámaras** (Insurgentes, BANNER DIGITAL): la cifra es
 *   la suma de caras distintas, así que el hueco se evalúa **cámara a
 *   cámara** — si una cara no reportó y la otra sí, se completa sólo la cara
 *   caída con su propio promedio.
 * - **Cara sin cámara** de BANNER DIGITAL (cámara configurada que no reportó
 *   en toda la vigencia): copia día a día el valor de su cara hermana. Sólo en
 *   BANNER DIGITAL; en el resto queda fuera.
 *
 * Lo estimado se publica igual que lo medido (el PDF no lo distingue); cada
 * relleno queda en `fills` para la hoja «Auditoría de cifras». Una pantalla
 * que no midió ningún día no tiene promedio propio y sigue en la extrapolación
 * por formato de `brandCampaignSummary`. El día incompleto nunca se rellena.
 * La duplicación de 1 cámara no cambia: el promedio se toma sobre la cifra ya
 * publicada del par.
 */

export type BrandGapFillReason = 'missing-day' | 'missing-face';
export type BrandGapFillMethod =
  | 'weekday-average'
  | 'weekend-average'
  | 'overall-average'
  | 'sister-face-copy';

export interface BrandGapFillEntry {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  /** Cámara rellenada; `null` cuando se rellena el par-día completo. */
  locationId: number | null;
  locationName: string;
  reason: BrandGapFillReason;
  method: BrandGapFillMethod;
  /** Días medidos que promedió (0 en la copia de cara hermana). */
  basisDays: number;
  /** Cara(s) de la que se copió el valor (sólo `sister-face-copy`). */
  sourceLocationName: string;
  ots: number;
  effectiveOts: number;
  watchers: number;
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
}

export interface BrandGapFillResult {
  report: QuividiCampaignReport;
  fills: BrandGapFillEntry[];
}

interface Metrics {
  ots: number;
  effectiveOts: number;
  watchers: number;
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
}

const ZERO: Metrics = {
  ots: 0,
  effectiveOts: 0,
  watchers: 0,
  publishedOts: 0,
  publishedEffectiveOts: 0,
  publishedWatchers: 0,
};

const METRIC_KEYS = Object.keys(ZERO) as Array<keyof Metrics>;

function numeric(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function add(a: Metrics, b: Metrics): Metrics {
  const result = { ...a };
  for (const key of METRIC_KEYS) result[key] = a[key] + b[key];
  return result;
}

function mean(values: readonly Metrics[]): Metrics {
  const total = values.reduce(add, ZERO);
  const result = { ...total };
  for (const key of METRIC_KEYS) result[key] = total[key] / values.length;
  return result;
}

function rowMetrics(row: QuividiSupportDay): Metrics {
  return {
    ots: numeric(row.ots),
    effectiveOts: numeric(row.effectiveOts),
    watchers: numeric(row.watchers),
    publishedOts: numeric(row.publishedOts),
    publishedEffectiveOts: numeric(row.publishedEffectiveOts),
    publishedWatchers: numeric(row.publishedWatchers),
  };
}

/** En zona partida con 2+ cámaras la cifra publicada es la suma cruda. */
function cameraMetrics(camera: QuividiCameraDay): Metrics {
  const ots = numeric(camera.ots);
  const effectiveOts = numeric(camera.effectiveOts);
  const watchers = numeric(camera.watchers);
  return {
    ots,
    effectiveOts,
    watchers,
    publishedOts: ots,
    publishedEffectiveOts: effectiveOts,
    publishedWatchers: watchers,
  };
}

/** Sábado y domingo. */
export function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function normalizedSupport(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function isBannerDigital(support: string): boolean {
  return normalizedSupport(support) === 'BANNER DIGITAL';
}

/** Promedio propio del mismo tipo de día; si no hay, de todos los medidos. */
function ownAverage(
  date: string,
  measured: ReadonlyMap<string, Metrics>,
): { value: Metrics; method: BrandGapFillMethod; basisDays: number } | null {
  if (measured.size === 0) return null;
  const weekend = isWeekendDate(date);
  const sameType = Array.from(measured)
    .filter(([day]) => isWeekendDate(day) === weekend)
    .map(([, value]) => value);
  if (sameType.length > 0) {
    return {
      value: mean(sameType),
      method: weekend ? 'weekend-average' : 'weekday-average',
      basisDays: sameType.length,
    };
  }
  const all = Array.from(measured.values());
  return { value: mean(all), method: 'overall-average', basisDays: all.length };
}

function pairKey(row: { storeNumber: string; support: string }): string {
  return `${row.storeNumber}|${row.support}`;
}

interface PairContext {
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  zoneSplit: boolean;
  /** Filas del par en la rejilla, por fecha. */
  rows: Map<string, QuividiSupportDay>;
}

function weightedSeconds(
  rows: readonly QuividiSupportDay[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number {
  const watchers = rows.reduce(
    (total, row) => total + numeric(row.publishedWatchers),
    0,
  );
  if (watchers <= 0) return 0;
  return (
    rows.reduce(
      (total, row) =>
        total + numeric(row[field]) * numeric(row.publishedWatchers),
      0,
    ) / watchers
  );
}

/**
 * Cámaras del par medidas cada día, con la misma selección que la
 * combinación del backend: las completas; si ninguna lo está, las parciales.
 */
function measuredCameras(
  cameras: readonly QuividiCameraDay[],
  grid: ReadonlySet<string>,
): Map<number, { name: string; measured: Map<string, Metrics> }> {
  const byDate = new Map<string, QuividiCameraDay[]>();
  const result = new Map<
    number,
    { name: string; measured: Map<string, Metrics> }
  >();
  for (const camera of cameras) {
    if (!grid.has(camera.date)) continue;
    if (!result.has(camera.locationId)) {
      result.set(camera.locationId, {
        name: camera.locationName,
        measured: new Map(),
      });
    }
    const list = byDate.get(camera.date) ?? [];
    list.push(camera);
    byDate.set(camera.date, list);
  }
  for (const [date, list] of byDate) {
    const complete = list.filter((camera) => camera.status === 'complete');
    const selected =
      complete.length > 0
        ? complete
        : list.filter((camera) => camera.status === 'partial');
    for (const camera of selected) {
      result.get(camera.locationId)?.measured.set(date, cameraMetrics(camera));
    }
  }
  return result;
}

function cameraLevelFills(
  pair: PairContext,
  cameras: readonly QuividiCameraDay[],
  grid: readonly string[],
): BrandGapFillEntry[] | null {
  const byCamera = measuredCameras(cameras, new Set(grid));
  if (byCamera.size < 2) return null;
  const reporting = Array.from(byCamera).filter(
    ([, camera]) => camera.measured.size > 0,
  );
  if (reporting.length === 0) return null;

  const base = {
    storeNumber: pair.storeNumber,
    storeName: pair.storeName,
    support: pair.support,
  };
  const fills: BrandGapFillEntry[] = [];
  // Valor final (medido o estimado) de cada cara que reportó alguna vez.
  const finalValue = new Map<number, Map<string, Metrics>>();

  for (const [locationId, camera] of reporting) {
    const values = new Map(camera.measured);
    for (const date of grid) {
      if (camera.measured.has(date)) continue;
      const average = ownAverage(date, camera.measured);
      if (!average) continue;
      values.set(date, average.value);
      fills.push({
        ...base,
        date,
        locationId,
        locationName: camera.name,
        reason: 'missing-day',
        method: average.method,
        basisDays: average.basisDays,
        sourceLocationName: '',
        ...average.value,
      });
    }
    finalValue.set(locationId, values);
  }

  if (isBannerDigital(pair.support)) {
    const sisters = reporting.map(([id, camera]) => ({
      values: finalValue.get(id) ?? new Map<string, Metrics>(),
      name: camera.name,
    }));
    const sourceName = sisters.map((sister) => sister.name).join(' + ');
    for (const [locationId, camera] of byCamera) {
      if (camera.measured.size > 0) continue;
      for (const date of grid) {
        const values = sisters
          .map((sister) => sister.values.get(date))
          .filter((value): value is Metrics => value !== undefined);
        if (values.length === 0) continue;
        fills.push({
          ...base,
          date,
          locationId,
          locationName: camera.name,
          reason: 'missing-face',
          method: 'sister-face-copy',
          basisDays: 0,
          sourceLocationName: sourceName,
          ...mean(values),
        });
      }
    }
  }
  return fills;
}

function pairLevelFills(
  pair: PairContext,
  grid: readonly string[],
): BrandGapFillEntry[] {
  const measured = new Map<string, Metrics>();
  for (const [date, row] of pair.rows) {
    if (row.status !== 'missing') measured.set(date, rowMetrics(row));
  }
  const fills: BrandGapFillEntry[] = [];
  for (const date of grid) {
    if (measured.has(date)) continue;
    const average = ownAverage(date, measured);
    if (!average) continue;
    fills.push({
      date,
      storeNumber: pair.storeNumber,
      storeName: pair.storeName,
      support: pair.support,
      locationId: null,
      locationName: '',
      reason: 'missing-day',
      method: average.method,
      basisDays: average.basisDays,
      sourceLocationName: '',
      ...average.value,
    });
  }
  return fills;
}

function metricsOf(entry: BrandGapFillEntry): Metrics {
  return {
    ots: entry.ots,
    effectiveOts: entry.effectiveOts,
    watchers: entry.watchers,
    publishedOts: entry.publishedOts,
    publishedEffectiveOts: entry.publishedEffectiveOts,
    publishedWatchers: entry.publishedWatchers,
  };
}

/**
 * Demografía de lo estimado: los watchers rellenados se reparten con el perfil
 * género × edad medido del propio par (o del formato si el par no tiene
 * perfil), igual que la extrapolación por formato.
 */
function estimatedDemographics(
  report: QuividiCampaignReport,
  fills: readonly BrandGapFillEntry[],
): QuividiDemographicRow[] {
  const partial = report.partialDate ?? null;
  const byPair = new Map<string, Map<string, number>>();
  const byFormat = new Map<string, Map<string, number>>();
  for (const row of report.demographics) {
    if (row.estimated || row.date === partial) continue;
    const watchers = numeric(row.publishedWatchers ?? row.watchers);
    const key = `${row.gender}|${row.age}`;
    for (const [map, group] of [
      [byPair, pairKey(row)],
      [byFormat, row.support],
    ] as const) {
      const profile = map.get(group) ?? new Map<string, number>();
      profile.set(key, (profile.get(key) ?? 0) + watchers);
      map.set(group, profile);
    }
  }

  const totals = new Map<string, { entry: BrandGapFillEntry; m: Metrics }>();
  for (const entry of fills) {
    const key = `${entry.date}|${pairKey(entry)}`;
    const current = totals.get(key);
    totals.set(key, {
      entry,
      m: current ? add(current.m, metricsOf(entry)) : metricsOf(entry),
    });
  }

  const result: QuividiDemographicRow[] = [];
  for (const { entry, m } of totals.values()) {
    const profile = byPair.get(pairKey(entry)) ?? byFormat.get(entry.support);
    if (!profile) continue;
    const profileTotal = Array.from(profile.values()).reduce(
      (total, value) => total + value,
      0,
    );
    if (profileTotal <= 0) continue;
    for (const [key, count] of profile) {
      const [gender, age] = key.split('|').map(Number);
      const share = count / profileTotal;
      result.push({
        date: entry.date,
        storeNumber: entry.storeNumber,
        storeName: entry.storeName,
        support: entry.support,
        gender: gender ?? 0,
        age: age ?? 0,
        watchers: m.watchers * share,
        publishedWatchers: m.publishedWatchers * share,
        estimated: true,
      });
    }
  }
  return result;
}

/**
 * Aplica el relleno con promedio propio. Devuelve el reporte con
 * `supportDays` y `demographics` completados (cada fila tocada lleva
 * `gapFill`) y la lista de rellenos para la auditoría. `cameraDays` queda tal
 * cual: es la lectura sin modificar.
 */
export function brandGapFill(
  report: QuividiCampaignReport,
): BrandGapFillResult {
  if (report.gapFilled) return { report, fills: [] };
  const grid = brandGridDates(report);
  const gridSet = new Set(grid);

  const pairs = new Map<string, PairContext>();
  for (const row of report.supportDays) {
    const key = pairKey(row);
    const pair = pairs.get(key) ?? {
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      configuredCameras: 0,
      zoneSplit: false,
      rows: new Map<string, QuividiSupportDay>(),
    };
    pair.configuredCameras = Math.max(
      pair.configuredCameras,
      row.configuredCameras,
    );
    pair.zoneSplit = pair.zoneSplit || row.zoneSplit === true;
    if (gridSet.has(row.date)) pair.rows.set(row.date, row);
    pairs.set(key, pair);
  }

  const camerasByPair = new Map<string, QuividiCameraDay[]>();
  for (const camera of report.cameraDays) {
    const key = pairKey(camera);
    const list = camerasByPair.get(key) ?? [];
    list.push(camera);
    camerasByPair.set(key, list);
  }

  const fills: BrandGapFillEntry[] = [];
  for (const [key, pair] of pairs) {
    const cameraLevel =
      pair.zoneSplit && pair.configuredCameras >= 2
        ? cameraLevelFills(pair, camerasByPair.get(key) ?? [], grid)
        : null;
    fills.push(...(cameraLevel ?? pairLevelFills(pair, grid)));
  }
  if (fills.length === 0)
    return { report: { ...report, gapFilled: true }, fills };

  const addedByRow = new Map<string, Metrics>();
  for (const entry of fills) {
    const key = `${entry.date}|${pairKey(entry)}`;
    addedByRow.set(key, add(addedByRow.get(key) ?? ZERO, metricsOf(entry)));
  }

  const touched = new Set<string>();
  const supportDays: QuividiSupportDay[] = report.supportDays.map((row) => {
    const key = `${row.date}|${pairKey(row)}`;
    const added = addedByRow.get(key);
    if (!added || !gridSet.has(row.date)) return row;
    touched.add(key);
    const pair = pairs.get(pairKey(row))!;
    return filledRow(pair, row.date, added, row);
  });
  for (const [key, added] of addedByRow) {
    if (touched.has(key)) continue;
    const [date = '', ...rest] = key.split('|');
    const pair = pairs.get(rest.join('|'));
    if (pair) supportDays.push(filledRow(pair, date, added));
  }

  return {
    report: {
      ...report,
      gapFilled: true,
      supportDays,
      demographics: [
        ...report.demographics,
        ...estimatedDemographics(report, fills),
      ],
    },
    fills: fills.sort(
      (a, b) =>
        a.storeNumber.localeCompare(b.storeNumber, 'es', { numeric: true }) ||
        a.support.localeCompare(b.support, 'es') ||
        a.locationName.localeCompare(b.locationName, 'es') ||
        a.date.localeCompare(b.date),
    ),
  };
}

function filledRow(
  pair: PairContext,
  date: string,
  added: Metrics,
  existing?: QuividiSupportDay,
): QuividiSupportDay {
  const measured = existing && existing.status !== 'missing';
  const gapFill: QuividiGapFillAmount = { full: !measured, ...added };
  if (existing && measured) {
    return {
      ...existing,
      ots: existing.ots + added.ots,
      effectiveOts: existing.effectiveOts + added.effectiveOts,
      watchers: existing.watchers + added.watchers,
      publishedOts: existing.publishedOts + added.publishedOts,
      publishedEffectiveOts:
        existing.publishedEffectiveOts + added.publishedEffectiveOts,
      publishedWatchers: existing.publishedWatchers + added.publishedWatchers,
      gapFill,
    };
  }
  // Par-día enteramente estimado: los tiempos por persona son el promedio
  // ponderado de lo que el propio par midió.
  const measuredRows = Array.from(pair.rows.values()).filter(
    (row) => row.status !== 'missing' && !row.gapFill,
  );
  return {
    date,
    storeNumber: pair.storeNumber,
    storeName: pair.storeName,
    support: pair.support,
    configuredCameras: existing?.configuredCameras ?? pair.configuredCameras,
    measuredCameras: 0,
    status: 'complete',
    ...(pair.zoneSplit ? { zoneSplit: true } : {}),
    ...added,
    attentionSeconds: weightedSeconds(measuredRows, 'attentionSeconds'),
    dwellSeconds: weightedSeconds(measuredRows, 'dwellSeconds'),
    gapFill,
  };
}

/** Atajo: sólo el reporte completado. */
export function brandGapFilledReport(
  report: QuividiCampaignReport,
): QuividiCampaignReport {
  return brandGapFill(report).report;
}

/** Texto corto del método, para la auditoría. */
export function gapFillMethodLabel(entry: BrandGapFillEntry): string {
  switch (entry.method) {
    case 'weekday-average':
      return `Promedio propio entre semana (${entry.basisDays} ${entry.basisDays === 1 ? 'día medido' : 'días medidos'})`;
    case 'weekend-average':
      return `Promedio propio de fin de semana (${entry.basisDays} ${entry.basisDays === 1 ? 'día medido' : 'días medidos'})`;
    case 'overall-average':
      return `Promedio propio de todos sus días medidos (${entry.basisDays}); no midió ningún día de ese tipo`;
    case 'sister-face-copy':
      return `Cara sin cámara: copia del valor de ese día de ${entry.sourceLocationName}`;
  }
}
