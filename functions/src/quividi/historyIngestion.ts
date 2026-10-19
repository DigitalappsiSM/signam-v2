import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  fetchQuividiExport,
  EXPORT_LEASE_MS,
  type ExportSource,
} from './exportClient';
import {
  missingHistoryRanges,
  isOperationalHistoryExport,
  type HistoryPartitionTask,
} from './ingestionPlan';
import {
  exportDataClass,
  historyDateRange,
  historyRowCivilDate,
  quividiApiExportSpec,
  historyPartitionId,
  isMeasurementExport,
  rawHistoryPath,
  resolveHistoricalBinding,
  rowsFingerprint,
  LIVERPOOL_NETWORK_ID,
  type StoreBinding,
  type HistoryRangeTask,
} from './historyModel';
const INVENTORY = 'quividiHistoryInventory';
const PARTITIONS = 'quividiHistoryPartitions';
const BINDINGS = 'quividiHistoryBindings';
type RangeTask = HistoryRangeTask;
type PartitionTask = HistoryPartitionTask;
interface Location {
  site_id?: number | null;
}

export function mappingStatus(
  binding: StoreBinding | null,
): 'mapped' | 'inferred' | 'needs_review' {
  if (!binding) return 'needs_review';
  return binding.source === 'catalog_inferred' ? 'inferred' : 'mapped';
}

/** A late or out-of-order export can move the start earlier, never later. */
export async function recordFirstMeasuredDate(
  locationId: number,
  date: string,
): Promise<void> {
  const db = getFirestore();
  const ref = db.collection(INVENTORY).doc(String(locationId));
  await db.runTransaction(async (transaction) => {
    const inventory = await transaction.get(ref);
    if (!inventory.exists) return;
    const current = inventory.get('firstMeasuredDate') as string | undefined;
    if (!current || date < current)
      transaction.update(ref, { firstMeasuredDate: date });
  });
}

export async function saveRaw(path: string, payload: unknown): Promise<void> {
  const file = getStorage().bucket().file(path);
  try {
    await file.save(gzipSync(Buffer.from(JSON.stringify(payload))), {
      contentType: 'application/json',
      gzip: false,
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentEncoding: 'gzip' },
    });
  } catch (error) {
    // A retry can race with a prior successful upload of identical bytes.
    const code = (error as { code?: number }).code;
    if (code !== 412) throw error;
  }
}

async function resolveExportScope(task: RangeTask): Promise<RangeTask | null> {
  const db = getFirestore();
  const inventory = await db
    .collection(INVENTORY)
    .doc(String(task.locationId))
    .get();
  if (
    !inventory.exists ||
    inventory.get('networkId') !== LIVERPOOL_NETWORK_ID
  ) {
    throw new Error('Location no pertenece al inventario Liverpool 3089.');
  }
  if (exportDataClass(task.type) !== 'site_aggregate') return task;
  const siteId = (inventory.get('location') as Location).site_id;
  if (!siteId) throw new Error('Export de sitio sin Site ID en topología.');
  const sites = await db.collection(INVENTORY).get();
  const firstLocation = Math.min(
    ...sites.docs
      .filter((doc) => (doc.get('location') as Location).site_id === siteId)
      .map((doc) => Number(doc.id)),
  );
  if (task.locationId !== firstLocation) return null;
  return { ...task, siteId };
}

