import { Buffer } from 'node:buffer';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  HttpsError,
  onCall,
  type CallableRequest,
} from 'firebase-functions/v2/https';
import {
  buildEffectiveSupportPairs,
  type CampaignDoc,
  type EffectiveScopeOrigin,
  type EffectiveSupportPair,
  type EkonAssignmentDoc,
  type ScreenDoc,
} from './effectiveScope';
import {
  canForceRefreshQuividi,
  canReportQuividi,
  roleFromClaims,
} from './access';
import { buildSupportHours, type SupportHour } from './hourly';
import {
  CAMERA_HEALTH_LOOKBACK_DAYS,
  CAMERA_HEALTH_MAX_BACKFILL_DAYS,
  buildCameraHealthRecords,
  cameraHealthDocumentId,
  lookbackStartDate,
  prepareCameraHealthScope,
  type CameraHealthRecord,
  type CameraHealthMappingSummary,
} from './cameraHealth';
import {
  CAMERA_HEALTH_ALERT_SCHEMA_VERSION,
  buildCurrentCameraHealthEvaluations,
  cameraHealthAlertId,
  daysInclusive,
  previousCivilDate,
  type CameraHealthAlertDoc,
  type CameraHealthAlertStateDoc,
  type CameraHealthEvaluation,
} from './cameraAlerts';
import {
  buildCoverage,
  buildMeasurementRows,
  dayList,
  inputSignature,
  lastCompleteUtcDate,
  measurableEndDate,
  parseCivilDate,
  resolvePairs,
  snapshotIsFresh,
  type CameraDay,
  type DemographicRow,
  type Incident,
  type OtsExportRow,
  type ReportCoverage,
  type SupportDay,
  type TopologyLocation,
  type ViewerExportRow,
} from './measurement';

const QUIVIDI_API_USERNAME = defineSecret('QUIVIDI_API_USERNAME');
const QUIVIDI_API_TOKEN = defineSecret('QUIVIDI_API_TOKEN');
const QUIVIDI_BASE_URL = 'https://vidicenter.quividi.com/api/v1';
const SNAPSHOT_COLLECTION = 'campaignAudienceSnapshots';
const CAMERA_HEALTH_COLLECTION = 'quividiCameraHealthDaily';
const CAMERA_HEALTH_ALERT_COLLECTION = 'quividiCameraHealthAlerts';
const CAMERA_HEALTH_ALERT_STATE_COLLECTION = 'quividiCameraHealthAlertState';
const SNAPSHOT_SCHEMA_VERSION = 3;

interface CampaignReport {
  schemaVersion: 3;
  campaignId: string;
  campaignName: string;
  startDate: string;
  endDate: string;
  generatedAt: number;
  scopeOrigins: EffectiveScopeOrigin[];
  coverage: ReportCoverage;
  cameraDays: CameraDay[];
  supportDays: SupportDay[];
  supportHours: SupportHour[];
  demographics: DemographicRow[];
  incidents: Incident[];
  unmappedCameraNames: string[];
}

function authHeader(): string {
  const username = QUIVIDI_API_USERNAME.value();
  const token = QUIVIDI_API_TOKEN.value();
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function quividiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${QUIVIDI_BASE_URL}${path}`, {
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    throw new HttpsError(
      'unavailable',
      `Quividi respondió HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

async function exportData(
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams(params);
  const path = `/data/?${query.toString()}`;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const response = await fetch(`${QUIVIDI_BASE_URL}${path}`, {
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
      },
    });
    if (response.status === 429) {
      await sleep(Math.min(10_000, 2_000 + attempt * 500));
      continue;
    }
    if (!response.ok) {
      throw new HttpsError(
        'unavailable',
        `No se pudo obtener el export Quividi (HTTP ${response.status}).`,
      );
    }
    const payload = (await response.json()) as {
      state?: string;
      data?: Record<string, unknown>[];
      message?: string;
    };
    if (payload.state === 'finished') return payload.data ?? [];
    if (payload.state === 'failed') {
      throw new HttpsError(
        'unavailable',
        payload.message ?? 'Quividi no pudo generar el export.',
      );
    }
    if (payload.state !== 'started' && payload.state !== 'in_progress') {
      throw new HttpsError(
        'data-loss',
        'Quividi devolvió un estado de export desconocido.',
      );
    }
    await sleep(Math.min(8_000, 1_000 + attempt * 750));
  }
  throw new HttpsError(
    'deadline-exceeded',
    'El export Quividi tardó demasiado en completarse.',
  );
}

