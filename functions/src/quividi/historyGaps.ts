import {
  CONSUMER_HISTORY_EXPORTS,
  HISTORY_EXPORTS,
  HISTORY_START_DATE,
  exportDataClass,
  historyPartitionId,
} from './historyModel';

/**
 * Detección de huecos del histórico Quividi (Fase 2). Lógica pura, sin
 * Firebase: dado el estado de las particiones ya guardadas, decide qué
 * Location × día × export hay que volver a pedir a VidiCenter.
 *
 * Por qué hace falta: la ingesta diaria (`historyDaily`, 06:00) pide el día
 * anterior y, si VidiCenter aún no lo procesó, guarda una partición
 * `complete` con 0 filas que nadie vuelve a pedir (todo salta las
 * `complete`). Tampoco se reencolan las que agotaron sus reintentos
 * (`retrying`). Ver docs/QUIVIDI_PHASE_2.md (Huecos del histórico).
 */

export interface HistoryExportSpec {
  type: string;
  resolution: string;
}

/**
 * Exports que se revisan: todo el plan del histórico menos los agregados por
 * sitio, que solo guarda la primera Location de cada sitio
 * (`resolveExportScope`); en las demás su ausencia es lo esperado, no un hueco.
 */
export const GAP_EXPORTS: readonly HistoryExportSpec[] = [
  ...HISTORY_EXPORTS,
  ...CONSUMER_HISTORY_EXPORTS,
].filter((spec) => exportDataClass(spec.type) !== 'site_aggregate');

/**
 * Series de medición en las que una partición `complete` **vacía** casi seguro
 * significa «se pidió antes de que VidiCenter la procesara» y se vuelve a
 * pedir. En el resto (vehículos, aforo, PMP…) vacío es lo normal para las
 * cámaras de Liverpool y repedirlo solo gastaría API de pago.
 */
export const EMPTY_REFETCH_EXPORTS: readonly HistoryExportSpec[] = [
  { type: 'ots', resolution: '1h' },
  { type: 'ots', resolution: '1d' },
  { type: 'ots', resolution: '5m' },
  { type: 'viewers', resolution: '1h' },
  { type: 'viewers', resolution: '1d' },
  { type: 'viewers', resolution: 'finest' },
  { type: 'viewers_demographics', resolution: '1d' },
];

/** Ventana de la revisión diaria: D-2…D-8 (D-1 aún lo está bajando `historyDaily`). */
export const DAILY_SWEEP_FIRST_OFFSET = 2;
export const DAILY_SWEEP_DAYS = 7;

/** Tope de tareas por corrida; si hay más, se vuelve a correr (es idempotente). */
export const MAX_RELOAD_TASKS = 20_000;

export type HistoryGapReason = 'missing' | 'incomplete' | 'empty';

export interface PartitionState {
  status?: unknown;
  rowCount?: unknown;
}

export interface HistoryGap {
  locationId: number;
  date: string;
  type: string;
  resolution: string;
  reason: HistoryGapReason;
}

function isEmptyRefetchExport(spec: HistoryExportSpec): boolean {
  return EMPTY_REFETCH_EXPORTS.some(
    (item) => item.type === spec.type && item.resolution === spec.resolution,
  );
}

/**
 * - Sin documento → `missing`.
 * - `unsupported` (VidiCenter dijo que no existe) → no es hueco.
 * - Cualquier otro estado que no sea `complete` (`retrying`…) → `incomplete`.
 * - `complete` con 0 filas en una serie de medición → `empty`.
 */
export function classifyPartition(
  state: PartitionState | undefined,
  spec: HistoryExportSpec,
): HistoryGapReason | null {
  if (!state) return 'missing';
  if (state.status === 'unsupported') return null;
  if (state.status !== 'complete') return 'incomplete';
  if (state.rowCount === 0 && isEmptyRefetchExport(spec)) return 'empty';
  return null;
}

