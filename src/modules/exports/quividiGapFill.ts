import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiDemographicRow,
  QuividiGapFillAmount,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';
import {
  BRAND_OPERATIONAL_END_HOUR,
  BRAND_OPERATIONAL_START_HOUR,
  brandGridDates,
} from './quividiBrandReport';

/**
 * Relleno de huecos con el promedio **propio** de cada pantalla.
 *
 * Regla de negocio (octubre 2026, casos LEGO y Mupis igual que Banners): cada
 * tienda tiene su propio tráfico, así que lo que una cámara no midió se
 * completa con el promedio de ESA misma tienda + formato + cámara, nunca con
 * el del formato en todo el circuito. Se evalúa **hora a hora** dentro de la
 * franja operativa 10:00–22:00 (12 horas, la misma que suma el PDF):
 *
 * - **Promedio propio**: total diario de sus días **completos** (las 12 horas
 *   medidas) del mismo tipo — entre semana (lunes a viernes) o fin de semana
 *   (sábado y domingo); si no tiene ninguno de ese tipo, de todos sus días
 *   completos. Si no tiene ningún día completo, de sus días medidos (un día
 *   con huecos deflactaría el promedio, por eso sólo es el último recurso).
 * - **Hora sin dato**: cada hora de la franja que la cámara no reportó vale
 *   ese promedio ÷ 12 (reparto parejo, decisión de negocio: simple y
 *   auditable). Un día sin ninguna hora es el caso extremo: 12 horas × ÷ 12 =
 *   el promedio completo.
 * - **2+ cámaras**: se rellena cada cámara con su propio promedio y después se
 *   combina como el backend — zona partida (Mupi de Insurgentes, BANNER
 *   DIGITAL) suma; el resto toma la más alta y aplica `publishedFactor` (× 2
 *   con 2 cámaras). Lo estimado sólo cuenta cuando gana a lo medido.
 * - **Cara sin cámara** en zona partida (cámara configurada que no reportó en
 *   toda la vigencia): copia día a día el valor de su cara hermana.
 *
 * Lo estimado se publica igual que lo medido (el PDF no lo distingue); cada
 * relleno queda en `fills` para la hoja «Auditoría de cifras». Una pantalla
 * que no midió nada no tiene promedio propio y sigue en la extrapolación por
 * formato de `brandCampaignSummary`. El día incompleto nunca se rellena.
 * Sin `supportHours` (reporte antiguo o export horario fallido) degrada al
 * relleno por día completo sobre `supportDays`/`cameraDays`.
 */

/** Horas de la franja operativa (10:00–22:00). */
export const BRAND_OPERATIONAL_HOURS =
  BRAND_OPERATIONAL_END_HOUR - BRAND_OPERATIONAL_START_HOUR;

export type BrandGapFillReason =
  'missing-day' | 'missing-hours' | 'missing-face';
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
  /** Días que promedió (0 en la copia de cara hermana). */
  basisDays: number;
  /** Base del promedio: días completos (12 h) o, a falta de ellos, medidos. */
  basisKind: 'complete-days' | 'measured-days';
  /** Horas de la franja estimadas ese día (0 en el relleno por día completo). */
  missingHours: number;
  /**
   * OTS publicados estimados en cada hora de la franja (vacío en el relleno
   * por día completo): la gráfica de horarios los suma a su hora exacta.
   */
  hourlyOts: Array<{ hour: number; publishedOts: number }>;
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

