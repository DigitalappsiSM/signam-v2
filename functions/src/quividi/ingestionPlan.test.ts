import { describe, expect, it } from 'vitest';
import {
  exportBatchLimits,
  groupRecoveryTasks,
  historyRecoveryTask,
  lastSeenCoversDay,
  missingHistoryRanges,
  nextProvisionalState,
  OPERATIONAL_HISTORY_EXPORTS,
  planBatchExports,
  planLateDataRechecks,
  toBatchTask,
  unsupportedRetryMs,
} from './ingestionPlan';
import {
  CONSUMER_HISTORY_EXPORTS,
  HISTORY_EXPORTS,
  isActiveHistoryExport,
} from './historyModel';

const range = {
  locationId: 11,
  type: 'ots',
  resolution: '1h',
  startDate: '2026-10-01',
  endDate: '2026-10-10',
};
describe('incremental ingestion plan', () => {
  it('recovers only missing days, splitting around completed partitions', () => {
    expect(
      missingHistoryRanges(
        range,
        new Set(['2026-10-02', '2026-10-03', '2026-10-09']),
      ).map(({ startDate, endDate }) => [startDate, endDate]),
    ).toEqual([
      ['2026-10-01', '2026-10-01'],
      ['2026-10-04', '2026-10-08'],
      ['2026-10-10', '2026-10-10'],
    ]);
  });
  it('bounds large archive exports and does not re-export a complete range', () => {
    expect(
      missingHistoryRanges(range, new Set()).map(({ startDate, endDate }) => [
        startDate,
        endDate,
      ]),
    ).toEqual([
      ['2026-10-01', '2026-10-07'],
      ['2026-10-08', '2026-10-10'],
    ]);
    expect(
      missingHistoryRanges(
        { ...range, endDate: range.startDate },
        new Set([range.startDate]),
      ),
    ).toEqual([]);
  });
  it('prioritizes consumers and keeps only the series the business retains', () => {
    const all = [...HISTORY_EXPORTS, ...CONSUMER_HISTORY_EXPORTS];
    expect(all).toHaveLength(14);
    for (const retired of [
      { type: 'viewers', resolution: 'finest' },
      { type: 'ots', resolution: '5m' },
      { type: 'vehicles', resolution: '1h' },
      { type: 'im', resolution: '1h' },
      { type: 'proof_of_play_by_site', resolution: '1h' },
      { type: 'proof_of_play_vehicle_person_by_location', resolution: '1h' },
    ])
      expect(isActiveHistoryExport(retired)).toBe(false);
    expect(OPERATIONAL_HISTORY_EXPORTS).toHaveLength(5);
    for (const spec of OPERATIONAL_HISTORY_EXPORTS)
      expect(all).toContainEqual(spec);
  });
  it('rejects recovery outside the authorized network and operational series', () => {
    expect(historyRecoveryTask('3089__11__2026-10-18__ots__1h')).toEqual({
      date: '2026-10-18',
      locationId: 11,
      type: 'ots',
      resolution: '1h',
      source: 'recovery',
    });
    for (const id of [
      '123__11__2026-10-18__ots__1h',
      '3089__11__2026-10-18__vehicles__1h',
    ]) {
      expect(() => historyRecoveryTask(id)).toThrow();
    }
  });
});

