import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore, DELETE_FIELD } from '../../tests/firestore';
const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  fetch: vi.fn(),
  locations: vi.fn(),
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
  fetchQuividiLocations: mocks.locations,
  EXPORT_LEASE_MS: 600_000,
}));
import { saveBatch } from './historyIngestion';
import type { HistoryBatchTask } from './ingestionPlan';
import { historyPartitionId } from './historyModel';

const inventory = {
  'quividiHistoryInventory/11': { networkId: 3089, location: { site_id: 4 } },
  'quividiHistoryInventory/22': { networkId: 3089, location: { site_id: 5 } },
};
const path = (location: number, date: string, type = 'ots') =>
  `quividiHistoryPartitions/${historyPartitionId(location, date, type, '1h')}`;
const task: HistoryBatchTask = {
  locationIds: [11, 22],
  startDate: '2026-10-18',
  endDate: '2026-10-18',
  type: 'ots',
  resolution: '1h',
  source: 'daily',
};
const rowsFor = (params: { locations: string; start: string; end: string }) =>
  params.locations.split(',').flatMap((location) => {
    const rows = [];
    for (
      let day = Date.parse(params.start.slice(0, 10) + 'T00:00:00Z');
      day <= Date.parse(params.end.slice(0, 10) + 'T00:00:00Z');
      day += 86_400_000
    ) {
      const date = new Date(day).toISOString().slice(0, 10);
      rows.push({
        location_id: Number(location),
        period_start: `${date}T11:00:00`,
        ots_count: 12,
      });
    }
    return rows;
  });