function decodeSnapshot(value: unknown): CampaignReport | null {
  try {
    if (!(value instanceof Buffer) && !(value instanceof Uint8Array)) return null;
    const json = gunzipSync(Buffer.from(value)).toString('utf8');
    return JSON.parse(json) as CampaignReport;
  } catch {
    return null;
  }
}

async function generateReport(
  campaignId: string,
  campaign: CampaignDoc,
  pairsWithoutLocations: EffectiveSupportPair[],
  scopeOrigins: EffectiveScopeOrigin[],
  startDate: string,
  endDate: string,
  now: number,
): Promise<CampaignReport> {
  const topology = await quividiGet<TopologyLocation[]>('/locations/');
  const resolved = resolvePairs(pairsWithoutLocations, topology);
  const mappedLocations = Array.from(
    new Set(
      resolved.pairs.flatMap((pair) => pair.cameras.map((camera) => camera.id)),
    ),
  );
  const measuredEndDate = measurableEndDate(startDate, endDate, now);
  const dates = measuredEndDate ? dayList(startDate, measuredEndDate) : [];

  let otsRows: OtsExportRow[] = [];
  let viewerRows: ViewerExportRow[] = [];
  let hourlyOtsRows: OtsExportRow[] = [];
  let hourlyViewerRows: ViewerExportRow[] = [];
  if (mappedLocations.length > 0 && measuredEndDate) {
    const base = {
      locations: mappedLocations.join(','),
      start: `${startDate}T00:00:00`,
      end: `${measuredEndDate}T23:59:59`,
    };
    otsRows = (await exportData({
      ...base,
      time_resolution: '1d',
      data_type: 'ots',
    })) as OtsExportRow[];
    viewerRows = (await exportData({
      ...base,
      time_resolution: '1d',
      data_type: 'viewers',
      group_by_demographics: '1',
    })) as ViewerExportRow[];

    hourlyOtsRows = (await exportData({
      ...base,
      time_resolution: '1h',
      data_type: 'ots',
    })) as OtsExportRow[];
    hourlyViewerRows = (await exportData({
      ...base,
      time_resolution: '1h',
      data_type: 'viewers',
    })) as ViewerExportRow[];
  }

  const measurement = buildMeasurementRows(
    resolved.pairs,
    dates,
    otsRows,
    viewerRows,
  );
  const supportHours = buildSupportHours(
    resolved.pairs,
    hourlyOtsRows,
    hourlyViewerRows,
  );
  return {
    schemaVersion: 3,
    campaignId,
    campaignName: campaign.name ?? '',
    startDate,
    endDate,
    generatedAt: Date.now(),
    scopeOrigins,
    coverage: buildCoverage(resolved.pairs),
    ...measurement,
    supportHours,
    unmappedCameraNames: resolved.unmappedCameraNames,
  };
}

interface CameraHealthComputation {
  startDate: string;
  endDate: string;
  records: CameraHealthRecord[];
  mapping: CameraHealthMappingSummary;
}

