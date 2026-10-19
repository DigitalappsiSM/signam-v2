import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { getFunctions } from 'firebase-admin/functions';
import { FieldPath, FieldValue, getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { roleFromClaims } from './access';
import { mappingStatus, recordFirstMeasuredDate, saveBatch, saveRaw } from './historyIngestion';
import {
  isOperationalHistoryExport,
  planLateDataRechecks,
  toBatchTask,
  type HistoryBatchTask,
  type HistoryPartitionTask,
  type ProvisionalPartition,
} from './ingestionPlan';
import type { ScreenDoc } from './effectiveScope';
import {
  CONSUMER_HISTORY_EXPORTS,
  HISTORY_EXPORTS,
  HISTORY_START_DATE,
  LIVERPOOL_NETWORK_ID,
  historyDateRange,
  isMeasurementExport,
  exportDataClass,
  historyMonthRangeAt,
  earliestMeasuredDate,
  isActiveHistoryExport,
  inferredCatalogBinding,
  inventoryBindings,
  historyCatalogStores,
  validHistoryCatalogSelection,
  replaceHistoricalBinding,
  resolveHistoricalBinding,
  rowsFingerprint,
  type StoreBinding,
} from './historyModel';

const USERNAME = defineSecret('QUIVIDI_API_USERNAME');
const TOKEN = defineSecret('QUIVIDI_API_TOKEN');
const BASE = 'https://vidicenter.quividi.com/api/v1';
const CONTROL = 'quividiHistoryControl';
const PARTITIONS = 'quividiHistoryPartitions';
const BINDINGS = 'quividiHistoryBindings';
const INVENTORY = 'quividiHistoryInventory';
const EXPORTS_PER_TICK = 150;

interface Location {
  id: number;
  active?: boolean;
  site_id?: number | null;
  box_id?: number | null;
  creation_date?: string;
  [key: string]: unknown;
}

type PartitionTask = HistoryPartitionTask;

type RangeTask = import('./historyModel').HistoryRangeTask;

type ExportSpec = { type: string; resolution: string };

interface ReconcileTask { locationId: number; after?: string }

function auth(): string {
  return 'Basic ' + Buffer.from(`${USERNAME.value()}:${TOKEN.value()}`).toString('base64');
}

async function api(path: string): Promise<unknown> {
  const response = await fetch(BASE + path, {
    headers: { Authorization: auth(), Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Quividi HTTP ${response.status} (${path.split('?')[0]}).`);
  return response.json();
}

function yesterdayMexico(): string {
  const now = Date.now() - 86_400_000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function todayMexico(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(Date.now());
}

function dateAt(index: number): string {
  return new Date(Date.parse(HISTORY_START_DATE + 'T00:00:00Z') +
    index * 86_400_000).toISOString().slice(0, 10);
}

/** Bring partitions saved before this rule into the measurement index gradually. */
async function indexExistingMeasurements(): Promise<void> {
  const db = getFirestore();
  const control = db.collection(CONTROL).doc('liverpool');
  const snapshot = await control.get();
  if (!snapshot.exists || snapshot.get('measurementIndexVersion') === 1) return;
  let query = db.collection(PARTITIONS).orderBy(FieldPath.documentId()).limit(200);
  const after = snapshot.get('measurementIndexAfter') as string | undefined;
  if (after) query = query.startAfter(after);
  const page = await query.get();
  const earliest = new Map<number, string>();
  const batch = db.batch();
  for (const doc of page.docs) {
    if (doc.get('status') !== 'complete') continue;
    const rows = doc.get('rowCount') as number | undefined;
    if (rows === 0 && doc.get('mappingStatus') !== 'not_applicable') {
      batch.update(doc.ref, {
        storeId: null, support: null, pointId: null, mappingSource: null, mappingStatus: 'not_applicable',
      });
    }
    if (!rows || !isMeasurementExport(doc.get('type') as string)) continue;
    const locationId = doc.get('locationId') as number;
    const date = doc.get('date') as string;
    if (!Number.isInteger(locationId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const next = earliestMeasuredDate(earliest.get(locationId) ?? null,
      date, doc.get('type') as string, rows);
    if (next) earliest.set(locationId, next);
  }
  await batch.commit();
  for (const [locationId, date] of earliest) await recordFirstMeasuredDate(locationId, date);
  if (page.size < 200) {
    await control.update({ measurementIndexVersion: 1,
      measurementIndexAfter: FieldValue.delete(), measurementIndexAt: Date.now() });
  } else {
    await control.update({ measurementIndexAfter: page.docs[page.size - 1]!.id });
  }
}

/** Upgrade an already running backfill once, including partitions saved before this change. */
async function inferExistingCatalogHistory(): Promise<void> {
  const db = getFirestore();
  const control = db.collection(CONTROL).doc('liverpool');
  const snapshot = await control.get();
  if (!snapshot.exists || snapshot.get('catalogInferenceVersion') === 2) return;
  const existing = await db.collection(BINDINGS).get();
  const [screens, inventory] = await Promise.all([
    db.collection('screens').get(), db.collection(INVENTORY).get(),
  ]);
  const candidates = inventoryBindings(screens.docs.map((doc) => doc.data() as ScreenDoc),
    new Set(inventory.docs.map((doc) => Number(doc.id))), todayMexico()).candidates;
  const newBindings = candidates.filter((candidate) =>
    !existing.docs.some((doc) => doc.get('locationId') === candidate.locationId));
  const groups = new Map<number, StoreBinding[]>();
  for (const doc of existing.docs) {
    const binding = doc.data() as StoreBinding;
    groups.set(binding.locationId, [...(groups.get(binding.locationId) ?? []), binding]);
  }
  for (const binding of newBindings) groups.set(binding.locationId, [binding]);
  const inferredLocations: number[] = [];
  const batch = db.batch();
  for (const binding of newBindings) {
    batch.create(db.collection(BINDINGS).doc(`${binding.locationId}__${binding.validFrom}`), binding);
  }
  for (const [locationId, bindings] of groups) {
    const current = bindings.filter((binding) =>
      binding.source === 'catalog' && binding.validTo === null);
    const historical = bindings.filter((binding) => binding.source !== 'catalog_inferred' &&
      binding !== current[0]);
    if (current.length !== 1 || historical.length ||
        bindings.some((binding) => binding.source === 'manual')) continue;
    const inferred = inferredCatalogBinding(current[0]!);
    if (!inferred) continue;
    const ref = db.collection(BINDINGS).doc(`${locationId}__${HISTORY_START_DATE}`);
    if (!existing.docs.some((doc) => doc.id === ref.id)) batch.create(ref, inferred);
    inferredLocations.push(locationId);
  }
  await batch.commit();
  for (const locationId of inferredLocations) {
    await getFunctions().taskQueue('quividi-historyReconcile').enqueue({ locationId } satisfies ReconcileTask);
  }
  await control.update({ catalogInferenceVersion: 2, catalogInferenceAt: Date.now() });
}

function taskAt(index: number, locationIds: readonly number[], plan: readonly ExportSpec[]): PartitionTask {
  const exportIndex = index % plan.length;
  const locationIndex = Math.floor(index / plan.length) % locationIds.length;
  const dayIndex = Math.floor(index / (plan.length * locationIds.length));
  return {
    date: dateAt(dayIndex),
    locationId: locationIds[locationIndex]!,
    ...plan[exportIndex]!,
  };
}

async function archiveNetworkTopology(
  date: string,
  locations: Location[],
): Promise<void> {
  for (const kind of ['locations', 'sites', 'boxes'] as const) {
    try {
      const payload = kind === 'locations' ? locations :
        await api(`/network/${LIVERPOOL_NETWORK_ID}/${kind}/`);
      if (!Array.isArray(payload)) throw new Error(`Topología ${kind} inválida.`);
      const hash = rowsFingerprint(payload as Record<string, unknown>[]);
      const path = `quividi-history/network-${LIVERPOOL_NETWORK_ID}/topology/${date}/${kind}/${hash}.json.gz`;
      await saveRaw(path, payload);
      await getFirestore().collection('quividiHistoryTopology').doc(`${date}__${kind}`).set({
        networkId: LIVERPOOL_NETWORK_ID, date, kind, currentHash: hash,
        rawPath: path, rowCount: payload.length, capturedAt: Date.now(),
      });
    } catch (error) {
      if (kind === 'locations') throw error;
      console.warn(`No se pudo archivar ${kind} para la network Liverpool.`, error);
    }
  }
  // The status endpoints expose only their most recent messages, not a full backfill.
  for (const kind of ['alerts', 'monitoring_msgs'] as const) {
    try {
      const payload = await api(`/network/${LIVERPOOL_NETWORK_ID}/${kind}/`);
      if (!Array.isArray(payload)) continue;
      const hash = rowsFingerprint(payload as Record<string, unknown>[]);
      const path = `quividi-history/network-${LIVERPOOL_NETWORK_ID}/status/${date}/${kind}/${hash}.json.gz`;
      await saveRaw(path, payload);
      await getFirestore().collection('quividiHistoryTopology').doc(`${date}__${kind}`).set({
        networkId: LIVERPOOL_NETWORK_ID, date, kind, currentHash: hash,
        rawPath: path, rowCount: payload.length, capturedAt: Date.now(),
      });
    } catch (error) {
      console.warn(`No se pudo archivar ${kind} para la network Liverpool.`, error);
    }
  }
}

/** Explicit admin start: no historical jobs run before the network is verified. */
export const historyStart = onCall({
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '512MiB',
}, async (request) => {
  if (!request.auth || roleFromClaims(request.auth.token) !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin puede iniciar la carga histórica.');
  }
  const db = getFirestore();
  const control = await db.collection(CONTROL).doc('liverpool').get();
  if (control.exists) {
    return { networkId: LIVERPOOL_NETWORK_ID, status: control.get('status'),
      locations: (control.get('locationIds') as number[]).length,
      startDate: HISTORY_START_DATE };
  }
  const locations = await api(`/network/${LIVERPOOL_NETWORK_ID}/locations/`) as Location[];
  if (!Array.isArray(locations) || locations.length === 0 ||
      locations.some((item) => !Number.isInteger(item.id) || item.id < 1)) {
    throw new HttpsError('failed-precondition', 'La network 3089 no devolvió locations válidas.');
  }
  const ids = [...new Set(locations.map((item) => item.id))].sort((a, b) => a - b);
  await archiveNetworkTopology(todayMexico(), locations);
  const screensSnap = await db.collection('screens').get();
  const screens = screensSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ScreenDoc));
  const today = todayMexico();
  const { candidates, conflicts } = inventoryBindings(screens, new Set(ids), today);
  const batch = db.batch();
  for (const location of locations) {
    batch.set(db.collection(INVENTORY).doc(String(location.id)), {
      networkId: LIVERPOOL_NETWORK_ID, location, observedAt: Date.now(),
    }, { merge: true });
  }
  // Current catalog confirms today's assignment only, never 2026-01-01.
  for (const binding of candidates) {
    const ref = db.collection(BINDINGS).doc(`${binding.locationId}__${today}`);
    if (!(await ref.get()).exists) batch.create(ref, binding);
    const inferred = inferredCatalogBinding(binding);
    if (inferred) batch.create(db.collection(BINDINGS)
      .doc(`${binding.locationId}__${HISTORY_START_DATE}`), inferred);
  }
  await batch.commit();
  await db.collection(CONTROL).doc('liverpool').create({
    networkId: LIVERPOOL_NETWORK_ID, locationIds: ids, nextIndex: 0,
    exportPlan: HISTORY_EXPORTS.map((item) => ({ ...item })),
    startDate: HISTORY_START_DATE, status: 'running', mode: 'backfill',
    startedAt: Date.now(),
    catalogInferenceVersion: 2,
  });
  return { networkId: LIVERPOOL_NETWORK_ID, locations: ids.length,
    catalogBindings: candidates.length, conflicts, startDate: HISTORY_START_DATE };
});

export const historyOverview = onCall(async (request) => {
  if (!request.auth || roleFromClaims(request.auth.token) !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin consulta el histórico.');
  }
  const db = getFirestore();
  const [controls, inventory, bindings, completed, inferred, pending, unsupported, retrying, screens] =
    await Promise.all([
      db.collection(CONTROL).get(),
      db.collection(INVENTORY).get(),
      db.collection(BINDINGS).where('validTo', '==', null).get(),
      db.collection(PARTITIONS).where('status', '==', 'complete').count().get(),
      db.collection(PARTITIONS).where('mappingStatus', '==', 'inferred').count().get(),
      db.collection(PARTITIONS).where('mappingStatus', '==', 'needs_review').count().get(),
      db.collection(PARTITIONS).where('status', '==', 'unsupported').count().get(),
      db.collection(PARTITIONS).where('status', '==', 'retrying').count().get(),
      db.collection('screens').get(),
    ]);
  const activeByLocation = new Map(bindings.docs.map((doc) => {
    const binding = doc.data() as StoreBinding;
    return [binding.locationId, binding] as const;
  }));
  // One indexed result per location: the UI asks for cameras, not thousands of partitions.
  const pendingByLocation = new Map(await Promise.all(inventory.docs.map(async (doc) => {
    if (pending.data().count === 0) return [Number(doc.id), false] as const;
    const result = await db.collection(PARTITIONS)
      .where('locationId', '==', Number(doc.id))
      .where('mappingStatus', '==', 'needs_review')
      .limit(1).get();
    return [Number(doc.id), !result.empty] as const;
  })));
  return {
    networkId: LIVERPOOL_NETWORK_ID,
    started: controls.docs.some((doc) => doc.id === 'liverpool'),
    queued: controls.docs.reduce((sum, doc) => sum + (doc.get('nextIndex') as number ?? 0), 0),
    completed: completed.data().count,
    inferred: inferred.data().count,
    needsReview: pending.data().count,
    unsupported: unsupported.data().count,
    retrying: retrying.data().count,
    stores: historyCatalogStores(screens.docs.map((doc) => doc.data() as ScreenDoc)),
    locations: inventory.docs.map((doc) => {
      const location = doc.get('location') as Location;
      const binding = activeByLocation.get(location.id);
      return { id: location.id, label: String(location.label ?? location.name ?? location.id),
        active: location.active !== false, storeId: binding?.storeId ?? null,
        storeName: binding?.storeName ?? '', support: binding?.support ?? '',
        pointId: binding?.pointId ?? null, validFrom: binding?.validFrom ?? null,
        firstMeasuredDate: doc.get('firstMeasuredDate') ?? null,
        hasPendingData: pendingByLocation.get(location.id) ?? false };
    }).sort((a, b) => a.label.localeCompare(b.label, 'es')),
  };
});


interface HistoryExplorerInput {
  startDate?: unknown;
  endDate?: unknown;
  locationId?: unknown;
  type?: unknown;
  resolution?: unknown;
  storeId?: unknown;
  support?: unknown;
  status?: unknown;
}

async function historicalPartitionRows(doc: QueryDocumentSnapshot): Promise<Record<string, unknown>[]> {
  const embedded = doc.get('rows');
  if (Array.isArray(embedded)) return embedded as Record<string, unknown>[];
  const rawPath = doc.get('rawPath');
  if (typeof rawPath !== 'string' || !rawPath) return [];
  const [bytes] = await getStorage().bucket().file(rawPath).download();
  const payload = JSON.parse(gunzipSync(bytes).toString('utf8')) as { data?: unknown };
  return Array.isArray(payload.data) ? payload.data as Record<string, unknown>[] : [];
}

/**
 * Explorador de conciliación: lee exclusivamente el histórico persistido.
 * No consulta VidiCenter, por lo que filtrar/exportar aquí no aumenta el consumo de API Quividi.
 */
export const historyExplore = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  if (!request.auth || roleFromClaims(request.auth.token) !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin puede explorar el histórico Quividi.');
  }
  const input = (request.data ?? {}) as HistoryExplorerInput;
  const startDate = typeof input.startDate === 'string' ? input.startDate : '';
  const endDate = typeof input.endDate === 'string' ? input.endDate : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      startDate > endDate) {
    throw new HttpsError('invalid-argument', 'Selecciona un rango de fechas válido.');
  }
  const days = historyDateRange(startDate, endDate);
  if (days.length > 31) {
    throw new HttpsError('invalid-argument', 'El explorador admite hasta 31 días por consulta.');
  }

  const locationId = Number.isInteger(input.locationId) ? input.locationId as number : null;
  const type = typeof input.type === 'string' ? input.type.trim() : '';
  const resolution = typeof input.resolution === 'string' ? input.resolution.trim() : '';
  const storeId = typeof input.storeId === 'string' ? input.storeId.trim() : '';
  const support = typeof input.support === 'string' ? input.support.trim() : '';
  const status = typeof input.status === 'string' ? input.status.trim() : '';

  const snapshot = await getFirestore().collection(PARTITIONS)
    .where('date', '>=', startDate).where('date', '<=', endDate)
    .orderBy('date').limit(2500).get();

  const docs = snapshot.docs.filter((doc) => {
    if (locationId !== null && doc.get('locationId') !== locationId) return false;
    if (type && doc.get('type') !== type) return false;
    if (resolution && doc.get('resolution') !== resolution) return false;
    if (storeId && doc.get('storeId') !== storeId) return false;
    if (support && doc.get('support') !== support) return false;
    if (status && doc.get('status') !== status) return false;
    return true;
  });

  const summary = {
    partitions: docs.length,
    complete: docs.filter((doc) => doc.get('status') === 'complete').length,
    retrying: docs.filter((doc) => doc.get('status') === 'retrying').length,
    unsupported: docs.filter((doc) => doc.get('status') === 'unsupported').length,
    empty: docs.filter((doc) => Number(doc.get('rowCount') ?? 0) === 0).length,
    sourceRows: docs.reduce((sum, doc) => sum + Number(doc.get('rowCount') ?? 0), 0),
    locations: new Set(docs.map((doc) => doc.get('locationId'))).size,
    truncatedPartitions: snapshot.size === 2500,
  };

  const partitionRows = docs.slice(0, 200);
  const rows: Array<Record<string, unknown>> = [];
  const columns = new Set<string>();
  let truncatedRows = false;
  for (const doc of partitionRows) {
    if (doc.get('status') !== 'complete') continue;
    const sourceRows = await historicalPartitionRows(doc);
    for (const source of sourceRows) {
      if (rows.length >= 5000) {
        truncatedRows = true;
        break;
      }
      const row: Record<string, unknown> = {
        _date: doc.get('date'),
        _locationId: doc.get('locationId'),
        _type: doc.get('type'),
        _resolution: doc.get('resolution'),
        _storeId: doc.get('storeId') ?? null,
        _support: doc.get('support') ?? null,
        ...source,
      };
      Object.keys(row).forEach((key) => columns.add(key));
      rows.push(row);
    }
    if (truncatedRows) break;
  }

  const types = [...new Set(snapshot.docs.map((doc) => String(doc.get('type') ?? '')).filter(Boolean))].sort();
  const resolutions = [...new Set(snapshot.docs.map((doc) => String(doc.get('resolution') ?? '')).filter(Boolean))].sort();
  const stores = [...new Map(snapshot.docs
    .filter((doc) => doc.get('storeId'))
    .map((doc) => [String(doc.get('storeId')), {
      storeId: String(doc.get('storeId')),
      storeName: String(doc.get('storeName') ?? ''),
    }])).values()].sort((a, b) => a.storeId.localeCompare(b.storeId));
  const supports = [...new Set(snapshot.docs.map((doc) => String(doc.get('support') ?? '')).filter(Boolean))].sort();

  return {
    startDate, endDate, summary,
    partitions: docs.slice(0, 500).map((doc) => ({
      id: doc.id,
      date: doc.get('date'),
      locationId: doc.get('locationId'),
      type: doc.get('type'),
      resolution: doc.get('resolution'),
      status: doc.get('status'),
      rowCount: doc.get('rowCount') ?? 0,
      storeId: doc.get('storeId') ?? null,
      support: doc.get('support') ?? null,
      mappingStatus: doc.get('mappingStatus') ?? null,
      currentHash: doc.get('currentHash') ?? null,
      updatedAt: doc.get('updatedAt') ?? null,
    })),
    rows,
    columns: [...columns],
    truncatedRows,
    filters: { types, resolutions, stores, supports },
  };
});

/** Manual, dated evidence for old location → store assignments. */
export const historyAssignBinding = onCall({ timeoutSeconds: 540 }, async (request) => {
  if (!request.auth || roleFromClaims(request.auth.token) !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin concilia el histórico.');
  }
  const input = request.data as Partial<StoreBinding>;
  const storeId = input.storeId?.trim() ?? '';
  const pointId = input.pointId?.trim() ?? '';
  if (!Number.isInteger(input.locationId) || !/^LIV-\d{3,}$/.test(storeId) ||
      !input.support?.trim() || (pointId && !/^LIV-/.test(pointId)) || !/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom ?? '') ||
      (input.validTo !== null && input.validTo !== undefined &&
        !/^\d{4}-\d{2}-\d{2}$/.test(input.validTo)) ||
      (input.validTo && input.validFrom && input.validTo < input.validFrom)) {
    throw new HttpsError('invalid-argument', 'Ubicación, tienda, punto o vigencia inválidos.');
  }
  const db = getFirestore();
  const inventory = await db.collection(INVENTORY).doc(String(input.locationId)).get();
  if (inventory.get('networkId') !== LIVERPOOL_NETWORK_ID) {
    throw new HttpsError('failed-precondition', 'Location fuera de la network 3089.');
  }
  const catalog = historyCatalogStores((await db.collection('screens').get()).docs
    .map((doc) => doc.data() as ScreenDoc));
  const support = input.support!.trim();
  if (!validHistoryCatalogSelection(catalog, storeId, support, pointId || null)) {
    throw new HttpsError('failed-precondition', 'Selecciona una tienda y soporte existentes en el catálogo Admira; el punto es opcional y debe corresponder a ambos.');
  }
  const binding: StoreBinding = {
    locationId: input.locationId!, storeId, pointId: pointId || null,
    storeName: catalog.find((store) => store.storeId === storeId)!.name, support,
    validFrom: input.validFrom!, validTo: input.validTo ?? null, source: 'manual',
  };
  await db.runTransaction(async (transaction) => {
    const siblings = await transaction.get(db.collection(BINDINGS).where('locationId', '==', input.locationId));
    let replacement: StoreBinding[];
    try {
      replacement = replaceHistoricalBinding(siblings.docs.map((doc) => doc.data() as StoreBinding), binding);
    } catch (error) {
      throw new HttpsError('failed-precondition', error instanceof Error ? error.message : 'Vigencia inválida.');
    }
    const next = new Map(replacement.map((item) => [`${item.locationId}__${item.validFrom}`, item]));
    for (const doc of siblings.docs) if (!next.has(doc.id)) transaction.delete(doc.ref);
    for (const [id, item] of next) transaction.set(db.collection(BINDINGS).doc(id), item);
  });
  await getFunctions().taskQueue('quividi-historyReconcile').enqueue({
    locationId: input.locationId!,
  } satisfies ReconcileTask);
  return { binding, reconciliationQueued: true };
});

/** Reindex store identity without modifying source RAW or measured numbers. */
export const historyReconcile = onTaskDispatched<ReconcileTask>({
  timeoutSeconds: 540, memory: '512MiB',
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 },
  retryConfig: { maxAttempts: 8, minBackoffSeconds: 60 },
}, async (request) => {
  const { locationId, after } = request.data;
  if (!Number.isInteger(locationId) || locationId < 1) throw new Error('Location inválida.');
  const db = getFirestore();
  const bindings = (await db.collection(BINDINGS).where('locationId', '==', locationId).get())
    .docs.map((doc) => doc.data() as StoreBinding);
  const prefix = `${LIVERPOOL_NETWORK_ID}__${locationId}__`;
  let query = db.collection(PARTITIONS).orderBy(FieldPath.documentId())
    .startAt(prefix).endAt(prefix + '\uf8ff').limit(200);
  if (after) query = query.startAfter(after);
  const page = await query.get();
  const batch = db.batch();
  for (const doc of page.docs) {
    if (doc.get('status') !== 'complete' || doc.get('rowCount') === 0) continue;
    if (exportDataClass(doc.get('type') as string) === 'site_aggregate') continue;
    const binding = resolveHistoricalBinding(bindings, locationId, doc.get('date') as string);
    batch.update(doc.ref, {
      storeId: binding?.storeId ?? null, support: binding?.support ?? null, pointId: binding?.pointId ?? null,
      mappingStatus: mappingStatus(binding), mappingSource: binding?.source ?? null,
    });
  }
  await batch.commit();
  if (page.size === 200) {
    await getFunctions().taskQueue('quividi-historyReconcile').enqueue({
      locationId, after: page.docs[page.size - 1]!.id,
    } satisfies ReconcileTask);
  }
});

/** Reconcile current inventory without rewriting any historical attribution. */
export const historyInventoryDaily = onSchedule({
  schedule: '45 7 * * *', timeZone: 'America/Mexico_City',
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '512MiB',
}, async () => {
  const db = getFirestore();
  if (!(await db.collection(CONTROL).doc('liverpool').get()).exists) return;
  const locations = await api(`/network/${LIVERPOOL_NETWORK_ID}/locations/`) as Location[];
  if (!Array.isArray(locations) || locations.some((item) => !Number.isInteger(item.id))) {
    throw new Error('Inventario Liverpool inválido.');
  }
  const existing = await db.collection(INVENTORY).get();
  const known = new Set(existing.docs.map((doc) => Number(doc.id)));
  const newIds = locations.map((item) => item.id).filter((id) => !known.has(id));
  const screensSnap = await db.collection('screens').get();
  const screens = screensSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ScreenDoc));
  const today = todayMexico();
  const { candidates, conflicts } = inventoryBindings(
    screens, new Set(locations.map((item) => item.id)), today,
  );
  const current = new Map(candidates.map((binding) => [binding.locationId, binding]));
  const activeBindings = await db.collection(BINDINGS).where('validTo', '==', null).get();
  const allBindings = await db.collection(BINDINGS).get();
  const locationsWithHistory = new Set(allBindings.docs.map((doc) => doc.get('locationId') as number));
  const batch = db.batch();
  for (const location of locations) {
    batch.set(db.collection(INVENTORY).doc(String(location.id)), {
      networkId: LIVERPOOL_NETWORK_ID, location, observedAt: Date.now(),
    }, { merge: true });
  }
  for (const doc of activeBindings.docs) {
    const prior = doc.data() as StoreBinding;
    if (prior.source === 'manual') {
      current.delete(prior.locationId); // Human evidence is never overridden by catalog sync.
      continue;
    }
    const next = current.get(prior.locationId);
    if (!next || next.storeId !== prior.storeId || next.support !== prior.support || next.pointId !== prior.pointId) {
      batch.update(doc.ref, { validTo: yesterdayMexico() });
    } else {
      current.delete(prior.locationId);
    }
  }
  for (const candidate of current.values()) {
    const ref = db.collection(BINDINGS).doc(`${candidate.locationId}__${today}`);
    if (!(await ref.get()).exists) batch.create(ref, candidate);
    if (!locationsWithHistory.has(candidate.locationId)) {
      const inferred = inferredCatalogBinding(candidate);
      if (inferred) batch.create(db.collection(BINDINGS)
        .doc(`${candidate.locationId}__${HISTORY_START_DATE}`), inferred);
    }
  }
  await batch.commit();
  for (const candidate of current.values()) {
    await getFunctions().taskQueue('quividi-historyReconcile').enqueue({
      locationId: candidate.locationId,
    } satisfies ReconcileTask);
  }
  if (newIds.length) {
    const sorted = newIds.sort((a, b) => a - b);
    await db.collection(CONTROL).doc(`liverpool-${today}`).create({
      networkId: LIVERPOOL_NETWORK_ID, locationIds: sorted,
      exportPlan: HISTORY_EXPORTS.map((item) => ({ ...item })),
      nextIndex: 0, startDate: HISTORY_START_DATE, status: 'running', mode: 'backfill',
      startedAt: Date.now(),
    });
    await db.collection(CONTROL).doc(`liverpool-consumer-${today}`).create({
      networkId: LIVERPOOL_NETWORK_ID, locationIds: sorted,
      exportPlan: CONSUMER_HISTORY_EXPORTS.map((item) => ({ ...item })),
      nextIndex: 0, rangeStartMonth: HISTORY_START_DATE,
      rangeNextIndex: 0, startDate: HISTORY_START_DATE,
      status: 'running', mode: 'backfill', startedAt: Date.now(), supplementalSeries: true,
    });
  }
  if (conflicts.length) console.warn('Conflictos de tienda/punto en catálogo Quividi.', conflicts);
});

type ExportTask = PartitionTask | RangeTask | HistoryBatchTask;

/** Operational series of daily/recovery/late work use the priority queue; the rest, the archive. */
async function enqueueHistoryTask(task: HistoryBatchTask, id?: string): Promise<void> {
  const operational = isOperationalHistoryExport(task) && (task.source ?? 'backfill') !== 'backfill';
  const queue = getFunctions().taskQueue(
    operational ? 'quividi-historyOperationalPartition' : 'quividi-historyPartition',
  );
  try {
    await queue.enqueue(task, {
      id: id ?? rowsFingerprint([{ task, bucket: Math.floor(Date.now() / 600_000) }]),
      dispatchDeadlineSeconds: 540,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error;
  }
}

/** Both queues use the same idempotent source writer and global export slots. */
async function processHistoryPartition(raw: ExportTask): Promise<void> {
  const task = toBatchTask(raw);
  // Series retiradas (19/10/2026): una tarea encolada antes del recorte termina sin exportar.
  if (!isActiveHistoryExport(task)) return;
  if (task.startDate < HISTORY_START_DATE || task.endDate > yesterdayMexico() ||
      task.startDate > task.endDate) {
    throw new Error('Fecha fuera de la ventana histórica.');
  }
  if (!task.locationIds.length || task.locationIds.some((id) => !Number.isInteger(id) || id < 1)) {
    throw new Error('Ubicaciones inválidas.');
  }
  try {
    await saveBatch(task, (chunk) => enqueueHistoryTask(chunk));
  } catch (error) {
    console.error('Falló export Quividi.', {
      locations: task.locationIds.length, startDate: task.startDate, endDate: task.endDate,
      type: task.type, resolution: task.resolution,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const historyPartition = onTaskDispatched<ExportTask>({
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '1GiB',
  rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 1 },
  retryConfig: { maxAttempts: 8, minBackoffSeconds: 60 },
}, async (request) => processHistoryPartition(request.data));

/** Dedicated queue: historical archive tasks cannot sit ahead of operational repairs. */
export const historyOperationalPartition = onTaskDispatched<ExportTask>({
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '1GiB',
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
  retryConfig: { maxAttempts: 12, minBackoffSeconds: 30 },
}, async (request) => {
  if (!isOperationalHistoryExport(request.data)) throw new Error('Serie operativa no permitida.');
  await processHistoryPartition(request.data);
});

/** Días de respaldo que la carga diaria revisa: solo exporta lo que siga sin dato completo. */
const DAILY_SELF_HEAL_DAYS = 7;

/**
 * Daily D-1 ingestion: one task per series for the whole network. The worker turns it into
 * one export per series (or a few for heavy series) and also picks up any of the previous
 * days that failed, without downloading again what is already complete.
 */
export const historyDaily = onSchedule({
  schedule: '0 6 * * *', timeZone: 'America/Mexico_City',
  timeoutSeconds: 540, memory: '256MiB',
}, async () => {
  const db = getFirestore();
  const inventory = await db.collection(INVENTORY).get();
  const locationIds = inventory.docs.map((doc) => Number(doc.id))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
  if (!locationIds.length) return;

  const targetDate = yesterdayMexico();
  const start = new Date(Date.parse(`${targetDate}T00:00:00Z`) -
    (DAILY_SELF_HEAL_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const startDate = start < HISTORY_START_DATE ? HISTORY_START_DATE : start;
  const plan = [...HISTORY_EXPORTS, ...CONSUMER_HISTORY_EXPORTS];
  const tasks: HistoryBatchTask[] = plan.map((spec) => ({
    locationIds, startDate, endDate: targetDate,
    type: spec.type, resolution: spec.resolution, source: 'daily',
  }));
  tasks.sort((a, b) => Number(isOperationalHistoryExport(b)) - Number(isOperationalHistoryExport(a)));
  for (const task of tasks) {
    await enqueueHistoryTask(task, rowsFingerprint([{
      daily: targetDate, type: task.type, resolution: task.resolution,
    }]));
  }
});

/** Bounded backfill enqueue. Completed controls stop producing historical work. */
export const historyCoordinator = onSchedule({
  schedule: 'every 5 minutes', timeZone: 'America/Mexico_City',
  timeoutSeconds: 540, maxInstances: 1,
}, async () => {
  const db = getFirestore();
  const primary = await db.collection(CONTROL).doc('liverpool').get();
  if (primary.exists) {
    const supplementalRef = db.collection(CONTROL).doc('liverpool-consumer-v1');
    const supplemental = await supplementalRef.get();
    if (!supplemental.exists) {
      const inventory = await db.collection(INVENTORY).get();
      const locationIds = inventory.docs.map((doc) => Number(doc.id))
        .filter((id) => Number.isInteger(id) && id > 0)
        .sort((a, b) => a - b);
      if (locationIds.length) {
        await supplementalRef.create({
          networkId: LIVERPOOL_NETWORK_ID,
          locationIds,
          exportPlan: CONSUMER_HISTORY_EXPORTS.map((item) => ({ ...item })),
          nextIndex: 0,
          rangeStartMonth: HISTORY_START_DATE,
          rangeNextIndex: 0,
          startDate: HISTORY_START_DATE,
          status: 'running',
          mode: 'backfill',
          startedAt: Date.now(),
          supplementalSeries: true,
        });
      }
    }
  }

  const controls = await db.collection(CONTROL).where('status', '==', 'running').get();
  if (controls.empty) return;
  await inferExistingCatalogHistory();
  await indexExistingMeasurements();
  const queue = getFunctions().taskQueue('quividi-historyPartition');

  for (const control of controls.docs) {
    const locationIds = control.get('locationIds') as number[];
    const plan = control.get('exportPlan') as ExportSpec[];
    if (!locationIds.length || !plan.length) {
      await control.ref.update({
        status: 'completed',
        completedAt: Date.now(),
        completedReason: 'empty_plan',
      });
      continue;
    }

    let rangeStartMonth = control.get('rangeStartMonth') as string | undefined;
    let rangeIndex = control.get('rangeNextIndex') as number | undefined;
    if (!rangeStartMonth || rangeIndex === undefined) {
      // Migrate an in-flight daily backfill without restarting from January.
      const legacyIndex = control.get('nextIndex') as number ?? 0;
      const legacyTask = taskAt(legacyIndex, locationIds, plan);
      rangeStartMonth = `${legacyTask.date.slice(0, 7)}-01`;
      rangeIndex = 0;
      await control.ref.update({
        mode: 'backfill',
        rangeStartMonth,
        rangeNextIndex: rangeIndex,
        rangeMigrationAt: Date.now(),
      });
    }

    let nextIndex = rangeIndex;
    let exhausted = false;
    const perControl = Math.max(1, Math.floor(EXPORTS_PER_TICK / controls.size));
    for (let count = 0; count < perControl; count++) {
      const task = historyMonthRangeAt(
        nextIndex,
        rangeStartMonth,
        locationIds,
        plan,
        yesterdayMexico(),
      );
      if (!task) {
        exhausted = true;
        break;
      }
      // The stored plan keeps its order so the cursor stays valid; retired series are skipped.
      if (!isActiveHistoryExport(task)) {
        nextIndex++;
        continue;
      }
      const rangeId = [
        LIVERPOOL_NETWORK_ID, task.locationId, task.startDate, task.endDate,
        task.type, task.resolution,
      ].join('__');
      try {
        await queue.enqueue(task, {
          id: rowsFingerprint([{ id: rangeId }]),
          dispatchDeadlineSeconds: 540,
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error;
      }
      nextIndex++;
    }

    if (exhausted) {
      await control.ref.update({
        mode: 'backfill',
        status: 'completed',
        rangeNextIndex: nextIndex,
        completedAt: Date.now(),
        completedThrough: yesterdayMexico(),
      });
    } else if (nextIndex !== rangeIndex) {
      await control.ref.update({
        mode: 'backfill',
        rangeNextIndex: nextIndex,
        lastEnqueuedAt: Date.now(),
      });
    }
  }
});

/**
 * Datos atrasados: una cámara que estuvo sin internet sube después lo que midió. Los días
 * guardados mientras no reportaba quedan provisionales y se vuelven a pedir solo cuando su
 * `last_seen` avanza (volvió). Una tienda que sigue sin señal no genera exports.
 */
export const historyLateDataRecheck = onSchedule({
  schedule: '50 7,14 * * *', timeZone: 'America/Mexico_City',
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '512MiB',
}, async () => {
  const db = getFirestore();
  const locations = await api(`/network/${LIVERPOOL_NETWORK_ID}/locations/`) as Location[];
  if (!Array.isArray(locations)) throw new Error('Inventario Liverpool inválido.');
  const lastSeen = new Map(locations.map((location) =>
    [location.id, typeof location.last_seen === 'string' ? location.last_seen : null]));
  const snapshot = await db.collection(PARTITIONS)
    .where('provisional', '==', true).limit(10_000).get();
  const partitions: ProvisionalPartition[] = snapshot.docs
    .filter((doc) => isActiveHistoryExport({
      type: doc.get('type') as string, resolution: doc.get('resolution') as string,
    }))
    .map((doc) => ({
      id: doc.id,
      locationId: doc.get('locationId') as number,
      date: doc.get('date') as string,
      type: doc.get('type') as string,
      resolution: doc.get('resolution') as string,
      provisionalLastSeen: (doc.get('provisionalLastSeen') as string | null) ?? null,
      provisionalCheckedAt: doc.get('provisionalCheckedAt') as number | undefined,
    }));
  const { tasks, expiredIds } = planLateDataRechecks(partitions, lastSeen, Date.now());
  for (let offset = 0; offset < expiredIds.length; offset += 400) {
    const batch = db.batch();
    for (const id of expiredIds.slice(offset, offset + 400)) {
      batch.update(db.collection(PARTITIONS).doc(id), {
        provisional: false, provisionalExpiredAt: Date.now(),
      });
    }
    await batch.commit();
  }
  for (const task of tasks) await enqueueHistoryTask(task);
  console.info('Relectura de datos atrasados Quividi.', {
    provisional: partitions.length, tasks: tasks.length, expired: expiredIds.length,
  });
});
