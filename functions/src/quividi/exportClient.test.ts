import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '../../tests/firestore';
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => mocks.db }));
vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'synthetic' }),
}));
import { exportSlotOrder, fetchQuividiExport } from './exportClient';
let db: ReturnType<typeof fakeFirestore>;
const params = {
  locations: '11,22',
  start: '2026-10-18T00:00:00',
  end: '2026-10-18T23:59:59',
  data_type: 'ots',
  time_resolution: '1h',
};
beforeEach(() => {
  db = fakeFirestore();
  mocks.db = db;
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('global Quividi export control', () => {
  it('reserves capacity for operational ingestion', () => {
    expect(exportSlotOrder('backfill')).toEqual([1]);
    expect(exportSlotOrder('archive_daily')).toEqual([1]);
    expect(exportSlotOrder('daily')).toEqual([0, 1]);
  });
  it('audits actual exports and releases every lock on success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ state: 'finished', data: [] }),
    );
    await fetchQuividiExport(params, 'recovery');
    const audits = [...db.documents].filter(([path]) =>
      path.includes('/exportAudit/'),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]![1]).toMatchObject({
      source: 'recovery',
      polls: 1,
      status: 'finished',
      locations: '11,22',
    });
    expect(
      [...db.documents.keys()].some((path) =>
        /exportSlots|exportLocks/.test(path),
      ),
    ).toBe(false);
  });
  it('rechecks a shared cache under the lock without calling the API', async () => {
    const cached = { state: 'finished', data: [] };
    expect(await fetchQuividiExport(params, 'live', async () => cached)).toBe(
      cached,
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('protects the reserved slot from archive work, while allowing daily work', async () => {
    db.documents.set('quividiHistoryControl/liverpool/exportSlots/1', {
      owner: 'other',
      expiresAt: Date.now() + 100_000,
    });
    await expect(fetchQuividiExport(params, 'backfill')).rejects.toMatchObject({
      code: 'resource-exhausted',
    });
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ state: 'finished', data: [] }),
    );
    await fetchQuividiExport(params, 'daily');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('releases slots and records failed polls instead of marking timeouts unsupported', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ state: 'failed' }));
    await expect(fetchQuividiExport(params, 'recovery')).rejects.toThrow(
      'no pudo preparar',
    );
    const audit = [...db.documents].find(([path]) =>
      path.includes('/exportAudit/'),
    )![1];
    expect(audit).toMatchObject({ status: 'error', polls: 1 });
    expect(
      [...db.documents.keys()].some((path) =>
        /exportSlots|exportLocks/.test(path),
      ),
    ).toBe(false);
  });
  it('persists a live response before releasing its query lock', async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ state: 'finished', data: [] }),
    );
    await fetchQuividiExport(params, 'live', undefined, async () => {
      expect(
        [...db.documents.keys()].some((path) => path.includes('/exportLocks/')),
      ).toBe(true);
    });
  });
});