async function computeCameraHealth(
  days: number,
  now: number,
): Promise<CameraHealthComputation> {
  const db = getFirestore();
  const screensSnap = await db.collection('screens').get();
  const screens = screensSnap.docs.map((doc) => doc.data() as ScreenDoc);
  const topology = await quividiGet<TopologyLocation[]>('/locations/');
  const scope = prepareCameraHealthScope(screens, topology);
  const endDate = lastCompleteUtcDate(now);
  const startDate = lookbackStartDate(endDate, days);
  const dates = dayList(startDate, endDate);

  let otsRows: OtsExportRow[] = [];
  let viewerRows: ViewerExportRow[] = [];
  let hourlyOtsRows: OtsExportRow[] = [];
  if (scope.mappedLocationIds.length > 0) {
    const base = {
      locations: scope.mappedLocationIds.join(','),
      start: `${startDate}T00:00:00`,
      end: `${endDate}T23:59:59`,
    };
    otsRows = (await exportData({
      ...base,
      time_resolution: '1d',
      data_type: 'ots',
    })) as OtsExportRow[];
    viewerRows = (await exportData({
      ...base,
      time_resolution: '1d',
      data_type: 'viewers',
    })) as ViewerExportRow[];
    hourlyOtsRows = (await exportData({
      ...base,
      time_resolution: '1h',
      data_type: 'ots',
    })) as OtsExportRow[];
  }

  return {
    startDate,
    endDate,
    records: buildCameraHealthRecords(
      scope,
      dates,
      otsRows,
      viewerRows,
      hourlyOtsRows,
      now,
    ),
    mapping: scope.mapping,
  };
}

async function persistCameraHealth(
  records: readonly CameraHealthRecord[],
): Promise<number> {
  const db = getFirestore();
  const batchSize = 400;

  for (let offset = 0; offset < records.length; offset += batchSize) {
    const batch = db.batch();
    for (const record of records.slice(offset, offset + batchSize)) {
      batch.set(
        db
          .collection(CAMERA_HEALTH_COLLECTION)
          .doc(cameraHealthDocumentId(record.date, record.locationId)),
        record,
      );
    }
    await batch.commit();
  }

  return records.length;
}


interface CameraHealthAlertReconcileSummary {
  evaluated: number;
  normal: number;
  active: number;
  created: number;
  updated: number;
  recovered: number;
}

function cameraHealthStateDoc(
  evaluation: CameraHealthEvaluation,
  activeAlertId: string | null,
  startedDate: string | null,
  now: number,
): CameraHealthAlertStateDoc {
  const record = evaluation.latestRecord;
  return {
    schemaVersion: CAMERA_HEALTH_ALERT_SCHEMA_VERSION as 1,
    source: 'quividi',
    locationId: record.locationId,
    locationName: record.locationName,
    storeNumber: record.storeNumber,
    storeName: record.storeName,
    support: record.support,
    currentStatus: evaluation.currentStatus,
    severity: evaluation.severity,
    latestDate: evaluation.latestDate,
    activeAlertId,
    startedDate,
    expectedCoreHours: record.expectedCoreHours,
    coreMeasuredHours: record.coreMeasuredHours,
    coreOtsHours: record.coreOtsHours,
    coreOts: record.coreOts,
    firstMeasuredHour: record.firstMeasuredHour,
    lastMeasuredHour: record.lastMeasuredHour,
    firstOtsHour: record.firstOtsHour,
    lastOtsHour: record.lastOtsHour,
    lastEvaluatedAt: now,
  };
}

function continuesExistingCameraAlert(
  previous: Partial<CameraHealthAlertStateDoc> | undefined,
  evaluation: CameraHealthEvaluation,
): boolean {
  if (
    !previous?.activeAlertId ||
    !previous.startedDate ||
    evaluation.currentStatus === 'normal' ||
    !evaluation.incidentStartDate
  ) {
    return false;
  }
  if (previous.startedDate === evaluation.incidentStartDate) return true;

  // Si los 28 días visibles siguen anómalos, una alerta activa evaluada
  // recientemente puede haber empezado antes de la ventana disponible.
  return (
    evaluation.incidentStartDate === evaluation.historyStartDate &&
    typeof previous.latestDate === 'string' &&
    previous.latestDate >= previousCivilDate(evaluation.historyStartDate)
  );
}