const at = (iso: string) => Date.parse(iso);
describe('batched exports', () => {
  it('asks once for the whole network when every location only lacks D-1', () => {
    const pending = new Map(
      Array.from({ length: 76 }, (_, index) => [
        index + 1,
        new Set(['2026-10-18']),
      ]),
    );
    const chunks = planBatchExports(pending, exportBatchLimits('1h'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.locationIds).toHaveLength(76);
    expect(planBatchExports(pending, exportBatchLimits('finest'))).toHaveLength(
      4,
    );
  });
  it('never downloads again a day that other locations already have', () => {
    const pending = new Map<number, Set<string>>([
      [1, new Set(['2026-10-18'])],
      [2, new Set(['2026-10-18'])],
      [3, new Set(['2026-10-16', '2026-10-17', '2026-10-18'])],
    ]);
    expect(planBatchExports(pending, { locations: 80, days: 7 })).toEqual([
      { locationIds: [3], startDate: '2026-10-16', endDate: '2026-10-18' },
      { locationIds: [1, 2], startDate: '2026-10-18', endDate: '2026-10-18' },
    ]);
  });
  it('keeps each export within the partitions one transaction can reserve', () => {
    const week = new Set(
      Array.from({ length: 7 }, (_, index) => `2026-10-1${index}`),
    );
    const pending = new Map(
      Array.from({ length: 76 }, (_, index) => [index + 1, week]),
    );
    const chunks = planBatchExports(pending, exportBatchLimits('1d'));
    expect(chunks.map((chunk) => chunk.locationIds.length)).toEqual([57, 19]);
  });
  it('cuts a long outage into bounded contiguous segments', () => {
    const days = Array.from(
      { length: 15 },
      (_, index) => `2026-10-${String(index + 1).padStart(2, '0')}`,
    );
    expect(
      planBatchExports(new Map([[9, new Set(days)]]), {
        locations: 80,
        days: 7,
      }),
    ).toEqual([
      { locationIds: [9], startDate: '2026-10-01', endDate: '2026-10-07' },
      { locationIds: [9], startDate: '2026-10-08', endDate: '2026-10-14' },
      { locationIds: [9], startDate: '2026-10-15', endDate: '2026-10-15' },
    ]);
  });
  it('groups a report recovery into one task per series', () => {
    expect(
      groupRecoveryTasks([
        '3089__22__2026-10-17__ots__1h',
        '3089__11__2026-09-21__ots__1h',
        '3089__11__2026-10-17__ots__1d',
      ]),
    ).toEqual([
      {
        locationIds: [11, 22],
        startDate: '2026-09-21',
        endDate: '2026-10-17',
        type: 'ots',
        resolution: '1h',
        source: 'recovery',
      },
      {
        locationIds: [11],
        startDate: '2026-10-17',
        endDate: '2026-10-17',
        type: 'ots',
        resolution: '1d',
        source: 'recovery',
      },
    ]);
  });
  it('keeps tasks queued before the change valid', () => {
    expect(
      toBatchTask({
        date: '2026-10-18',
        locationId: 11,
        type: 'ots',
        resolution: '1h',
        source: 'daily',
      }),
    ).toEqual({
      locationIds: [11],
      startDate: '2026-10-18',
      endDate: '2026-10-18',
      type: 'ots',
      resolution: '1h',
      source: 'daily',
    });
  });
  it('waits a week before probing an unlicensed archive series again', () => {
    expect(unsupportedRetryMs({ type: 'ots', resolution: '1h' })).toBe(
      6 * 3600_000,
    );
    expect(unsupportedRetryMs({ type: 'compass', resolution: '1h' })).toBe(
      7 * 86_400_000,
    );
  });
});

describe('late camera uploads', () => {
  // Captura diaria a las 06:00 de México (12:00 UTC) del 19/10 sobre el 18/10.
  const now = at('2026-10-19T12:00:00Z');
  it('marks as final a day whose camera kept reporting after midnight', () => {
    expect(
      lastSeenCoversDay(
        '2026-10-19T11:58:00',
        '2026-10-19T11:59:00',
        '2026-10-18',
        now,
      ),
    ).toBe(true);
  });
  it('keeps the day provisional when the camera went silent before it ended', () => {
    expect(
      lastSeenCoversDay(
        '2026-10-19T03:30:00',
        '2026-10-19T11:59:00',
        '2026-10-18',
        now,
      ),
    ).toBe(false);
    expect(
      lastSeenCoversDay(
        '2026-10-03T15:00:00',
        '2026-10-19T11:59:00',
        '2026-10-18',
        now,
      ),
    ).toBe(false);
    expect(
      lastSeenCoversDay(null, '2026-10-19T11:59:00', '2026-10-18', now),
    ).toBe(false);
  });
  it('gives the same answer whether last_seen is UTC or Mexico local time', () => {
    // Las mismas lecturas en hora de México (6 h antes): el desfase se cancela.
    expect(
      lastSeenCoversDay(
        '2026-10-19T05:58:00',
        '2026-10-19T05:59:00',
        '2026-10-18',
        now,
      ),
    ).toBe(true);
    expect(
      lastSeenCoversDay(
        '2026-10-18T21:30:00',
        '2026-10-19T05:59:00',
        '2026-10-18',
        now,
      ),
    ).toBe(false);
  });
  it('treats a network that is silent as a whole as provisional', () => {
    expect(
      lastSeenCoversDay(
        '2026-10-18T20:00:00',
        '2026-10-18T20:00:00',
        '2026-10-18',
        now,
      ),
    ).toBe(false);
  });
  it('confirms a recovered day twice before considering it final', () => {
    const offline = nextProvisionalState(undefined, false, false);
    expect(offline.provisional).toBe(true);
    const first = nextProvisionalState(offline, true, true);
    expect(first).toMatchObject({ provisional: true, provisionalChecks: 1 });
    expect(nextProvisionalState(first, true, true).provisional).toBe(false);
    expect(nextProvisionalState(undefined, true, false).provisional).toBe(
      false,
    );
  });
  it('stops re-reading after the maximum number of attempts', () => {
    let state = nextProvisionalState(undefined, false, false);
    for (let attempt = 0; attempt < 5; attempt++)
      state = nextProvisionalState(state, false, true);
    expect(state.provisional).toBe(false);
  });
  it('re-reads only the days of cameras that came back, grouped per series', () => {
    const partition = (locationId: number, date: string, type = 'ots') => ({
      id: `3089__${locationId}__${date}__${type}__1h`,
      locationId,
      date,
      type,
      resolution: '1h',
      provisionalLastSeen: '2026-10-01T15:00:00',
      provisionalCheckedAt: at('2026-10-16T12:00:00Z'),
    });
    const { tasks, expiredIds } = planLateDataRechecks(
      [
        partition(9, '2026-10-01'),
        partition(9, '2026-10-15'),
        partition(9, '2026-10-15', 'footfall'),
        partition(10, '2026-10-15'),
        partition(9, '2026-07-01'),
      ],
      new Map([
        [9, '2026-10-19T11:00:00'],
        [10, '2026-10-01T15:00:00'],
      ]),
      now,
    );
    expect(expiredIds).toEqual(['3089__9__2026-07-01__ots__1h']);
    expect(tasks).toEqual([
      expect.objectContaining({
        locationIds: [9],
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        type: 'ots',
        recheck: true,
        source: 'late_data',
      }),
      expect.objectContaining({ locationIds: [9], type: 'footfall' }),
    ]);
  });
});
