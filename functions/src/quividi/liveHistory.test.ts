import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '../../tests/firestore';
const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  fetch: vi.fn(),
  files: new Map<string, unknown>(),
}));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => mocks.db }));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => ({
        download: async () => [
          gzipSync(Buffer.from(JSON.stringify(mocks.files.get(path)))),
        ],
      }),
    }),
  }),
}));
vi.mock('./historyIngestion', () => ({
  saveRaw: async (path: string, payload: unknown) => {
    mocks.files.set(path, payload);
  },
}));
vi.mock('./exportClient', () => ({ fetchQuividiExport: mocks.fetch }));
import { loadLiveHistory } from './liveHistory';
const specs = [
  { type: 'ots', resolution: '1d' },
  { type: 'viewers_demographics', resolution: '1d' },
  { type: 'ots', resolution: '1h' },
  { type: 'viewers', resolution: '1h' },
];
let db: ReturnType<typeof fakeFirestore>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-19T12:00:00-06:00'));
  vi.clearAllMocks();
  mocks.files.clear();
  db = fakeFirestore({
    'quividiHistoryInventory/11': { networkId: 3089 },
    'quividiHistoryInventory/22': { networkId: 3089 },
  });
  mocks.db = db;
  mocks.fetch.mockImplementation(
    async (_params, _source, readCached, persist) => {
      const cached = await readCached();
      if (cached) return cached;
      const payload = {
        state: 'finished',
        data: [
          {
            location_id: 11,
            period_start: '2026-10-19T11:00:00',
            ots_count: 10,
          },
          {
            location_id: 22,
            period_start: '2026-10-19T11:00:00',
            ots_count: 20,
          },
        ],
      };
      await persist(payload);
      return payload;
    },
  );
});
afterEach(() => vi.useRealTimers());
describe('shared current-day cache', () => {
  it('shares four exports across overlapping campaigns and filters each campaign scope', async () => {
    const first = await loadLiveHistory([11], '2026-10-19', specs, Date.now());
    const capturedAt = Date.now();
    vi.setSystemTime(Date.now() + 30 * 60 * 1000);
    const second = await loadLiveHistory([22], '2026-10-19', specs, Date.now());
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    expect(
      mocks.fetch.mock.calls.every(([params]) => params.locations === '11,22'),
    ).toBe(true);
    expect(first.rowsBySpec.get('ots__1d')).toEqual([
      expect.objectContaining({ location_id: 11 }),
    ]);
    expect(second.rowsBySpec.get('ots__1d')).toEqual([
      expect.objectContaining({ location_id: 22 }),
    ]);
    expect(second.asOf).toBe(capturedAt);
    expect(
      [...db.documents.keys()].some((path) =>
        path.startsWith('quividiHistoryPartitions/'),
      ),
    ).toBe(false);
  });
  it('expires the source cache after one hour', async () => {
    await loadLiveHistory([11], '2026-10-19', specs, Date.now());
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await loadLiveHistory([11], '2026-10-19', specs, Date.now());
    expect(mocks.fetch).toHaveBeenCalledTimes(8);
  });
  it('does not reuse the partial-day cache when the operational day closes', async () => {
    vi.setSystemTime(new Date('2026-10-19T21:50:00-06:00'));
    await loadLiveHistory([11], '2026-10-19', specs, Date.now());
    vi.setSystemTime(new Date('2026-10-19T22:01:00-06:00'));
    await loadLiveHistory([11], '2026-10-19', specs, Date.now());
    expect(mocks.fetch).toHaveBeenCalledTimes(8);
  });
  it('rejects locations outside the authorized inventory before exporting', async () => {
    await expect(
      loadLiveHistory([33], '2026-10-19', specs, Date.now()),
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
