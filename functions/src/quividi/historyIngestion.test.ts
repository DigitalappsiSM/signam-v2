import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore, DELETE_FIELD } from '../../tests/firestore';
const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  fetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mocks.db,
  FieldValue: { delete: () => DELETE_FIELD },
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ file: () => ({ save: mocks.save }) }),
  }),
}));
vi.mock('./exportClient', () => ({
  fetchQuividiExport: mocks.fetch,
  EXPORT_LEASE_MS: 600_000,
}));
import { saveRange, savePartition } from './historyIngestion';
import { historyPartitionId } from './historyModel';

const inventory = {
  'quividiHistoryInventory/11': { networkId: 3089, location: { site_id: 4 } },
};
const path = (date: string, type = 'ots') =>
  `quividiHistoryPartitions/${historyPartitionId(11, date, type, '1h')}`;
const range = {
  startDate: '2026-10-15',
  endDate: '2026-10-17',
  locationId: 11,
  type: 'ots',
  resolution: '1h',
};
let db: ReturnType<typeof fakeFirestore>;
beforeEach(() => {
  vi.clearAllMocks();
  db = fakeFirestore(inventory);
  mocks.db = db;
  mocks.fetch.mockImplementation(async (params: { start: string }) => ({
    state: 'finished',
    data: [{ location_id: 11, period_start: params.start, ots_count: 12 }],
  }));
  mocks.save.mockResolvedValue(undefined);
});
describe('shared source ingestion', () => {
  it('does not call Quividi for a completed day, even from a range task', async () => {
    db.documents.set(path('2026-10-15'), { status: 'complete' });
    await saveRange({ ...range, endDate: '2026-10-15' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('requests only gaps and persists the repaired source for future consumers', async () => {
    db.documents.set(path('2026-10-16'), { status: 'complete', rowCount: 9 });
    await saveRange(range);
    expect(
      mocks.fetch.mock.calls.map(([params]) => [params.start, params.end]),
    ).toEqual([
      ['2026-10-15T00:00:00', '2026-10-15T23:59:59'],
      ['2026-10-17T00:00:00', '2026-10-17T23:59:59'],
    ]);
    expect(db.documents.get(path('2026-10-15'))).toMatchObject({
      status: 'complete',
      rowCount: 1,
    });
    expect(db.documents.get(path('2026-10-16'))).toMatchObject({ rowCount: 9 });
    mocks.fetch.mockClear();
    await saveRange(range);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('resumes after a partially persisted range without downloading successful days again', async () => {
    db.documents.set(path('2026-10-16'), { status: 'complete' });
    mocks.fetch
      .mockResolvedValueOnce({
        state: 'finished',
        data: [
          {
            location_id: 11,
            period_start: '2026-10-15T11:00:00',
            ots_count: 12,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('timeout'));
    await expect(saveRange(range)).rejects.toThrow('timeout');
    expect(
      db.documents.get(path('2026-10-15'))?.exportLeaseOwner,
    ).toBeUndefined();
    mocks.fetch.mockClear();
    await saveRange(range);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]![0].start).toBe('2026-10-17T00:00:00');
    expect(db.documents.get(path('2026-10-15'))?.status).toBe('complete');
    expect(db.documents.get(path('2026-10-17'))?.status).toBe('complete');
  });
  it('does not treat a failed export as measured zero or permanent unavailability', async () => {
    mocks.fetch.mockRejectedValue(new Error('export failed'));
    await expect(
      saveRange({ ...range, endDate: range.startDate }),
    ).rejects.toThrow();
    expect(db.documents.get(path(range.startDate))?.status).not.toBe(
      'complete',
    );
    expect(db.documents.get(path(range.startDate))?.status).not.toBe(
      'unsupported',
    );
  });
  it('honors availability cooldown without publishing a zero', async () => {
    mocks.fetch.mockResolvedValue({ state: 'unsupported', httpStatus: 403 });
    await saveRange({ ...range, endDate: range.startDate });
    expect(db.documents.get(path(range.startDate))?.status).toBe('unsupported');
    mocks.fetch.mockClear();
    await saveRange({ ...range, endDate: range.startDate });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not repeatedly probe a denied family for other historical dates', async () => {
    mocks.fetch.mockResolvedValue({ state: 'unsupported', httpStatus: 403 });
    await saveRange({ ...range, endDate: range.startDate });
    await saveRange({ ...range, startDate: '2026-10-17' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(db.documents.get(path('2026-10-17'))?.status).toBe('unsupported');
  });
  it('prevents overlapping recovery and archive exports of the same day', async () => {
    let finish!: (value: unknown) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = saveRange({ ...range, endDate: range.startDate });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    await expect(
      savePartition({
        date: range.startDate,
        locationId: 11,
        type: 'ots',
        resolution: '1h',
        source: 'recovery',
      }),
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    finish({ state: 'finished', data: [] });
    await first;
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not multiply a site export across its member locations', async () => {
    db.documents.set('quividiHistoryInventory/22', {
      networkId: 3089,
      location: { site_id: 4 },
    });
    await saveRange({
      ...range,
      locationId: 22,
      type: 'proof_of_play_by_site',
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
