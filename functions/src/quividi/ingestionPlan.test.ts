import { describe, expect, it } from 'vitest';
import {
  historyRecoveryTask,
  missingHistoryRanges,
  OPERATIONAL_HISTORY_EXPORTS,
} from './ingestionPlan';
import { CONSUMER_HISTORY_EXPORTS, HISTORY_EXPORTS } from './historyModel';

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
  it('prioritizes consumers while preserving every archive configuration', () => {
    const all = [...HISTORY_EXPORTS, ...CONSUMER_HISTORY_EXPORTS];
    expect(all).toHaveLength(36);
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