/** Días de un mes `YYYY-MM` dentro de la ventana histórica y hasta `lastDate`. */
export function monthDates(month: string, lastDate: string): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return [];
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates: string[] = [];
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    if (date >= HISTORY_START_DATE && date <= lastDate) dates.push(date);
  }
  return dates;
}

/** Días de la revisión diaria (D-2…D-8) a partir de «ayer» en CDMX. */
export function dailySweepDates(yesterday: string): string[] {
  const base = Date.parse(`${yesterday}T00:00:00Z`);
  const dates: string[] = [];
  for (
    let offset = DAILY_SWEEP_FIRST_OFFSET - 1;
    offset < DAILY_SWEEP_FIRST_OFFSET - 1 + DAILY_SWEEP_DAYS;
    offset++
  ) {
    const date = new Date(base - offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    if (date >= HISTORY_START_DATE) dates.push(date);
  }
  return dates.sort();
}

/**
 * Cruza la cuadrícula esperada (Location × día × export) contra el estado
 * guardado (`states`, indexado por `historyPartitionId`).
 */
export function findHistoryGaps(
  locationIds: readonly number[],
  dates: readonly string[],
  states: ReadonlyMap<string, PartitionState>,
  exports: readonly HistoryExportSpec[] = GAP_EXPORTS,
): HistoryGap[] {
  const gaps: HistoryGap[] = [];
  for (const date of dates) {
    for (const locationId of locationIds) {
      for (const spec of exports) {
        const id = historyPartitionId(
          locationId,
          date,
          spec.type,
          spec.resolution,
        );
        const reason = classifyPartition(states.get(id), spec);
        if (reason) gaps.push({ locationId, date, ...spec, reason });
      }
    }
  }
  return gaps;
}

export interface HistoryGapSummary {
  checked: number;
  missing: number;
  incomplete: number;
  empty: number;
  /** Días con algún hueco en una serie de medición (lo que ve la auditoría). */
  datesWithMeasurementGaps: string[];
}

export function summarizeHistoryGaps(
  checked: number,
  gaps: readonly HistoryGap[],
): HistoryGapSummary {
  const measurementDates = new Set<string>();
  let missing = 0;
  let incomplete = 0;
  let empty = 0;
  for (const gap of gaps) {
    if (gap.reason === 'missing') missing++;
    else if (gap.reason === 'incomplete') incomplete++;
    else empty++;
    if (isEmptyRefetchExport(gap)) measurementDates.add(gap.date);
  }
  return {
    checked,
    missing,
    incomplete,
    empty,
    datesWithMeasurementGaps: [...measurementDates].sort(),
  };
}

export interface CoverageRowInput {
  locationId: number;
  date: string;
  ots1d?: {
    state?: PartitionState;
    otsCount: number;
    effectiveOtsCount: number;
  };
  viewers1d?: { state?: PartitionState; watcherCount: number };
  ots1h?: PartitionState;
  viewers1h?: PartitionState;
}

function statusText(state: PartitionState | undefined): string {
  if (!state) return 'faltante';
  if (state.status === 'complete')
    return state.rowCount === 0 ? 'vacio' : 'completo';
  return String(state.status ?? 'desconocido');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV de cobertura por Location y día, con las mismas columnas de conteo que
 * el export diario de VidiCenter (`location_id`, `ots_count`,
 * `effective_ots_count`, `watcher_count`) para compararlo línea a línea.
 */
export function coverageCsv(rows: readonly CoverageRowInput[]): string {
  const header = [
    'location_id',
    'date',
    'ots_count',
    'effective_ots_count',
    'watcher_count',
    'ots_1d',
    'viewers_1d',
    'ots_1h',
    'viewers_1h',
  ];
  const lines = rows.map((row) =>
    [
      row.locationId,
      row.date,
      row.ots1d?.otsCount ?? '',
      row.ots1d?.effectiveOtsCount ?? '',
      row.viewers1d?.watcherCount ?? '',
      statusText(row.ots1d?.state),
      statusText(row.viewers1d?.state),
      statusText(row.ots1h),
      statusText(row.viewers1h),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n') + '\n';
}
