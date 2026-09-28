import { Buffer } from 'node:buffer';
import { gzipSync } from 'node:zlib';
import { getFunctions } from 'firebase-admin/functions';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { roleFromClaims } from './access';
import type { ScreenDoc } from './effectiveScope';
import { buildBackendMeasurementPointId } from './measurementPoint';
import {
  HISTORY_EXPORTS,
  HISTORY_START_DATE,
  LIVERPOOL_NETWORK_ID,
  exportDataClass,
  historyPartitionId,
  inferredCatalogBinding,
  inventoryBindings,
  rawHistoryPath,
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
const RECENT_PER_TICK = 30;

interface Location {
  id: number;
  active?: boolean;
  site_id?: number | null;
  box_id?: number | null;
  creation_date?: string;
  [key: string]: unknown;
}

interface PartitionTask {
  date: string;
  locationId: number;
  type: string;
  resolution: string;
  siteId?: number;
}
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

function mappingStatus(binding: StoreBinding | null): 'mapped' | 'inferred' | 'needs_review' {
  if (!binding) return 'needs_review';
  return binding.source === 'catalog_inferred' ? 'inferred' : 'mapped';
}

/** Upgrade an already running backfill once, including partitions saved before this change. */
async function inferExistingCatalogHistory(): Promise<void> {
  const db = getFirestore();
  const control = db.collection(CONTROL).doc('liverpool');
  const snapshot = await control.get();
  if (!snapshot.exists || snapshot.get('catalogInferenceVersion') === 1) return;
  const existing = await db.collection(BINDINGS).get();
  const groups = new Map<number, StoreBinding[]>();
  for (const doc of existing.docs) {
    const binding = doc.data() as StoreBinding;
    groups.set(binding.locationId, [...(groups.get(binding.locationId) ?? []), binding]);
  }
  const inferredLocations: number[] = [];
  const batch = db.batch();
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
  await control.update({ catalogInferenceVersion: 1, catalogInferenceAt: Date.now() });
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

async function fetchExport(task: PartitionTask): Promise<{
  state: string;
  data?: Record<string, unknown>[];
  [key: string]: unknown;
}> {
  const params = new URLSearchParams({
    [task.siteId ? 'sites' : 'locations']: String(task.siteId ?? task.locationId),
    start: `${task.date}T00:00:00`,
    end: `${task.date}T23:59:59`,
    data_type: task.type,
    time_resolution: task.resolution,
  });
  if (task.type.startsWith('extrapolated_')) {
    // Empty amount requests Quividi's sample average; it remains labelled derived.
    params.set('extrapolation_amount', '');
  }
  // Quividi caches exports; the same request is polled until finished.
  const path = '/data/?' + params.toString();
  for (let attempt = 0; attempt < 35; attempt++) {
    const response = await fetch(BASE + path, {
      headers: { Authorization: auth(), Accept: 'application/json' },
    });
    if (response.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 4_000 + attempt * 300));
      continue;
    }
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      return { state: 'unsupported', httpStatus: response.status };
    }
    if (!response.ok) throw new Error(`Quividi export HTTP ${response.status}.`);
    const payload = await response.json() as {
      state: string;
      data?: Record<string, unknown>[];
      fail_reason?: string;
    };
    if (payload.state === 'finished') {
      if (!Array.isArray(payload.data)) throw new Error('Export terminado sin arreglo data.');
      return payload;
    }
    if (payload.state === 'failed') {
      return { state: 'unsupported', failReason: payload.fail_reason ?? 'failed' };
    }
    if (payload.state !== 'started' && payload.state !== 'in_progress') {
      throw new Error(`Estado Quividi inesperado: ${payload.state}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000 + attempt * 300));
  }
  throw new Error('Export Quividi aún no finaliza; Cloud Tasks reintentará.');
}

async function saveRaw(path: string, payload: unknown): Promise<void> {
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

async function savePartition(task: PartitionTask): Promise<void> {
  const db = getFirestore();
  const inventory = await db.collection(INVENTORY).doc(String(task.locationId)).get();
  if (!inventory.exists || inventory.get('networkId') !== LIVERPOOL_NETWORK_ID) {
    throw new Error('Location no pertenece al inventario Liverpool 3089.');
  }
  const dataClass = exportDataClass(task.type);
  if (dataClass === 'site_aggregate') {
    const siteId = (inventory.get('location') as Location).site_id;
    if (!siteId) throw new Error('Export de sitio sin Site ID en topología.');
    const sites = await db.collection(INVENTORY).get();
    const firstLocation = Math.min(...sites.docs
      .filter((doc) => (doc.get('location') as Location).site_id === siteId)
      .map((doc) => Number(doc.id)));
    if (task.locationId !== firstLocation) return; // One raw site export, not N copies.
    task = { ...task, siteId };
  }
  const id = historyPartitionId(task.locationId, task.date, task.type, task.resolution);
  const ref = db.collection(PARTITIONS).doc(id);
  const payload = await fetchExport(task);
  if (payload.state === 'unsupported') {
    const existing = await ref.get();
    if (existing.get('status') === 'complete') {
      await ref.update({ lastAvailabilityError: payload.failReason ??
        `HTTP ${payload.httpStatus}`, checkedAt: Date.now() });
      return;
    }
    await ref.set({ ...task, networkId: LIVERPOOL_NETWORK_ID,
      status: 'unsupported', reason: payload.failReason ?? `HTTP ${payload.httpStatus}`,
      checkedAt: Date.now() }, { merge: true });
    return;
  }
  const rows = payload.data!;
  // A changed response creates a new immutable object; an unchanged recheck is a no-op.
  const hash = rowsFingerprint(rows);
  const previous = await ref.get();
  if (previous.get('currentHash') === hash) return;
  const path = rawHistoryPath(id, hash);
  await saveRaw(path, payload);
  const bindingsSnap = await db.collection(BINDINGS).where('locationId', '==', task.locationId).get();
  const bindings = bindingsSnap.docs.map((doc) => doc.data() as StoreBinding);
  const binding = dataClass === 'site_aggregate' ? null :
    resolveHistoricalBinding(bindings, task.locationId, task.date);
  const bytes = Buffer.byteLength(JSON.stringify(rows));
  await ref.set({
    ...task,
    networkId: LIVERPOOL_NETWORK_ID,
    storeId: binding?.storeId ?? null,
    pointId: binding?.pointId ?? null,
    mappingStatus: dataClass === 'site_aggregate' ? 'not_applicable' :
      mappingStatus(binding),
    mappingSource: binding?.source ?? null,
    status: 'complete',
    dataClass,
    currentHash: hash,
    rawPath: path,
    rowCount: rows.length,
    // Hourly data is directly queryable. Finest event streams stay in Storage.
    rows: task.resolution !== 'finest' && bytes < 700_000
      ? rows : FieldValue.delete(),
    updatedAt: Date.now(),
  }, { merge: true });
  await ref.collection('revisions').doc(hash).set({
    hash, rawPath: path, rowCount: rows.length, capturedAt: Date.now(),
    sourceCreationDate: payload.creation_date ?? null,
  });
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
    });
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
    startDate: HISTORY_START_DATE, status: 'running', startedAt: Date.now(),
    catalogInferenceVersion: 1,
  });
  return { networkId: LIVERPOOL_NETWORK_ID, locations: ids.length,
    catalogBindings: candidates.length, conflicts, startDate: HISTORY_START_DATE };
});

export const historyOverview = onCall(async (request) => {
  if (!request.auth || roleFromClaims(request.auth.token) !== 'admin') {
    throw new HttpsError('permission-denied', 'Solo admin consulta el histórico.');
  }
  const db = getFirestore();
  const [controls, inventory, bindings, completed, inferred, pending, unsupported, retrying] =
    await Promise.all([
      db.collection(CONTROL).get(),
      db.collection(INVENTORY).get(),
      db.collection(BINDINGS).where('validTo', '==', null).get(),
      db.collection(PARTITIONS).where('status', '==', 'complete').count().get(),
      db.collection(PARTITIONS).where('mappingStatus', '==', 'inferred').count().get(),
      db.collection(PARTITIONS).where('mappingStatus', '==', 'needs_review').count().get(),
      db.collection(PARTITIONS).where('status', '==', 'unsupported').count().get(),
      db.collection(PARTITIONS).where('status', '==', 'retrying').count().get(),
    ]);
  const activeByLocation = new Map(bindings.docs.map((doc) => {
    const binding = doc.data() as StoreBinding;
    return [binding.locationId, binding] as const;
  }));
  return {
    networkId: LIVERPOOL_NETWORK_ID,
    started: controls.docs.some((doc) => doc.id === 'liverpool'),
    queued: controls.docs.reduce((sum, doc) => sum + (doc.get('nextIndex') as number ?? 0), 0),
    completed: completed.data().count,
    inferred: inferred.data().count,
    needsReview: pending.data().count,
    unsupported: unsupported.data().count,
    retrying: retrying.data().count,
    locations: inventory.docs.map((doc) => {
      const location = doc.get('location') as Location;
      const binding = activeByLocation.get(location.id);
      return { id: location.id, label: String(location.label ?? location.name ?? location.id),
        active: location.active !== false, storeId: binding?.storeId ?? null,
        storeName: binding?.storeName ?? '', support: binding?.support ?? '',
        pointId: binding?.pointId ?? null, validFrom: binding?.validFrom ?? null };
    }).sort((a, b) => a.label.localeCompare(b.label, 'es')),
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
  const pointCode = pointId.split('-').at(-1) ?? '';
  const expectedPointId = buildBackendMeasurementPointId({
    storeNumber: storeId.replace(/^LIV-/, ''),
    support: input.support ?? '', pointCode,
  });
  if (!Number.isInteger(input.locationId) || !/^LIV-\d{3,}$/.test(storeId) ||
      expectedPointId !== pointId || !/^\d{4}-\d{2}-\d{2}$/.test(input.validFrom ?? '') ||
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
  const ref = db.collection(BINDINGS).doc(`${input.locationId}__${input.validFrom}`);
  const binding: StoreBinding = {
    locationId: input.locationId!, storeId, pointId,
    storeName: input.storeName?.trim() ?? '', support: input.support?.trim() ?? '',
    validFrom: input.validFrom!, validTo: input.validTo ?? null, source: 'manual',
  };
  const siblings = await db.collection(BINDINGS).where('locationId', '==', input.locationId).get();
  for (const doc of siblings.docs) {
    const other = doc.data() as StoreBinding;
    if (other.source === 'catalog_inferred') continue;
    if (doc.id === ref.id ||
        (binding.validTo !== null && binding.validTo < other.validFrom) ||
        (other.validTo !== null && other.validTo < binding.validFrom)) continue;
    throw new HttpsError('failed-precondition', 'La vigencia se superpone con otro vínculo de tienda.');
  }
  const batch = db.batch();
  for (const doc of siblings.docs) {
    if (doc.get('source') === 'catalog_inferred' && doc.id !== ref.id) batch.delete(doc.ref);
  }
  batch.set(ref, binding);
  await batch.commit();
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
    if (doc.get('status') !== 'complete') continue;
    if (exportDataClass(doc.get('type') as string) === 'site_aggregate') continue;
    const binding = resolveHistoricalBinding(bindings, locationId, doc.get('date') as string);
    batch.update(doc.ref, {
      storeId: binding?.storeId ?? null, pointId: binding?.pointId ?? null,
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
    });
  }
  for (const doc of activeBindings.docs) {
    const prior = doc.data() as StoreBinding;
    if (prior.source === 'manual') {
      current.delete(prior.locationId); // Human evidence is never overridden by catalog sync.
      continue;
    }
    if (current.get(prior.locationId)?.pointId !== prior.pointId) {
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
  if (newIds.length) {
    await db.collection(CONTROL).doc(`liverpool-${today}`).create({
      networkId: LIVERPOOL_NETWORK_ID, locationIds: newIds.sort((a, b) => a - b),
      exportPlan: HISTORY_EXPORTS.map((item) => ({ ...item })),
      nextIndex: 0, startDate: HISTORY_START_DATE, status: 'running', startedAt: Date.now(),
    });
  }
  if (conflicts.length) console.warn('Conflictos de tienda/punto en catálogo Quividi.', conflicts);
});

/** Tasks retry transient failures without advancing or multiplying rows. */
export const historyPartition = onTaskDispatched<PartitionTask>({
  secrets: [USERNAME, TOKEN], timeoutSeconds: 540, memory: '1GiB',
  rateLimits: { maxConcurrentDispatches: 2, maxDispatchesPerSecond: 1 },
  retryConfig: { maxAttempts: 8, minBackoffSeconds: 60 },
}, async (request) => {
  const task = request.data;
  if (!HISTORY_EXPORTS.some((item) => item.type === task.type &&
      item.resolution === task.resolution)) throw new Error('Export no permitido.');
  historyPartitionId(task.locationId, task.date, task.type, task.resolution);
  if (task.date < HISTORY_START_DATE || task.date > yesterdayMexico()) {
    throw new Error('Fecha fuera de la ventana histórica.');
  }
  try {
    await savePartition(task);
  } catch (error) {
    await getFirestore().collection(PARTITIONS)
      .doc(historyPartitionId(task.locationId, task.date, task.type, task.resolution))
      .set({ ...task, networkId: LIVERPOOL_NETWORK_ID, status: 'retrying',
        lastError: error instanceof Error ? error.message : String(error),
        lastAttemptAt: Date.now() }, { merge: true });
    throw error;
  }
});

/** Bounded enqueue: a large backfill spans many ticks without a long function. */
export const historyCoordinator = onSchedule({
  schedule: 'every 5 minutes', timeZone: 'America/Mexico_City',
  timeoutSeconds: 540, maxInstances: 1,
}, async () => {
  const db = getFirestore();
  const controls = await db.collection(CONTROL).where('status', '==', 'running').get();
  if (controls.empty) return;
  await inferExistingCatalogHistory();
  const queue = getFunctions().taskQueue('quividi-historyPartition');
  const primary = await db.collection(CONTROL).doc('liverpool').get();
  if (primary.exists) {
    const plan = primary.get('exportPlan') as ExportSpec[];
    const allIds = [...new Set(controls.docs.flatMap((doc) =>
      doc.get('locationIds') as number[]))].sort((a, b) => a - b);
    const refreshDay = todayMexico();
    let refreshIndex = primary.get('refreshDay') === refreshDay
      ? (primary.get('refreshIndex') as number ?? 0) : 0;
    const totalRecent = 7 * allIds.length * plan.length;
    const recentStart = new Date(`${yesterdayMexico()}T00:00:00Z`);
    recentStart.setUTCDate(recentStart.getUTCDate() - 6);
    for (let count = 0; count < RECENT_PER_TICK && refreshIndex < totalRecent; count++) {
      const offset = taskAt(refreshIndex, allIds, plan);
      const dayIndex = Math.floor(refreshIndex /
        (allIds.length * plan.length));
      const date = new Date(recentStart.getTime() +
        dayIndex * 86_400_000);
      const task = { ...offset, date: date.toISOString().slice(0, 10) };
      const id = historyPartitionId(task.locationId, task.date, task.type, task.resolution);
      try {
        await queue.enqueue(task, {
          id: rowsFingerprint([{ id, refreshDay }]), dispatchDeadlineSeconds: 540,
        });
      } catch (error) {
        if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error;
      }
      refreshIndex++;
      await primary.ref.update({ refreshDay, refreshIndex });
    }
  }
  for (const control of controls.docs) {
    const locationIds = control.get('locationIds') as number[];
    const plan = control.get('exportPlan') as ExportSpec[];
    if (!locationIds.length) continue;
    let index = control.get('nextIndex') as number;
    for (let count = 0; count < Math.max(1, Math.floor(EXPORTS_PER_TICK / controls.size)); count++) {
      const task = taskAt(index, locationIds, plan);
      if (task.date > yesterdayMexico()) break;
      const id = historyPartitionId(task.locationId, task.date, task.type, task.resolution);
      try {
        await queue.enqueue(task, { id: rowsFingerprint([{ id }]), dispatchDeadlineSeconds: 540 });
      } catch (error) {
        if ((error as { code?: string }).code !== 'functions/task-already-exists') throw error;
      }
      index++;
      await control.ref.update({ nextIndex: index, lastEnqueuedAt: Date.now() });
    }
  }
});