async function persistPartition(
  task: PartitionTask,
  payload: {
    state: string;
    data?: Record<string, unknown>[];
    [key: string]: unknown;
  },
): Promise<void> {
  const db = getFirestore();
  const id = historyPartitionId(
    task.locationId,
    task.date,
    task.type,
    task.resolution,
  );
  const ref = db.collection(PARTITIONS).doc(id);
  if (payload.state === 'unsupported') {
    const existing = await ref.get();
    if (existing.get('status') === 'complete') {
      await ref.update({
        lastAvailabilityError:
          payload.failReason ?? `HTTP ${payload.httpStatus}`,
        checkedAt: Date.now(),
      });
      return;
    }
    await ref.set(
      {
        ...task,
        networkId: LIVERPOOL_NETWORK_ID,
        status: 'unsupported',
        reason: payload.failReason ?? `HTTP ${payload.httpStatus}`,
        checkedAt: Date.now(),
      },
      { merge: true },
    );
    return;
  }

  const rows = payload.data ?? [];
  const hash = rowsFingerprint(rows);
  const previous = await ref.get();
  if (
    previous.get('currentHash') === hash &&
    previous.get('status') === 'complete'
  ) {
    if (rows.length && isMeasurementExport(task.type)) {
      await recordFirstMeasuredDate(task.locationId, task.date);
    }
    return;
  }

  const path = rawHistoryPath(id, hash);
  await saveRaw(path, { ...payload, data: rows });
  const bindingsSnap = await db
    .collection(BINDINGS)
    .where('locationId', '==', task.locationId)
    .get();
  const bindings = bindingsSnap.docs.map((doc) => doc.data() as StoreBinding);
  const dataClass = exportDataClass(task.type);
  const binding =
    dataClass === 'site_aggregate'
      ? null
      : resolveHistoricalBinding(bindings, task.locationId, task.date);
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  await ref.set(
    {
      ...task,
      networkId: LIVERPOOL_NETWORK_ID,
      storeId: rows.length ? (binding?.storeId ?? null) : null,
      support: rows.length ? (binding?.support ?? null) : null,
      pointId: rows.length ? (binding?.pointId ?? null) : null,
      mappingStatus:
        dataClass === 'site_aggregate' || !rows.length
          ? 'not_applicable'
          : mappingStatus(binding),
      mappingSource: rows.length ? (binding?.source ?? null) : null,
      status: 'complete',
      dataClass,
      currentHash: hash,
      rawPath: path,
      rowCount: rows.length,
      rows:
        task.resolution !== 'finest' && bytes < 700_000
          ? rows
          : FieldValue.delete(),
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  await ref
    .collection('revisions')
    .doc(hash)
    .set({
      hash,
      rawPath: path,
      rowCount: rows.length,
      capturedAt: Date.now(),
      sourceCreationDate: payload.creation_date ?? null,
    });
  if (rows.length && isMeasurementExport(task.type)) {
    await recordFirstMeasuredDate(task.locationId, task.date);
  }
}

/** Claim individual days so overlapping daily, recovery and backfill work cannot re-export them. */
export async function saveRange(
  task: RangeTask,
  source: ExportSource = 'backfill',
): Promise<void> {
  const scoped = await resolveExportScope(task);
  if (!scoped) return;
  const db = getFirestore();
  const dates = historyDateRange(scoped.startDate, scoped.endDate);
  const refs = dates.map((date) =>
    db
      .collection(PARTITIONS)
      .doc(
        historyPartitionId(
          scoped.locationId,
          date,
          scoped.type,
          scoped.resolution,
        ),
      ),
  );
  const owner = randomUUID();
  const claimedDates = await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(...refs);
    const now = Date.now();
    const pending = snapshots.flatMap((snapshot, index) => {
      if (snapshot.get('status') === 'complete') return [];
      // A negative availability response is not a measured zero; avoid retry storms.
      if (
        snapshot.get('status') === 'unsupported' &&
        now - Number(snapshot.get('checkedAt') ?? 0) < 6 * 60 * 60 * 1000
      )
        return [];
      if (Number(snapshot.get('exportLeaseUntil') ?? 0) > now) {
        throw new HttpsError(
          'resource-exhausted',
          'La información de audiencia ya se está preparando.',
        );
      }
      return [{ ref: refs[index]!, date: dates[index]! }];
    });
    for (const item of pending)
      transaction.set(
        item.ref,
        {
          exportLeaseOwner: owner,
          exportLeaseUntil: now + EXPORT_LEASE_MS,
        },
        { merge: true },
      );
    return pending.map((item) => item.date);
  });
  if (!claimedDates.length) return;
  try {
    const completed = new Set(
      dates.filter((date) => !claimedDates.includes(date)),
    );
    // Bound archive requests and resume only missing subranges after a partial failure.
    for (const range of missingHistoryRanges(scoped, completed)) {
      const apiSpec = quividiApiExportSpec(range.type);
      const params: Record<string, string> = {
        [range.siteId ? 'sites' : 'locations']: String(
          range.siteId ?? range.locationId,
        ),
        start: `${range.startDate}T00:00:00`,
        end: `${range.endDate}T23:59:59`,
        data_type: apiSpec.dataType,
        time_resolution: range.resolution,
      };
      if (apiSpec.groupByDemographics) params.group_by_demographics = '1';
      if (range.type.startsWith('extrapolated_'))
        params.extrapolation_amount = '';
      const capabilityId = rowsFingerprint([
        {
          scope: range.siteId
            ? `site:${range.siteId}`
            : `location:${range.locationId}`,
          type: range.type,
          resolution: range.resolution,
        },
      ]);
      const capability = db
        .collection('quividiHistoryControl')
        .doc('liverpool')
        .collection('exportCapabilities')
        .doc(capabilityId);
      const availability = await capability.get();
      const payload =
        Number(availability.get('nextProbeAt') ?? 0) > Date.now()
          ? { state: 'unsupported', httpStatus: 403 }
          : await fetchQuividiExport(params, source);
      if (
        payload.state === 'unsupported' &&
        payload.httpStatus === 403 &&
        Number(availability.get('nextProbeAt') ?? 0) <= Date.now()
      ) {
        await capability.set({
          locationId: range.locationId,
          siteId: range.siteId ?? null,
          type: range.type,
          resolution: range.resolution,
          checkedAt: Date.now(),
          nextProbeAt: Date.now() + 6 * 60 * 60 * 1000,
        });
      }
      const days = historyDateRange(range.startDate, range.endDate);
      const byDate = new Map<string, Record<string, unknown>[]>(
        days.map((date) => [date, []]),
      );
      for (const row of payload.data ?? []) {
        const date = historyRowCivilDate(row);
        if (!date || !byDate.has(date))
          throw new Error(
            'Fila Quividi sin fecha reconocible dentro del rango.',
          );
        byDate.get(date)!.push(row);
      }
      for (const date of days)
        await persistPartition(
          {
            date,
            locationId: range.locationId,
            type: range.type,
            resolution: range.resolution,
            ...(range.siteId ? { siteId: range.siteId } : {}),
          },
          { ...payload, data: byDate.get(date)! },
        );
    }
  } finally {
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...refs);
      for (const snapshot of snapshots)
        if (snapshot.get('exportLeaseOwner') === owner) {
          transaction.update(snapshot.ref, {
            exportLeaseOwner: FieldValue.delete(),
            exportLeaseUntil: FieldValue.delete(),
          });
        }
    });
  }
}

export async function savePartition(task: PartitionTask): Promise<void> {
  const source: ExportSource =
    task.source === 'daily'
      ? isOperationalHistoryExport(task)
        ? 'daily'
        : 'archive_daily'
      : (task.source ?? 'backfill');
  await saveRange(
    { ...task, startDate: task.date, endDate: task.date },
    source,
  );
}
