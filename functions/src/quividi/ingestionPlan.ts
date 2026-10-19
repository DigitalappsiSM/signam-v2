import {
  historyDateRange,
  historyPartitionId,
  type HistoryRangeTask,
} from './historyModel';

/** The archive keeps its full plan; these five series feed the operational consumers first. */
export const OPERATIONAL_HISTORY_EXPORTS = [
  { type: 'ots', resolution: '1d' },
  { type: 'viewers', resolution: '1d' },
  { type: 'viewers_demographics', resolution: '1d' },
  { type: 'ots', resolution: '1h' },
  { type: 'viewers', resolution: '1h' },
] as const;

export type HistoryTaskSource = 'daily' | 'backfill' | 'recovery' | 'late_data';

export interface HistoryPartitionTask {
  date: string;
  locationId: number;
  type: string;
  resolution: string;
  siteId?: number;
  source?: HistoryTaskSource;
}

/**
 * Una exportación para varias ubicaciones y días contiguos. `chunk` marca una tarea
 * ya dividida, que se ejecuta tal cual; `recheck` vuelve a pedir días provisionales.
 */
export interface HistoryBatchTask {
  locationIds: number[];
  startDate: string;
  endDate: string;
  type: string;
  resolution: string;
  source?: HistoryTaskSource;
  chunk?: boolean;
  recheck?: boolean;
}

/** Las tareas por ubicación encoladas antes del cambio siguen siendo válidas. */
export function toBatchTask(
  task:
    | HistoryBatchTask
    | HistoryPartitionTask
    | (HistoryRangeTask & { source?: HistoryTaskSource }),
): HistoryBatchTask {
  if ('locationIds' in task) return task;
  const startDate = 'date' in task ? task.date : task.startDate;
  const endDate = 'date' in task ? task.date : task.endDate;
  return {
    locationIds: [task.locationId],
    startDate,
    endDate,
    type: task.type,
    resolution: task.resolution,
    ...(task.source ? { source: task.source } : {}),
  };
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Un 403 de una serie operativa se vuelve a probar a las seis horas (los reportes la
 * necesitan); una serie de archivo sin licencia espera siete días para no sondear a diario.
 */
export function unsupportedRetryMs(spec: {
  type: string;
  resolution: string;
}): number {
  return isOperationalHistoryExport(spec) ? SIX_HOURS_MS : SEVEN_DAYS_MS;
}

/** Las series sin agrupar pesan mucho: menos ubicaciones y un solo día por export. */
export function exportBatchLimits(resolution: string): {
  locations: number;
  days: number;
} {
  return resolution === 'finest'
    ? { locations: 20, days: 1 }
    : { locations: 80, days: 7 };
}

const MAX_PARTITIONS_PER_EXPORT = 400;

export interface BatchChunk {
  locationIds: number[];
  startDate: string;
  endDate: string;
}

/**
 * Agrupa los pares ubicación × día pendientes en exports sin repetir días ya guardados:
 * las ubicaciones con exactamente los mismos días pendientes van juntas, y esos días se
 * cortan en tramos contiguos. En la carga diaria casi todas comparten solo D-1.
 */
export function planBatchExports(
  pending: ReadonlyMap<number, ReadonlySet<string>>,
  limits: { locations: number; days: number },
): BatchChunk[] {
  const groups = new Map<string, { dates: string[]; locations: number[] }>();
  for (const [locationId, set] of pending) {
    if (!set.size) continue;
    const dates = [...set].sort();
    const key = dates.join(',');
    const group = groups.get(key) ?? { dates, locations: [] };
    group.locations.push(locationId);
    groups.set(key, group);
  }
  const chunks: BatchChunk[] = [];
  for (const { dates, locations } of [...groups.values()].sort((a, b) =>
    a.dates[0]!.localeCompare(b.dates[0]!),
  )) {
    locations.sort((a, b) => a - b);
    const segments: string[][] = [];
    for (const date of dates) {
      const current = segments.at(-1);
      const previous = current?.at(-1);
      const contiguous =
        previous !== undefined &&
        Date.parse(`${date}T00:00:00Z`) -
          Date.parse(`${previous}T00:00:00Z`) ===
          86_400_000;
      if (current && contiguous && current.length < limits.days)
        current.push(date);
      else segments.push([date]);
    }
    for (const segment of segments) {
      // Cada par ubicación × día se reserva en una transacción: se acota su tamaño.
      const perChunk = Math.max(
        1,
        Math.min(
          limits.locations,
          Math.floor(MAX_PARTITIONS_PER_EXPORT / segment.length),
        ),
      );
      for (let offset = 0; offset < locations.length; offset += perChunk)
        chunks.push({
          locationIds: locations.slice(offset, offset + perChunk),
          startDate: segment[0]!,
          endDate: segment.at(-1)!,
        });
    }
  }
  return chunks;
}

function lastSeenMs(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  // Sin desfase explícito se lee igual para todas las ubicaciones: solo importan diferencias.
  const text = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Fin del día civil en México (UTC-6, sin horario de verano desde 2022). */
function mexicoEndOfDayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) + 30 * 60 * 60 * 1000;
}

