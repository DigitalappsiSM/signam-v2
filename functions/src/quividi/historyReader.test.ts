import { describe, expect, it } from 'vitest';
import { expectedHistoryPartitionIds } from './historyReader';

describe('Quividi persisted history reader', () => {
  it('requires every location, day and series partition', () => {
    const ids = expectedHistoryPartitionIds(
      [22, 11, 22],
      ['2026-10-03', '2026-10-04'],
      [
        { type: 'ots', resolution: '1d' },
        { type: 'viewers', resolution: '1d' },
        { type: 'viewers_demographics', resolution: '1d' },
        { type: 'ots', resolution: '1h' },
        { type: 'viewers', resolution: '1h' },
      ],
    );

    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids).toContain('3089__11__2026-10-03__ots__1d');
    expect(ids).toContain('3089__22__2026-10-04__viewers__1d');
    expect(ids).toContain(
      '3089__22__2026-10-04__viewers_demographics__1d',
    );
    expect(ids).toContain('3089__22__2026-10-04__ots__1h');
    expect(ids).toContain('3089__22__2026-10-04__viewers__1h');
  });
});
