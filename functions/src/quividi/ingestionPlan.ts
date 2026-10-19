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

export interface HistoryPartitionTask {
  date: string;
  locationId: number;
  type: string;
  resolution: string;
  siteId?: number;
  source?: 'daily' | 'backfill' | 'recovery';
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