/**
 * ¿La cámara ya había hablado con Quividi después de terminar `date`? Si no, lo que
 * Quividi devolvió puede estar incompleto y el día queda provisional.
 *
 * `last_seen` no declara zona horaria, así que se compara contra la ubicación más
 * reciente de la network (misma convención, el desfase se cancela). Si ni la más
 * reciente parece actual en UTC ni en hora de México, la network entera está sin
 * señal y todo queda provisional. Ante la duda, provisional: cuesta una relectura,
 * nunca un dato.
 */
export function lastSeenCoversDay(
  lastSeen: string | null | undefined,
  freshest: string | null | undefined,
  date: string,
  now: number,
): boolean {
  const seen = lastSeenMs(lastSeen);
  const latest = lastSeenMs(freshest);
  if (seen === null || latest === null) return false;
  const threeHours = 3 * 60 * 60 * 1000;
  const networkCurrent =
    Math.abs(now - latest) <= threeHours ||
    Math.abs(now - (latest + 6 * 60 * 60 * 1000)) <= threeHours;
  if (!networkCurrent) return false;
  const elapsedSinceDayEnd = now - mexicoEndOfDayMs(date);
  return seen >= latest - elapsedSinceDayEnd + 60 * 60 * 1000;
}

export function freshestLastSeen(
  values: Iterable<string | null | undefined>,
): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const value of values) {
    const ms = lastSeenMs(value);
    if (ms !== null && ms > bestMs) {
      best = value!;
      bestMs = ms;
    }
  }
  return best;
}

/** Tras volver la cámara se relee dos veces (puede tardar en subir lo atrasado). */
export const PROVISIONAL_CONFIRMATIONS = 2;
export const PROVISIONAL_MAX_RECHECKS = 5;
export const PROVISIONAL_MAX_AGE_DAYS = 60;
export const PROVISIONAL_RECHECK_GAP_MS = 12 * 60 * 60 * 1000;

export interface ProvisionalState {
  provisional: boolean;
  provisionalChecks: number;
  provisionalRechecks: number;
}

export function nextProvisionalState(
  previous: Partial<ProvisionalState> | undefined,
  covered: boolean,
  recheck: boolean,
): ProvisionalState {
  const wasProvisional = previous?.provisional === true;
  const rechecks = (previous?.provisionalRechecks ?? 0) + (recheck ? 1 : 0);
  let checks = previous?.provisionalChecks ?? 0;
  if (covered && !wasProvisional && !recheck)
    return { provisional: false, provisionalChecks: 0, provisionalRechecks: 0 };
  if (covered) checks++;
  return {
    provisional:
      checks < PROVISIONAL_CONFIRMATIONS && rechecks < PROVISIONAL_MAX_RECHECKS,
    provisionalChecks: checks,
    provisionalRechecks: rechecks,
  };
}

export interface ProvisionalPartition {
  id: string;
  locationId: number;
  date: string;
  type: string;
  resolution: string;
  provisionalLastSeen?: string | null;
  provisionalCheckedAt?: number;
}

/**
 * Solo se relee un día provisional cuando su cámara volvió a reportar desde la última
 * lectura: una tienda que sigue sin internet no genera ningún export.
 */