async function reconcileCameraHealthAlerts(
  records: readonly CameraHealthRecord[],
  latestDate: string,
  now: number,
): Promise<CameraHealthAlertReconcileSummary> {
  const db = getFirestore();
  const evaluations = buildCurrentCameraHealthEvaluations(records, latestDate);
  const summary: CameraHealthAlertReconcileSummary = {
    evaluated: evaluations.length,
    normal: 0,
    active: 0,
    created: 0,
    updated: 0,
    recovered: 0,
  };
  if (evaluations.length === 0) return summary;

  const stateRefs = evaluations.map((evaluation) =>
    db
      .collection(CAMERA_HEALTH_ALERT_STATE_COLLECTION)
      .doc(String(evaluation.locationId)),
  );
  const stateSnaps = await db.getAll(...stateRefs);
  const previousStates = new Map<
    number,
    Partial<CameraHealthAlertStateDoc> | undefined
  >();
  for (let index = 0; index < evaluations.length; index += 1) {
    previousStates.set(
      evaluations[index]!.locationId,
      stateSnaps[index]?.data() as Partial<CameraHealthAlertStateDoc> | undefined,
    );
  }

  const candidateAlertIds = new Set<string>();
  for (const evaluation of evaluations) {
    const previous = previousStates.get(evaluation.locationId);
    if (typeof previous?.activeAlertId === 'string') {
      candidateAlertIds.add(previous.activeAlertId);
    }
    if (evaluation.incidentStartDate) {
      candidateAlertIds.add(
        cameraHealthAlertId(
          evaluation.locationId,
          evaluation.incidentStartDate,
        ),
      );
    }
  }
  const alertRefs = Array.from(candidateAlertIds, (id) =>
    db.collection(CAMERA_HEALTH_ALERT_COLLECTION).doc(id),
  );
  const alertSnaps =
    alertRefs.length > 0 ? await db.getAll(...alertRefs) : [];
  const existingAlerts = new Map<
    string,
    Partial<CameraHealthAlertDoc> | undefined
  >();
  for (let index = 0; index < alertRefs.length; index += 1) {
    existingAlerts.set(
      alertRefs[index]!.id,
      alertSnaps[index]?.data() as Partial<CameraHealthAlertDoc> | undefined,
    );
  }

  let batch = db.batch();
  let pendingWrites = 0;
  const flush = async (): Promise<void> => {
    if (pendingWrites === 0) return;
    await batch.commit();
    batch = db.batch();
    pendingWrites = 0;
  };
  const setDoc = (
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.DocumentData,
  ): void => {
    batch.set(ref, data, { merge: true });
    pendingWrites += 1;
  };

  for (const evaluation of evaluations) {
    const previous = previousStates.get(evaluation.locationId);
    const stateRef = db
      .collection(CAMERA_HEALTH_ALERT_STATE_COLLECTION)
      .doc(String(evaluation.locationId));

    if (evaluation.currentStatus === 'normal') {
      summary.normal += 1;
      if (typeof previous?.activeAlertId === 'string') {
        setDoc(
          db
            .collection(CAMERA_HEALTH_ALERT_COLLECTION)
            .doc(previous.activeAlertId),
          {
            state: 'recovered',
            recoveredDate: latestDate,
            latestDate,
            updatedAt: now,
          },
        );
        summary.recovered += 1;
      }
      setDoc(stateRef, cameraHealthStateDoc(evaluation, null, null, now));
      if (pendingWrites >= 350) await flush();
      continue;
    }

    summary.active += 1;
    const currentStart = evaluation.incidentStartDate!;
    const continues = continuesExistingCameraAlert(previous, evaluation);
    let alertId: string;
    let startedDate: string;

    if (continues) {
      alertId = previous!.activeAlertId!;
      startedDate = previous!.startedDate!;
      summary.updated += 1;
    } else {
      if (typeof previous?.activeAlertId === 'string') {
        setDoc(
          db
            .collection(CAMERA_HEALTH_ALERT_COLLECTION)
            .doc(previous.activeAlertId),
          {
            state: 'recovered',
            recoveredDate: previousCivilDate(currentStart),
            latestDate: previousCivilDate(currentStart),
            updatedAt: now,
          },
        );
        summary.recovered += 1;
      }
      startedDate = currentStart;
      alertId = cameraHealthAlertId(evaluation.locationId, startedDate);
      summary.created += 1;
    }

    const record = evaluation.latestRecord;
    const existing = existingAlerts.get(alertId);
    const currentType = evaluation.currentStatus;
    const alert: CameraHealthAlertDoc = {
      schemaVersion: CAMERA_HEALTH_ALERT_SCHEMA_VERSION as 1,
      source: 'quividi',
      alertId,
      locationId: record.locationId,
      locationName: record.locationName,
      storeNumber: record.storeNumber,
      storeName: record.storeName,
      support: record.support,
      state: 'active',
      initialType:
        existing?.initialType ??
        (currentType as Exclude<typeof currentType, 'normal'>),
      currentType,
      severity: evaluation.severity as Exclude<
        typeof evaluation.severity,
        'none'
      >,
      startedDate,
      lastAnomalousDate: latestDate,
      recoveredDate: null,
      consecutiveDays: continues
        ? daysInclusive(startedDate, latestDate)
        : evaluation.consecutiveDays,
      latestDate,
      expectedCoreHours: record.expectedCoreHours,
      coreMeasuredHours: record.coreMeasuredHours,
      coreOtsHours: record.coreOtsHours,
      coreOts: record.coreOts,
      firstMeasuredHour: record.firstMeasuredHour,
      lastMeasuredHour: record.lastMeasuredHour,
      firstOtsHour: record.firstOtsHour,
      lastOtsHour: record.lastOtsHour,
      createdAt:
        typeof existing?.createdAt === 'number' ? existing.createdAt : now,
      updatedAt: now,
    };

    setDoc(
      db.collection(CAMERA_HEALTH_ALERT_COLLECTION).doc(alertId),
      alert,
    );
    setDoc(
      stateRef,
      cameraHealthStateDoc(evaluation, alertId, startedDate, now),
    );
    if (pendingWrites >= 350) await flush();
  }

  await flush();
  return summary;
}