let db: ReturnType<typeof fakeFirestore>;
let queued: HistoryBatchTask[];
const enqueue = async (chunk: HistoryBatchTask) => {
  queued.push(chunk);
};
/** Runs the split tasks the way the queue would. */
const drain = async () => {
  while (queued.length) await saveBatch(queued.shift()!, enqueue);
};
beforeEach(() => {
  vi.clearAllMocks();
  // 06:00 de México del 19/10: la carga diaria de D-1.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  db = fakeFirestore(inventory);
  mocks.db = db;
  queued = [];
  mocks.fetch.mockImplementation(async (params) => ({
    state: 'finished',
    data: rowsFor(params),
  }));
  mocks.locations.mockResolvedValue([
    { id: 11, last_seen: '2026-10-19T11:58:00' },
    { id: 22, last_seen: '2026-10-19T11:59:00' },
  ]);
  mocks.save.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('batched source ingestion', () => {
  it('exports the whole network in a single request and stores each location apart', async () => {
    await saveBatch(task, enqueue);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]![0]).toMatchObject({
      locations: '11,22',
      start: '2026-10-18T00:00:00',
      end: '2026-10-18T23:59:59',
    });
    for (const location of [11, 22])
      expect(db.documents.get(path(location, '2026-10-18'))).toMatchObject({
        status: 'complete',
        rowCount: 1,
        provisional: false,
      });
    mocks.fetch.mockClear();
    await saveBatch(task, enqueue);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('requests only the gaps, without downloading a day another location already has', async () => {
    db.documents.set(path(22, '2026-10-17'), { status: 'complete' });
    await saveBatch({ ...task, startDate: '2026-10-17' }, enqueue);
    expect(mocks.fetch).not.toHaveBeenCalled();
    await drain();
    expect(
      mocks.fetch.mock.calls.map(([params]) => [
        params.locations,
        params.start,
        params.end,
      ]),
    ).toEqual([
      ['11', '2026-10-17T00:00:00', '2026-10-18T23:59:59'],
      ['22', '2026-10-18T00:00:00', '2026-10-18T23:59:59'],
    ]);
    expect(db.documents.get(path(11, '2026-10-17'))?.status).toBe('complete');
  });
  it('isolates the location without license instead of losing the whole batch', async () => {
    mocks.fetch.mockImplementation(async (params) =>
      params.locations.includes('11')
        ? { state: 'unsupported', httpStatus: 403 }
        : { state: 'finished', data: rowsFor(params) },
    );
    await saveBatch(task, enqueue);
    await drain();
    expect(db.documents.get(path(11, '2026-10-18'))?.status).toBe(
      'unsupported',
    );
    expect(db.documents.get(path(22, '2026-10-18'))?.status).toBe('complete');
    mocks.fetch.mockClear();
    await saveBatch(
      { ...task, startDate: '2026-10-17', endDate: '2026-10-17' },
      enqueue,
    );
    expect(mocks.fetch.mock.calls.map(([params]) => params.locations)).toEqual([
      '22',
    ]);
  });
  it('falls back to one export per location when rows do not identify it', async () => {
    mocks.fetch.mockImplementation(async (params) => ({
      state: 'finished',
      data: [
        { period_start: `${params.start.slice(0, 10)}T11:00:00`, ots_count: 3 },
      ],
    }));
    await saveBatch(task, enqueue);
    await drain();
    expect(mocks.fetch.mock.calls.map(([params]) => params.locations)).toEqual([
      '11,22',
      '11',
      '22',
    ]);
    expect(db.documents.get(path(11, '2026-10-18'))?.rowCount).toBe(1);
    mocks.fetch.mockClear();
    await saveBatch(
      { ...task, startDate: '2026-10-17', endDate: '2026-10-17' },
      enqueue,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(queued).toHaveLength(2);
  });
  it('does not export days another worker is already preparing', async () => {
    for (const location of [11, 22])
      db.documents.set(path(location, '2026-10-18'), {
        exportLeaseOwner: 'other',
        exportLeaseUntil: Date.now() + 60_000,
      });
    await saveBatch(task, enqueue);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not treat a failed export as measured zero and releases every lease', async () => {
    mocks.fetch.mockRejectedValue(new Error('export failed'));
    await expect(saveBatch(task, enqueue)).rejects.toThrow('export failed');
    const saved = db.documents.get(path(11, '2026-10-18'));
    expect(saved?.status).toBe('retrying');
    expect(saved?.exportLeaseOwner).toBeUndefined();
  });
});

describe('camera that comes back after an outage', () => {
  it('keeps the silent days provisional and recovers them when the camera uploads', async () => {
    // Perisur (11) sin internet desde el 03/10: Quividi no tiene nada todavía.
    mocks.locations.mockResolvedValue([
      { id: 11, last_seen: '2026-10-03T15:00:00' },
      { id: 22, last_seen: '2026-10-19T11:59:00' },
    ]);
    mocks.fetch.mockImplementation(async (params) => ({
      state: 'finished',
      data: rowsFor(params).filter((row) => row.location_id !== 11),
    }));
    await saveBatch(task, enqueue);
    expect(db.documents.get(path(11, '2026-10-18'))).toMatchObject({
      status: 'complete',
      rowCount: 0,
      provisional: true,
    });
    expect(db.documents.get(path(22, '2026-10-18'))?.provisional).toBe(false);

    // Volvió el internet y subió lo atrasado: la relectura toma solo los días provisionales.
    mocks.locations.mockResolvedValue([
      { id: 11, last_seen: '2026-10-19T11:50:00' },
      { id: 22, last_seen: '2026-10-19T11:59:00' },
    ]);
    mocks.fetch.mockReset();
    mocks.fetch.mockImplementation(async (params) => ({
      state: 'finished',
      data: rowsFor(params),
    }));
    const recheck = { ...task, source: 'late_data' as const, recheck: true };
    await saveBatch(recheck, enqueue);
    expect(mocks.fetch.mock.calls.map(([params]) => params.locations)).toEqual([
      '11',
    ]);
    expect(db.documents.get(path(11, '2026-10-18'))).toMatchObject({
      rowCount: 1,
      provisional: true,
      provisionalChecks: 1,
    });
    expect(db.documents.get('quividiHistoryLateData/2026-10-18')).toMatchObject(
      {
        date: '2026-10-18',
      },
    );
    await saveBatch(recheck, enqueue);
    expect(db.documents.get(path(11, '2026-10-18'))?.provisional).toBe(false);
    mocks.fetch.mockClear();
    await saveBatch(recheck, enqueue);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('without topology everything stays provisional rather than final', async () => {
    mocks.locations.mockRejectedValue(new Error('offline'));
    await saveBatch(task, enqueue);
    expect(db.documents.get(path(22, '2026-10-18'))?.provisional).toBe(true);
  });
});
