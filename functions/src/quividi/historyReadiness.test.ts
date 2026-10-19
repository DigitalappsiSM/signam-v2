import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  enqueue: vi.fn(),
  queue: vi.fn(),
}));
vi.mock('./historyReader', () => ({ loadPersistedHistory: mocks.load }));
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({ taskQueue: mocks.queue }),
}));
import { requirePersistedHistory } from './historyReadiness';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queue.mockReturnValue({ enqueue: mocks.enqueue });
  mocks.enqueue.mockResolvedValue(undefined);
});
describe('consumer source readiness', () => {
  it('serves complete history without creating any export work', async () => {
    const saved = {
      complete: true,
      rowsBySpec: new Map(),
      missingPartitionIds: [],
    };
    mocks.load.mockResolvedValue(saved);
    expect(
      await requirePersistedHistory(
        [11],
        ['2026-10-18'],
        [{ type: 'ots', resolution: '1h' }],
      ),
    ).toBe(saved);
    expect(mocks.queue).not.toHaveBeenCalled();
  });
  it('queues only the single missing location/date/series, rather than the entire period', async () => {
    mocks.load.mockResolvedValue({
      complete: false,
      rowsBySpec: new Map(),
      missingPartitionIds: [
        '3089__22__2026-10-17__ots__1h',
        '3089__22__2026-10-17__ots__1h',
      ],
    });
    await expect(
      requirePersistedHistory(
        [11, 22],
        ['2026-10-17', '2026-10-18'],
        [{ type: 'ots', resolution: '1h' }],
      ),
    ).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.queue).toHaveBeenCalledWith(
      'quividi-historyOperationalPartition',
    );
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.calls[0]![0]).toEqual({
      locationIds: [22],
      startDate: '2026-10-17',
      endDate: '2026-10-17',
      type: 'ots',
      resolution: '1h',
      source: 'recovery',
    });
  });
  it('deduplicates queued recovery and propagates real queue failures', async () => {
    mocks.load.mockResolvedValue({
      complete: false,
      rowsBySpec: new Map(),
      missingPartitionIds: ['3089__11__2026-10-18__ots__1d'],
    });
    mocks.enqueue.mockRejectedValue({ code: 'functions/task-already-exists' });
    await expect(
      requirePersistedHistory([11], ['2026-10-18'], []),
    ).rejects.toMatchObject({ code: 'unavailable' });
    mocks.enqueue.mockRejectedValue(new Error('queue unavailable'));
    await expect(
      requirePersistedHistory([11], ['2026-10-18'], []),
    ).rejects.toThrow('queue unavailable');
  });
});