type CallableAuth = NonNullable<CallableRequest['auth']>;

/**
 * Exige sesión y la capacidad `quividi.report`, y devuelve la identidad.
 *
 * Las reglas de Firestore no aplican a las callables: sin esta comprobación
 * cualquier usuario autenticado podría disparar llamadas a la API de pago de
 * Quividi. El reparto por rol vive en `access.ts`, espejo de la matriz del
 * cliente.
 */
function requireQuividiAccess(request: CallableRequest): CallableAuth {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
  }
  if (!canReportQuividi(roleFromClaims(auth.token))) {
    throw new HttpsError(
      'permission-denied',
      'Tu rol no permite consultar el reporte de audiencia Quividi.',
    );
  }
  return auth;
}

export const campaignReport = onCall(
  {
    secrets: [QUIVIDI_API_USERNAME, QUIVIDI_API_TOKEN],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async (request): Promise<{ report: CampaignReport; cached: boolean }> => {
    const auth = requireQuividiAccess(request);
    const data = request.data as
      | { campaignId?: unknown; forceRefresh?: unknown }
      | undefined;
    const campaignId =
      typeof data?.campaignId === 'string' ? data.campaignId.trim() : '';
    const forceRefresh = data?.forceRefresh === true;
    if (forceRefresh && !canForceRefreshQuividi(roleFromClaims(auth.token))) {
      throw new HttpsError(
        'permission-denied',
        'Solo un administrador puede forzar el recálculo del reporte Quividi.',
      );
    }
    if (!campaignId) {
      throw new HttpsError('invalid-argument', 'Falta campaignId.');
    }

    const db = getFirestore();
    const campaignSnap = await db.collection('campaigns').doc(campaignId).get();
    if (!campaignSnap.exists) {
      throw new HttpsError('not-found', 'La campaña no existe.');
    }
    const campaign = campaignSnap.data() as CampaignDoc;
    const startDate = parseCivilDate(campaign.fechaInicio ?? '');
    const endDate = parseCivilDate(campaign.fechaFin ?? '');
    if (!startDate || !endDate) {
      throw new HttpsError(
        'failed-precondition',
        'La campaña no tiene una vigencia válida para consultar Quividi.',
      );
    }

    const screensSnap = await db.collection('screens').get();
    const screens = screensSnap.docs.map((doc) => doc.data() as ScreenDoc);
    const effectiveScope = await buildEffectiveSupportPairs(
      db,
      campaignId,
      campaign,
      screens,
    );
    const pairs = effectiveScope.pairs;
    const signature = inputSignature(
      campaign,
      pairs,
      effectiveScope.origins,
      startDate,
      endDate,
    );
    const snapshotRef = db.collection(SNAPSHOT_COLLECTION).doc(campaignId);
    const now = Date.now();

    if (!forceRefresh) {
      const snapshot = await snapshotRef.get();
      const saved = snapshot.data();
      if (
        snapshot.exists &&
        saved?.schemaVersion === SNAPSHOT_SCHEMA_VERSION &&
        saved?.inputSignature === signature &&
        typeof saved?.generatedAt === 'number' &&
        snapshotIsFresh(saved.generatedAt, endDate, now)
      ) {
        const report = decodeSnapshot(saved?.compressedReport);
        if (report) return { report, cached: true };
      }
    }

    const report = await generateReport(
      campaignId,
      campaign,
      pairs,
      effectiveScope.origins,
      startDate,
      endDate,
      now,
    );
    const compressed = gzipSync(Buffer.from(JSON.stringify(report), 'utf8'));
    if (compressed.byteLength < 900_000) {
      await snapshotRef.set(
        {
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
          inputSignature: signature,
          campaignName: report.campaignName,
          startDate,
          endDate,
          generatedAt: report.generatedAt,
          coverage: report.coverage,
          compressedReport: compressed,
          updatedByUid: auth.uid,
          updatedByEmail:
            typeof auth.token.email === 'string' ? auth.token.email : '',
        },
        { merge: true },
      );
    }

    return { report, cached: false };
  },
);


interface CampaignAvailabilityItem {
  campaignId: string;
  available: boolean;
  totalPairs: number;
  mappedPairs: number;
  scopeOrigins: EffectiveScopeOrigin[];
}

export const campaignAvailability = onCall(
  async (request): Promise<{ items: CampaignAvailabilityItem[] }> => {
    requireQuividiAccess(request);
    const rawIds = (request.data as { campaignIds?: unknown } | undefined)
      ?.campaignIds;
    if (!Array.isArray(rawIds)) {
      throw new HttpsError('invalid-argument', 'Falta campaignIds.');
    }
    const campaignIds = Array.from(
      new Set(
        rawIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );
    if (campaignIds.length > 250) {
      throw new HttpsError(
        'invalid-argument',
        'Se pueden consultar hasta 250 campañas por solicitud.',
      );
    }
    if (campaignIds.length === 0) return { items: [] };

    const db = getFirestore();
    const screensSnap = await db.collection('screens').get();
    const screens = screensSnap.docs.map((doc) => doc.data() as ScreenDoc);
    const refs = campaignIds.map((id) => db.collection('campaigns').doc(id));
    const campaignSnaps = await db.getAll(...refs);
    const items: CampaignAvailabilityItem[] = [];
    // Las asignaciones Ekon solo dependen del número de campaña, así que una
    // caché compartida entre campañas de la misma solicitud evita repetir la
    // consulta para campañas que apuntan al mismo número. La callable es de
    // solo lectura: no hay escrituras intermedias que la vuelvan obsoleta.
    const assignmentCache = new Map<number, EkonAssignmentDoc[]>();

    for (const snap of campaignSnaps) {
      if (!snap.exists) continue;
      const campaign = snap.data() as CampaignDoc;
      const effectiveScope = await buildEffectiveSupportPairs(
        db,
        snap.id,
        campaign,
        screens,
        assignmentCache,
      );
      const mappedPairs = effectiveScope.pairs.filter(
        (pair) => pair.cameraNames.length > 0,
      ).length;
      items.push({
        campaignId: snap.id,
        available: mappedPairs > 0,
        totalPairs: effectiveScope.pairs.length,
        mappedPairs,
        scopeOrigins: effectiveScope.origins,
      });
    }

    return { items };
  },
);

export const cameraHealthBackfill = onCall(
  {
    secrets: [QUIVIDI_API_USERNAME, QUIVIDI_API_TOKEN],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async (request): Promise<{
    startDate: string;
    endDate: string;
    days: number;
    written: number;
    mapping: CameraHealthMappingSummary;
    alerts: CameraHealthAlertReconcileSummary;
  }> => {
    const auth = requireQuividiAccess(request);
    if (!canForceRefreshQuividi(roleFromClaims(auth.token))) {
      throw new HttpsError(
        'permission-denied',
        'Solo un administrador puede ejecutar el backfill de salud Quividi.',
      );
    }

    const rawDays = (request.data as { days?: unknown } | undefined)?.days;
    const days =
      rawDays === undefined ? CAMERA_HEALTH_LOOKBACK_DAYS : rawDays;
    if (
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > CAMERA_HEALTH_MAX_BACKFILL_DAYS
    ) {
      throw new HttpsError(
        'invalid-argument',
        `days debe ser un entero entre 1 y ${CAMERA_HEALTH_MAX_BACKFILL_DAYS}.`,
      );
    }

    const now = Date.now();
    const health = await computeCameraHealth(days, now);
    const written = await persistCameraHealth(health.records);
    const alerts = await reconcileCameraHealthAlerts(
      health.records,
      health.endDate,
      now,
    );
    return {
      startDate: health.startDate,
      endDate: health.endDate,
      days,
      written,
      mapping: health.mapping,
      alerts,
    };
  },
);

/**
 * Salud operativa diaria de cámaras Quividi.
 *
 * Consulta una ventana móvil de 28 días para que la regla de medición parcial
 * conserve el mismo baseline por cámara que el reporte. En régimen normal solo
 * persiste el último día completo. Si la colección aún está vacía, el primer
 * ciclo deja cargada la ventana completa como backfill inicial.
 */
export const cameraHealthDaily = onSchedule(
  {
    schedule: '15 8 * * *',
    timeZone: 'America/Mexico_City',
    secrets: [QUIVIDI_API_USERNAME, QUIVIDI_API_TOKEN],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const now = Date.now();
    const health = await computeCameraHealth(
      CAMERA_HEALTH_LOOKBACK_DAYS,
      now,
    );
    const db = getFirestore();
    const existing = await db.collection(CAMERA_HEALTH_COLLECTION).limit(1).get();
    const records = existing.empty
      ? health.records
      : health.records.filter((record) => record.date === health.endDate);
    const written = await persistCameraHealth(records);
    const alerts = await reconcileCameraHealthAlerts(
      health.records,
      health.endDate,
      now,
    );

    console.info('Quividi camera health persisted.', {
      startDate: health.startDate,
      endDate: health.endDate,
      initialBackfill: existing.empty,
      written,
      mapping: health.mapping,
      alerts,
    });
  },
);

