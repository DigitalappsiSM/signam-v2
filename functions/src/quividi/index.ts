import { Buffer } from 'node:buffer';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
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
import { canReportQuividi, roleFromClaims } from './access';
import { buildSupportHours, type SupportHour } from './hourly';
import {
  buildCoverage,
  buildMeasurementRows,
  dayList,
  inputSignature,
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