function rowMetrics(
  row: Pick<QuividiSupportDay, 'ots' | 'effectiveOts' | 'watchers'> &
    Pick<
      QuividiSupportDay,
      'publishedOts' | 'publishedEffectiveOts' | 'publishedWatchers'
    >,
): Metrics {
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
function cameraMetrics(
  camera: Pick<QuividiCameraDay, 'ots' | 'effectiveOts' | 'watchers'>,
): Metrics {
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
        basisKind: 'measured-days',
        missingHours: 0,
        hourlyOts: [],
        sourceLocationName: '',
        ...average.value,
      });
    }
    finalValue.set(locationId, values);
  }

  if (pair.zoneSplit) {
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
          basisKind: 'measured-days',
          missingHours: 0,
          hourlyOts: [],
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
      basisKind: 'measured-days',
      missingHours: 0,
      hourlyOts: [],
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

function scale(value: Metrics, factor: number): Metrics {
  const result = { ...value };
  for (const key of METRIC_KEYS) result[key] = value[key] * factor;
  return result;
}

/** Lecturas por fecha → hora de una unidad (cámara, o el par de 1 cámara). */
type HourValues = Map<string, Map<number, Metrics>>;

interface UnitAverage {
  basis: Map<string, Metrics>;
  kind: BrandGapFillEntry['basisKind'];
}

/**
 * Base del promedio propio: totales de la franja de sus días completos (12
 * horas medidas); si no tiene ninguno, de sus días con alguna hora medida.
 */
function unitAverage(values: HourValues): UnitAverage | null {
  const complete = new Map<string, Metrics>();
  const measured = new Map<string, Metrics>();
  for (const [date, hours] of values) {
    if (hours.size === 0) continue;
    const total = Array.from(hours.values()).reduce(add, ZERO);
    measured.set(date, total);
    if (hours.size >= BRAND_OPERATIONAL_HOURS) complete.set(date, total);
  }
  if (complete.size > 0) return { basis: complete, kind: 'complete-days' };
  if (measured.size > 0) return { basis: measured, kind: 'measured-days' };
  return null;
}

function operationalHours(): number[] {
  return Array.from(
    { length: BRAND_OPERATIONAL_HOURS },
    (_, index) => BRAND_OPERATIONAL_START_HOUR + index,
  );
}

function setHour(
  values: HourValues,
  date: string,
  hour: number,
  metrics: Metrics,
): void {
  const hours = values.get(date) ?? new Map<number, Metrics>();
  hours.set(hour, metrics);
  values.set(date, hours);
}

interface HourPair {
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  zoneSplit: boolean;
  /** Factor publicado/medido (v10); en reportes previos se deduce. */
  factor: number | null;
  /** Trae lectura por cámara (2+ cámaras). */
  multiCamera: boolean;
  rows: QuividiSupportHour[];
}

function hourPairs(
  report: QuividiCampaignReport,
  dates: ReadonlySet<string>,
): Map<string, HourPair> {
  const pairs = new Map<string, HourPair>();
  for (const row of report.supportHours) {
    if (!dates.has(row.date)) continue;
    if (
      row.hour < BRAND_OPERATIONAL_START_HOUR ||
      row.hour >= BRAND_OPERATIONAL_END_HOUR
    ) {
      continue;
    }
    const key = pairKey(row);
    const pair = pairs.get(key) ?? {
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      configuredCameras: 0,
      zoneSplit: false,
      factor: null,
      multiCamera: false,
      rows: [],
    };
    pair.configuredCameras = Math.max(
      pair.configuredCameras,
      row.configuredCameras,
    );
    // v9 sólo mandaba lectura por cámara en zona partida.
    pair.zoneSplit =
      pair.zoneSplit || (row.zoneSplit ?? row.cameraReadings !== undefined);
    if (pair.factor === null) {
      if (row.publishedFactor !== undefined) pair.factor = row.publishedFactor;
      else if (numeric(row.ots) > 0)
        pair.factor = numeric(row.publishedOts) / numeric(row.ots);
    }
    pair.multiCamera =
      pair.multiCamera ||
      (row.cameraReadings !== undefined && row.configuredCameras >= 2);
    pair.rows.push(row);
    pairs.set(key, pair);
  }
  return pairs;
}

function pairFactor(pair: HourPair): number {
  if (pair.factor !== null) return pair.factor;
  return pair.zoneSplit || pair.configuredCameras >= 3 ? 1 : 2;
}

/** Par de 1 cámara (o sin lectura por cámara): la fila horaria es la unidad. */
function singleUnitHourFills(
  pair: HourPair,
  dates: readonly string[],
): BrandGapFillEntry[] {
  const values: HourValues = new Map();
  for (const row of pair.rows) {
    if (row.status === 'missing') continue;
    setHour(values, row.date, row.hour, rowMetrics(row));
  }
  const average = unitAverage(values);
  if (!average) return [];
  const fills: BrandGapFillEntry[] = [];
  for (const date of dates) {
    const measuredHours = values.get(date)?.size ?? 0;
    const missingHours = BRAND_OPERATIONAL_HOURS - measuredHours;
    if (missingHours <= 0) continue;
    const own = ownAverage(date, average.basis);
    if (!own) continue;
    const measured = values.get(date);
    const perHour = own.value.publishedOts / BRAND_OPERATIONAL_HOURS;
    fills.push({
      date,
      storeNumber: pair.storeNumber,
      storeName: pair.storeName,
      support: pair.support,
      locationId: null,
      locationName: '',
      reason: measuredHours === 0 ? 'missing-day' : 'missing-hours',
      method: own.method,
      basisDays: own.basisDays,
      basisKind: average.kind,
      missingHours,
      hourlyOts: operationalHours()
        .filter((hour) => !measured?.has(hour))
        .map((hour) => ({ hour, publishedOts: perHour })),
      sourceLocationName: '',
      ...scale(own.value, missingHours / BRAND_OPERATIONAL_HOURS),
    });
  }
  return fills;
}

interface CameraUnit {
  locationId: number;
  name: string;
  values: HourValues;
  average: UnitAverage | null;
}

/**
 * Par de 2+ cámaras: cada cámara se completa hora a hora con su propio
 * promedio ÷ 12 y se combina como el backend (zona partida suma; el resto, la
 * más alta × `publishedFactor`). En la regla de la más alta, lo estimado sólo
 * entra por lo que supera a lo medido esa hora, y se atribuye a la cámara
 * estimada que ganó.
 */
function multiCameraHourFills(
  pair: HourPair,
  cameraDays: readonly QuividiCameraDay[],
  dates: readonly string[],
): BrandGapFillEntry[] {
  const names = new Map<number, string>();
  for (const camera of cameraDays) {
    if (!names.has(camera.locationId)) {
      names.set(camera.locationId, camera.locationName);
    }
  }
  const measuredAt = new Map<string, Map<number, Metrics>>();
  const units = new Map<number, CameraUnit>();
  const unitOf = (locationId: number): CameraUnit => {
    const unit = units.get(locationId) ?? {
      locationId,
      name: names.get(locationId) ?? `Cámara ${locationId}`,
      values: new Map(),
      average: null,
    };
    units.set(locationId, unit);
    return unit;
  };
  for (const locationId of names.keys()) unitOf(locationId);
  for (const row of pair.rows) {
    for (const reading of row.cameraReadings ?? []) {
      const metrics = cameraMetrics(reading);
      setHour(unitOf(reading.locationId).values, row.date, row.hour, metrics);
      const slot = `${row.date}|${row.hour}`;
      const list = measuredAt.get(slot) ?? new Map<number, Metrics>();
      list.set(reading.locationId, metrics);
      measuredAt.set(slot, list);
    }
  }
  for (const unit of units.values()) unit.average = unitAverage(unit.values);

  const factor = pairFactor(pair);
  const rawKeys = ['ots', 'effectiveOts', 'watchers'] as const;
  const base = {
    storeNumber: pair.storeNumber,
    storeName: pair.storeName,
    support: pair.support,
  };
  const fills: BrandGapFillEntry[] = [];
  // Total de la franja (medido + estimado) de cada cámara, por fecha: base de
  // la copia a la cara sin cámara.
  const finalTotals = new Map<number, Map<string, Metrics>>();
  // OTS crudos de cada hora de la cara hermana (medido o estimado), promedio
  // de las caras con promedio propio: base horaria de la copia.
  const sisterHourly = new Map<string, Map<number, number>>();

  for (const date of dates) {
    const hourly = new Map<number, Metrics>();
    const hourlyOts = new Map<number, Map<number, number>>();
    const addHourOts = (locationId: number, hour: number, ots: number) => {
      const hours = hourlyOts.get(locationId) ?? new Map<number, number>();
      hours.set(hour, (hours.get(hour) ?? 0) + ots);
      hourlyOts.set(locationId, hours);
    };
    const sisterHours = new Map<number, number>();
    const missing = new Map<number, number>();
    const perHour = new Map<number, Metrics>();
    for (const unit of units.values()) {
      const own = unit.average ? ownAverage(date, unit.average.basis) : null;
      if (!own) continue;
      perHour.set(
        unit.locationId,
        scale(own.value, 1 / BRAND_OPERATIONAL_HOURS),
      );
    }
    for (const hour of operationalHours()) {
      const measured =
        measuredAt.get(`${date}|${hour}`) ?? new Map<number, Metrics>();
      const estimated = new Map<number, Metrics>();
      for (const [locationId, value] of perHour) {
        if (measured.has(locationId)) continue;
        estimated.set(locationId, value);
        missing.set(locationId, (missing.get(locationId) ?? 0) + 1);
      }
      if (pair.zoneSplit && perHour.size > 0) {
        const sisters = Array.from(perHour.keys()).map(
          (locationId) =>
            measured.get(locationId)?.ots ?? perHour.get(locationId)!.ots,
        );
        sisterHours.set(
          hour,
          sisters.reduce((total, value) => total + value, 0) / sisters.length,
        );
      }
      if (estimated.size === 0) continue;
      if (pair.zoneSplit) {
        for (const [locationId, value] of estimated) {
          hourly.set(locationId, add(hourly.get(locationId) ?? ZERO, value));
          addHourOts(locationId, hour, value.ots);
        }
        continue;
      }
      for (const key of rawKeys) {
        const measuredMax = Math.max(
          0,
          ...Array.from(measured.values(), (value) => value[key]),
        );
        let winner: number | null = null;
        let best = measuredMax;
        for (const [locationId, value] of estimated) {
          if (value[key] > best) {
            best = value[key];
            winner = locationId;
          }
        }
        if (winner === null) continue;
        const current = { ...(hourly.get(winner) ?? ZERO) };
        current[key] += best - measuredMax;
        hourly.set(winner, current);
        if (key === 'ots') addHourOts(winner, hour, best - measuredMax);
      }
    }
    sisterHourly.set(date, sisterHours);

    for (const unit of units.values()) {
      const measuredTotal = Array.from(
        unit.values.get(date)?.values() ?? [],
      ).reduce(add, ZERO);
      const added = hourly.get(unit.locationId);
      if (unit.values.has(date) || added) {
        const totals = finalTotals.get(unit.locationId) ?? new Map();
        totals.set(date, add(measuredTotal, added ?? ZERO));
        finalTotals.set(unit.locationId, totals);
      }
      if (!added || !unit.average) continue;
      if (added.ots <= 0 && added.effectiveOts <= 0 && added.watchers <= 0)
        continue;
      const own = ownAverage(date, unit.average.basis)!;
      const missingHours = missing.get(unit.locationId) ?? 0;
      fills.push({
        ...base,
        date,
        locationId: unit.locationId,
        locationName: unit.name,
        reason:
          missingHours >= BRAND_OPERATIONAL_HOURS
            ? 'missing-day'
            : 'missing-hours',
        method: own.method,
        basisDays: own.basisDays,
        basisKind: unit.average.kind,
        missingHours,
        hourlyOts: Array.from(
          hourlyOts.get(unit.locationId) ?? new Map<number, number>(),
          ([hour, ots]) => ({ hour, publishedOts: ots * factor }),
        ).sort((a, b) => a.hour - b.hour),
        sourceLocationName: '',
        ...published(added, factor),
      });
    }
  }

  if (pair.zoneSplit) {
    const sisters = Array.from(units.values()).filter(
      (unit) => unit.average !== null,
    );
    const sourceName = sisters.map((unit) => unit.name).join(' + ');
    for (const unit of units.values()) {
      if (unit.average !== null || sisters.length === 0) continue;
      for (const date of dates) {
        const values = sisters
          .map((sister) => finalTotals.get(sister.locationId)?.get(date))
          .filter((value): value is Metrics => value !== undefined);
        if (values.length === 0) continue;
        fills.push({
          ...base,
          date,
          locationId: unit.locationId,
          locationName: unit.name,
          reason: 'missing-face',
          method: 'sister-face-copy',
          basisDays: 0,
          basisKind: 'measured-days',
          missingHours: BRAND_OPERATIONAL_HOURS,
          hourlyOts: Array.from(
            sisterHourly.get(date) ?? new Map<number, number>(),
            ([hour, ots]) => ({ hour, publishedOts: ots * factor }),
          ).sort((a, b) => a.hour - b.hour),
          sourceLocationName: sourceName,
          ...published(mean(values), factor),
        });
      }
    }
  }
  return fills;
}

/** Aplica el factor publicado a las métricas crudas. */
function published(value: Metrics, factor: number): Metrics {
  return {
    ots: value.ots,
    effectiveOts: value.effectiveOts,
    watchers: value.watchers,
    publishedOts: value.ots * factor,
    publishedEffectiveOts: value.effectiveOts * factor,
    publishedWatchers: value.watchers * factor,
  };
}

/** Rellenos hora a hora dentro de la franja, a partir de `supportHours`. */
function hourLevelFills(
  report: QuividiCampaignReport,
  grid: readonly string[],
  camerasByPair: ReadonlyMap<string, QuividiCameraDay[]>,
): BrandGapFillEntry[] {
  const partial = report.partialDate ?? null;
  const dates = grid.filter((date) => date !== partial);
  const pairs = hourPairs(report, new Set(dates));
  const fills: BrandGapFillEntry[] = [];
  for (const [key, pair] of pairs) {
    fills.push(
      ...(pair.multiCamera
        ? multiCameraHourFills(pair, camerasByPair.get(key) ?? [], dates)
        : singleUnitHourFills(pair, dates)),
    );
  }
  return fills;
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
  if (report.supportHours.length > 0) {
    fills.push(...hourLevelFills(report, grid, camerasByPair));
  } else {
    // Sin detalle horario: relleno por día completo.
    for (const [key, pair] of pairs) {
      const cameraLevel =
        pair.zoneSplit && pair.configuredCameras >= 2
          ? cameraLevelFills(pair, camerasByPair.get(key) ?? [], grid)
          : null;
      fills.push(...(cameraLevel ?? pairLevelFills(pair, grid)));
    }
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
      estimatedHours: fills.flatMap((entry) =>
        entry.hourlyOts.map((item) => ({
          date: entry.date,
          storeNumber: entry.storeNumber,
          support: entry.support,
          hour: item.hour,
          publishedOts: item.publishedOts,
        })),
      ),
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

function basisText(entry: BrandGapFillEntry): string {
  const n = entry.basisDays;
  const kind =
    entry.basisKind === 'complete-days'
      ? n === 1
        ? 'día completo'
        : 'días completos'
      : n === 1
        ? 'día medido'
        : 'días medidos';
  return `${n} ${kind}`;
}

function averageLabel(entry: BrandGapFillEntry): string {
  const days =
    entry.basisKind === 'complete-days' ? 'días completos' : 'días medidos';
  switch (entry.method) {
    case 'weekday-average':
      return `promedio propio entre semana (${basisText(entry)})`;
    case 'weekend-average':
      return `promedio propio de fin de semana (${basisText(entry)})`;
    case 'overall-average':
      return `promedio propio de todos sus ${days} (${entry.basisDays}); no midió ningún día de ese tipo`;
    case 'sister-face-copy':
      return `copia del valor de ese día de ${entry.sourceLocationName}`;
  }
}

/** Texto corto del método, para la auditoría. */
export function gapFillMethodLabel(entry: BrandGapFillEntry): string {
  const label = averageLabel(entry);
  if (entry.method === 'sister-face-copy') return `Cara sin cámara: ${label}`;
  if (entry.reason === 'missing-hours') {
    return `${entry.missingHours} de ${BRAND_OPERATIONAL_HOURS} h sin dato: cada hora vale 1/${BRAND_OPERATIONAL_HOURS} del ${label}`;
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}