export function planLateDataRechecks(
  partitions: readonly ProvisionalPartition[],
  lastSeenByLocation: ReadonlyMap<number, string | null>,
  now: number,
): { tasks: HistoryBatchTask[]; expiredIds: string[] } {
  const oldest = new Date(now - PROVISIONAL_MAX_AGE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const expiredIds: string[] = [];
  const groups = new Map<string, HistoryBatchTask>();
  for (const partition of partitions) {
    if (partition.date < oldest) {
      expiredIds.push(partition.id);
      continue;
    }
    const current = lastSeenMs(lastSeenByLocation.get(partition.locationId));
    const before = lastSeenMs(partition.provisionalLastSeen);
    if (current === null || (before !== null && current <= before)) continue;
    if (
      now - (partition.provisionalCheckedAt ?? 0) <
      PROVISIONAL_RECHECK_GAP_MS
    )
      continue;
    const key = `${partition.type}__${partition.resolution}`;
    const group = groups.get(key) ?? {
      locationIds: [],
      startDate: partition.date,
      endDate: partition.date,
      type: partition.type,
      resolution: partition.resolution,
      source: 'late_data',
      recheck: true,
    };
    if (!group.locationIds.includes(partition.locationId))
      group.locationIds.push(partition.locationId);
    if (partition.date < group.startDate) group.startDate = partition.date;
    if (partition.date > group.endDate) group.endDate = partition.date;
    groups.set(key, group);
  }
  const tasks = [...groups.values()].map((task) => ({
    ...task,
    locationIds: task.locationIds.sort((a, b) => a - b),
  }));
  return { tasks, expiredIds };
}

/** Las particiones faltantes de un reporte se piden juntas, una tarea por serie. */
export function groupRecoveryTasks(ids: readonly string[]): HistoryBatchTask[] {
  const groups = new Map<string, HistoryBatchTask>();
  for (const id of ids) {
    const task = historyRecoveryTask(id);
    const key = `${task.type}__${task.resolution}`;
    const group = groups.get(key) ?? {
      locationIds: [],
      startDate: task.date,
      endDate: task.date,
      type: task.type,
      resolution: task.resolution,
      source: 'recovery',
    };
    if (!group.locationIds.includes(task.locationId))
      group.locationIds.push(task.locationId);
    if (task.date < group.startDate) group.startDate = task.date;
    if (task.date > group.endDate) group.endDate = task.date;
    groups.set(key, group);
  }
  return [...groups.values()].map((task) => ({
    ...task,
    locationIds: task.locationIds.sort((a, b) => a - b),
  }));
}

export function isOperationalHistoryExport(spec: {
  type: string;
  resolution: string;
}): boolean {
  return OPERATIONAL_HISTORY_EXPORTS.some(
    (item) => item.type === spec.type && item.resolution === spec.resolution,
  );
}

/** A completed day is never included, including when retrying a partly saved range. */
export function missingHistoryRanges(
  task: HistoryRangeTask,
  completedDates: ReadonlySet<string>,
  maxDays = 7,
): HistoryRangeTask[] {
  if (!Number.isInteger(maxDays) || maxDays < 1)
    throw new RangeError('Límite de días inválido.');
  const result: HistoryRangeTask[] = [];
  let current: HistoryRangeTask | undefined;
  let count = 0;
  for (const date of historyDateRange(task.startDate, task.endDate)) {
    if (completedDates.has(date)) {
      current = undefined;
      count = 0;
      continue;
    }
    if (!current || count === maxDays) {
      current = { ...task, startDate: date, endDate: date };
      result.push(current);
      count = 1;
    } else {
      current.endDate = date;
      count++;
    }
  }
  return result;
}

export function historyRecoveryTask(id: string): HistoryPartitionTask {
  const [network, rawLocation, date, type, resolution, extra] = id.split('__');
  const locationId = Number(rawLocation);
  if (
    network !== '3089' ||
    !date ||
    !type ||
    !resolution ||
    extra !== undefined ||
    historyPartitionId(locationId, date, type, resolution) !== id ||
    !isOperationalHistoryExport({ type, resolution })
  ) {
    throw new RangeError('Partición de recuperación inválida.');
  }
  return { date, locationId, type, resolution, source: 'recovery' };
}
