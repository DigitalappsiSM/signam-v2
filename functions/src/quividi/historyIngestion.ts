import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  fetchQuividiExport,
  fetchQuividiLocations,
  EXPORT_LEASE_MS,
  type ExportSource,
} from './exportClient';
import {
  exportBatchLimits,
  freshestLastSeen,
  isOperationalHistoryExport,
  lastSeenCoversDay,
  nextProvisionalState,
  planBatchExports,
  unsupportedRetryMs,
  type HistoryBatchTask,
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
} from './historyModel';
const INVENTORY = 'quividiHistoryInventory';
const PARTITIONS = 'quividiHistoryPartitions';
const BINDINGS = 'quividiHistoryBindings';
/** Fechas cuyo histórico cambió después de guardarse: invalidan los reportes ya generados. */
export const LATE_DATA = 'quividiHistoryLateData';

interface PartitionKey {
  locationId: number;
  date: string;
  type: string;
  resolution: string;
}

interface Coverage {
  covered: boolean;
  lastSeen: string | null;
  recheck: boolean;
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

function capabilityRef(scope: string, type: string, resolution: string) {
  return getFirestore()
    .collection('quividiHistoryControl')
    .doc('liverpool')
    .collection('exportCapabilities')
    .doc(rowsFingerprint([{ scope, type, resolution }]));
}

async function persistUnsupported(
  key: PartitionKey,
  reason: string,
): Promise<void> {
  const ref = getFirestore()
    .collection(PARTITIONS)
    .doc(
      historyPartitionId(key.locationId, key.date, key.type, key.resolution),
    );
  const existing = await ref.get();
  if (existing.get('status') === 'complete') {
    await ref.update({ lastAvailabilityError: reason, checkedAt: Date.now() });
    return;
  }
  await ref.set(
    {
      ...key,
      networkId: LIVERPOOL_NETWORK_ID,
      status: 'unsupported',
      reason,
      checkedAt: Date.now(),
    },
    { merge: true },
  );
}

async function persistPartition(
  key: PartitionKey,
  payload: QuividiPayload,
  rows: Record<string, unknown>[],
  coverage: Coverage,
): Promise<void> {
  const db = getFirestore();
  const id = historyPartitionId(
    key.locationId,
    key.date,
    key.type,
    key.resolution,
  );
  const ref = db.collection(PARTITIONS).doc(id);
  const hash = rowsFingerprint(rows);
  const previous = await ref.get();
  const provisional = nextProvisionalState(
    previous.exists ? previous.data() : undefined,
    coverage.covered,
    coverage.recheck,
  );
  const provisionalFields = {
    ...provisional,
    provisionalLastSeen: coverage.lastSeen,
    provisionalCheckedAt: Date.now(),
  };
  const wasComplete = previous.get('status') === 'complete';
  if (previous.get('currentHash') === hash && wasComplete) {
    await ref.update(provisionalFields);
    if (rows.length && isMeasurementExport(key.type)) {
      await recordFirstMeasuredDate(key.locationId, key.date);
    }
    return;
  }

  const path = rawHistoryPath(id, hash);
  await saveRaw(path, { ...payload, data: rows });
  const bindingsSnap = await db
    .collection(BINDINGS)
    .where('locationId', '==', key.locationId)
    .get();
  const bindings = bindingsSnap.docs.map((doc) => doc.data() as StoreBinding);
  const dataClass = exportDataClass(key.type);
  const binding =
    dataClass === 'site_aggregate'
      ? null
      : resolveHistoricalBinding(bindings, key.locationId, key.date);
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  await ref.set(
    {
      ...key,
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
        key.resolution !== 'finest' && bytes < 700_000
          ? rows
          : FieldValue.delete(),
      updatedAt: Date.now(),
      ...provisionalFields,
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
  // Llegó información tardía a un día ya usado: los reportes de esa fecha deben rehacerse.
  if (wasComplete && isOperationalHistoryExport(key)) {
    await db
      .collection(LATE_DATA)
      .doc(key.date)
      .set({ date: key.date, updatedAt: Date.now() }, { merge: true });
  }
  if (rows.length && isMeasurementExport(key.type)) {
    await recordFirstMeasuredDate(key.locationId, key.date);
  }
}

type QuividiPayload = {
  state: string;
  data?: Record<string, unknown>[];
  httpStatus?: number;
  [key: string]: unknown;
};

/** Pendiente = sin dato completo, o provisional cuando se está releyendo. */
function isPending(
  snapshot: { get: (field: string) => unknown },
  task: HistoryBatchTask,
  now: number,
): boolean | 'leased' {
  const status = snapshot.get('status');
  if (status === 'complete')
    return task.recheck === true && snapshot.get('provisional') === true;
  // A negative availability response is not a measured zero; avoid retry storms.
  if (
    status === 'unsupported' &&
    now - Number(snapshot.get('checkedAt') ?? 0) < unsupportedRetryMs(task)
  )
    return false;
  if (Number(snapshot.get('exportLeaseUntil') ?? 0) > now) return 'leased';
  return true;
}

function sourceFor(task: HistoryBatchTask): ExportSource {
  const operational = isOperationalHistoryExport(task);
  if (task.source === 'daily') return operational ? 'daily' : 'archive_daily';
  return task.source ?? 'backfill';
}

export type EnqueueChunk = (task: HistoryBatchTask) => Promise<void>;

/**
 * Exporta varias ubicaciones y días de una serie con el menor número de exports.
 * Una tarea que necesita más de un export se divide en tareas `chunk`, cada una con un
 * solo export, para que ninguna ejecución supere el tiempo de la función.
 */
export async function saveBatch(
  task: HistoryBatchTask,
  enqueueChunk: EnqueueChunk,
): Promise<void> {
  const db = getFirestore();
  if (exportDataClass(task.type) === 'site_aggregate')
    throw new Error('Las series por sitio ya no se ingieren.');
  const locationIds = [...new Set(task.locationIds)].sort((a, b) => a - b);
  if (!locationIds.length) return;
  const inventory = await db.getAll(
    ...locationIds.map((id) => db.collection(INVENTORY).doc(String(id))),
  );
  if (
    inventory.some(
      (doc) => !doc.exists || doc.get('networkId') !== LIVERPOOL_NETWORK_ID,
    )
  ) {
    throw new Error('Location no pertenece al inventario Liverpool 3089.');
  }

  const dates = historyDateRange(task.startDate, task.endDate);
  const keys: PartitionKey[] = locationIds.flatMap((locationId) =>
    dates.map((date) => ({
      locationId,
      date,
      type: task.type,
      resolution: task.resolution,
    })),
  );
  const refs = keys.map((key) =>
    db
      .collection(PARTITIONS)
      .doc(
        historyPartitionId(key.locationId, key.date, key.type, key.resolution),
      ),
  );

  // Ubicaciones que respondieron 403 hace poco: no se piden, quedan como no disponibles.
  const capabilities = await db.getAll(
    ...locationIds.map((id) =>
      capabilityRef(`location:${id}`, task.type, task.resolution),
    ),
  );
  const deniedLocations = new Set(
    locationIds.filter(
      (_, index) =>
        Number(capabilities[index]!.get('nextProbeAt') ?? 0) > Date.now(),
    ),
  );
  const batchCapability = await capabilityRef(
    'batch',
    task.type,
    task.resolution,
  ).get();
  const limits = exportBatchLimits(task.resolution);
  if (batchCapability.get('perLocation') === true) limits.locations = 1;

  const now = Date.now();
  const pending = new Map<number, Set<string>>();
  const deniedKeys: PartitionKey[] = [];
  for (let offset = 0; offset < refs.length; offset += 250) {
    const snapshots = await db.getAll(...refs.slice(offset, offset + 250));
    snapshots.forEach((snapshot, index) => {
      const key = keys[offset + index]!;
      if (isPending(snapshot, task, now) !== true) return;
      if (deniedLocations.has(key.locationId)) {
        if (snapshot.get('status') !== 'unsupported') deniedKeys.push(key);
        return;
      }
      const set = pending.get(key.locationId) ?? new Set<string>();
      set.add(key.date);
      pending.set(key.locationId, set);
    });
  }
  for (const key of deniedKeys) await persistUnsupported(key, 'HTTP 403');

  const chunks = task.chunk
    ? pending.size
      ? [
          {
            locationIds: [...pending.keys()].sort((a, b) => a - b),
            startDate: task.startDate,
            endDate: task.endDate,
          },
        ]
      : []
    : planBatchExports(pending, limits);
  if (!chunks.length) return;
  if (chunks.length > 1) {
    for (const chunk of chunks)
      await enqueueChunk({ ...task, ...chunk, chunk: true });
    return;
  }
  await exportChunk({ ...task, ...chunks[0]!, chunk: true }, enqueueChunk);
}

async function exportChunk(
  task: HistoryBatchTask,
  enqueueChunk: EnqueueChunk,
): Promise<void> {
  const db = getFirestore();
  const dates = historyDateRange(task.startDate, task.endDate);
  const keys: PartitionKey[] = task.locationIds.flatMap((locationId) =>
    dates.map((date) => ({
      locationId,
      date,
      type: task.type,
      resolution: task.resolution,
    })),
  );
  const refs = keys.map((key) =>
    db
      .collection(PARTITIONS)
      .doc(
        historyPartitionId(key.locationId, key.date, key.type, key.resolution),
      ),
  );
  const owner = randomUUID();
  // Claim individual days so overlapping daily, recovery and backfill work cannot re-export them.
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshots = await transaction.getAll(...refs);
    const now = Date.now();
    const result: PartitionKey[] = [];
    snapshots.forEach((snapshot, index) => {
      if (isPending(snapshot, task, now) !== true) return;
      transaction.set(
        refs[index]!,
        { exportLeaseOwner: owner, exportLeaseUntil: now + EXPORT_LEASE_MS },
        { merge: true },
      );
      result.push(keys[index]!);
    });
    return result;
  });
  // Otro trabajador ya tiene esos días; él los termina y no se vuelven a pedir.
  if (!claimed.length) return;
  const claimedRefs = claimed.map((key) =>
    db
      .collection(PARTITIONS)
      .doc(
        historyPartitionId(key.locationId, key.date, key.type, key.resolution),
      ),
  );
  const locations = [...new Set(claimed.map((key) => key.locationId))].sort(
    (a, b) => a - b,
  );
  const claimedDates = claimed.map((key) => key.date).sort();
  const startDate = claimedDates[0]!;
  const endDate = claimedDates.at(-1)!;
  const splitPerLocation = async () => {
    for (const locationId of locations)
      await enqueueChunk({
        ...task,
        locationIds: [locationId],
        startDate,
        endDate,
        chunk: true,
      });
  };

  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...claimedRefs);
      for (const snapshot of snapshots)
        if (snapshot.get('exportLeaseOwner') === owner) {
          transaction.update(snapshot.ref, {
            exportLeaseOwner: FieldValue.delete(),
            exportLeaseUntil: FieldValue.delete(),
          });
        }
    });
  };

  try {
    const apiSpec = quividiApiExportSpec(task.type);
    const params: Record<string, string> = {
      locations: locations.join(','),
      start: `${startDate}T00:00:00`,
      end: `${endDate}T23:59:59`,
      data_type: apiSpec.dataType,
      time_resolution: task.resolution,
    };
    if (apiSpec.groupByDemographics) params.group_by_demographics = '1';
    if (task.type.startsWith('extrapolated_')) params.extrapolation_amount = '';
    const payload = (await fetchQuividiExport(
      params,
      sourceFor(task),
      undefined,
      undefined,
      isOperationalHistoryExport(task),
    )) as QuividiPayload;

    if (payload.state === 'unsupported') {
      if (locations.length > 1) {
        // Una sola ubicación sin licencia rechaza el lote completo: se aísla cuál es.
        await release();
        await splitPerLocation();
        return;
      }
      if (payload.httpStatus === 403) {
        await capabilityRef(
          `location:${locations[0]}`,
          task.type,
          task.resolution,
        ).set({
          locationId: locations[0],
          type: task.type,
          resolution: task.resolution,
          checkedAt: Date.now(),
          nextProbeAt: Date.now() + unsupportedRetryMs(task),
        });
      }
      for (const key of claimed)
        await persistUnsupported(
          key,
          String(payload.failReason ?? `HTTP ${payload.httpStatus}`),
        );
      return;
    }

    const rowsByKey = new Map<string, Record<string, unknown>[]>(
      claimed.map((key) => [`${key.locationId}__${key.date}`, []]),
    );
    const requested = new Set(locations);
    const requestedDates = new Set(historyDateRange(startDate, endDate));
    for (const row of payload.data ?? []) {
      const date = historyRowCivilDate(row);
      if (!date || !requestedDates.has(date))
        throw new Error('Fila Quividi sin fecha reconocible dentro del rango.');
      const rawLocation = Number(row.location_id);
      if (!Number.isInteger(rawLocation) || rawLocation < 1) {
        if (locations.length > 1) {
          // Esta serie no identifica la ubicación por fila: se pide por ubicación en adelante.
          await capabilityRef('batch', task.type, task.resolution).set({
            type: task.type,
            resolution: task.resolution,
            perLocation: true,
            checkedAt: Date.now(),
          });
          await release();
          await splitPerLocation();
          return;
        }
      } else if (!requested.has(rawLocation)) {
        throw new Error(
          'La exportación Quividi contiene ubicaciones no solicitadas.',
        );
      }
      const locationId =
        Number.isInteger(rawLocation) && rawLocation > 0
          ? rawLocation
          : locations[0]!;
      // Un día ya completo de otra ubicación del mismo lote no se reescribe.
      rowsByKey.get(`${locationId}__${date}`)?.push(row);
    }

    let lastSeenByLocation = new Map<number, string | null>();
    try {
      lastSeenByLocation = new Map(
        (await fetchQuividiLocations()).map((location) => [
          location.id,
          location.last_seen ?? null,
        ]),
      );
    } catch (error) {
      // Sin topología no se sabe si la cámara terminó de enviar: todo queda provisional.
      console.warn('No se pudo leer last_seen de Quividi.', error);
    }
    const freshest = freshestLastSeen(lastSeenByLocation.values());
    const now = Date.now();
    const emptyBatch = !(payload.data ?? []).length && locations.length > 1;
    for (const key of claimed) {
      const lastSeen = lastSeenByLocation.get(key.locationId) ?? null;
      await persistPartition(
        key,
        payload,
        rowsByKey.get(`${key.locationId}__${key.date}`)!,
        {
          covered:
            !emptyBatch && lastSeenCoversDay(lastSeen, freshest, key.date, now),
          lastSeen,
          recheck: task.recheck === true,
        },
      );
    }
  } catch (error) {
    // A failed export is retried, never stored as a measured zero.
    await db.runTransaction(async (transaction) => {
      const snapshots = await transaction.getAll(...claimedRefs);
      snapshots.forEach((snapshot, index) => {
        if (snapshot.get('status') === 'complete') return;
        transaction.set(
          snapshot.ref,
          {
            ...claimed[index]!,
            networkId: LIVERPOOL_NETWORK_ID,
            status: 'retrying',
            lastError:
              error instanceof Error
                ? error.message
                : 'Error de ingestión Quividi.',
            lastAttemptAt: Date.now(),
          },
          { merge: true },
        );
      });
    });
    throw error;
  } finally {
    await release();
  }
}
