import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { gunzipSync, gzipSync } from 'node:zlib';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildEffectiveSupportPairs,
  type CampaignDoc,
  type EffectiveScopeOrigin,
  type EffectiveSupportPair,
  type ScreenDoc,
} from './effectiveScope';

const QUIVIDI_API_USERNAME = defineSecret('QUIVIDI_API_USERNAME');
const QUIVIDI_API_TOKEN = defineSecret('QUIVIDI_API_TOKEN');
const QUIVIDI_BASE_URL = 'https://vidicenter.quividi.com/api/v1';
const SNAPSHOT_COLLECTION = 'campaignAudienceSnapshots';
const SNAPSHOT_SCHEMA_VERSION = 2;
const ACTIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const PARTIAL_DURATION_RATIO = 0.8;

type MeasurementStatus = 'complete' | 'partial' | 'missing';

interface TopologyLocation {
  id: number;
  name?: string;
  label?: string;
  box_id?: number | null;
  site_id?: number | null;
  active?: boolean;
  last_seen?: string | null;
}

interface OtsExportRow {
  location_id?: number;
  period_start?: string;
  duration?: number;
  ots_count?: number;
  effective_ots_count?: number;
}

interface ViewerExportRow {
  location_id?: number;
  period_start?: string;
  watcher_count?: number;
  attention_time_in_tenths_of_sec?: number;
  dwell_time_in_tenths_of_sec?: number;
  gender?: number;
  age?: number;
}

interface SupportPair extends EffectiveSupportPair {
  cameras: TopologyLocation[];
}

interface CameraDay {
  locationId: number;
  locationName: string;
  boxId: number | null;
  siteId: number | null;
  active: boolean;
  lastSeen: string | null;
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  durationSeconds: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionTenths: number;
  dwellTenths: number;
  status: MeasurementStatus;
}

interface SupportDay {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  status: MeasurementStatus;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
}

interface DemographicRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  gender: number;
  age: number;
  watchers: number;
}

interface Incident {
  storeNumber: string;
  storeName: string;
  support: string;
  locationId: number;
  locationName: string;
  dates: string[];
  status: 'partial' | 'missing';
}

interface CampaignReport {
  schemaVersion: 2;
  campaignId: string;
  campaignName: string;
  startDate: string;
  endDate: string;
  generatedAt: number;
  scopeOrigins: EffectiveScopeOrigin[];
  coverage: {
    totalPairs: number;
    mappedPairs: number;
    percent: number;
    bySupport: Array<{
      support: string;
      totalPairs: number;
      mappedPairs: number;
      percent: number;
    }>;
  };
  cameraDays: CameraDay[];
  supportDays: SupportDay[];
  demographics: DemographicRow[];
  incidents: Incident[];
  unmappedCameraNames: string[];
}

function parseCivilDate(value: string): string | null {
  const text = value.trim();
  let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    return [
      match[1],
      match[2]!.padStart(2, '0'),
      match[3]!.padStart(2, '0'),
    ].join('-');
  }
  match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (match) {
    return [
      match[3],
      match[2]!.padStart(2, '0'),
      match[1]!.padStart(2, '0'),
    ].join('-');
  }
  return null;
}

function dayList(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const days: string[] = [];
  for (
    let cursor = startDate.getTime();
    cursor <= endDate.getTime();
    cursor += 86_400_000
  ) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return days;
}


function lastCompleteUtcDate(now: number): string {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function measurableEndDate(
  startDate: string,
  scheduledEndDate: string,
  now: number,
): string | null {
  const cutoff = lastCompleteUtcDate(now);
  const endDate = scheduledEndDate < cutoff ? scheduledEndDate : cutoff;
  return endDate >= startDate ? endDate : null;
}

function recordDate(periodStart: unknown): string | null {
  if (typeof periodStart !== 'string') return null;
  const match = periodStart.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function percentage(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
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

function resolvePairs(
  pairs: EffectiveSupportPair[],
  locations: TopologyLocation[],
): {
  pairs: SupportPair[];
  unmappedCameraNames: string[];
} {
  const byName = new Map<string, TopologyLocation[]>();
  for (const location of locations) {
    const name = (location.name ?? location.label ?? '').trim();
    if (!name) continue;
    const group = byName.get(name) ?? [];
    group.push(location);
    byName.set(name, group);
  }

  const unmapped = new Set<string>();
  const resolved = pairs.map((pair) => {
    const cameras: TopologyLocation[] = [];
    for (const name of pair.cameraNames) {
      const candidates = byName.get(name) ?? [];
      if (candidates.length === 1) cameras.push(candidates[0]!);
      else unmapped.add(
        candidates.length === 0 ? name : `${name} (duplicada en Quividi)`,
      );
    }
    return { ...pair, cameras };
  });
  return {
    pairs: resolved,
    unmappedCameraNames: Array.from(unmapped).sort(),
  };
}

function buildCoverage(pairs: SupportPair[]): CampaignReport['coverage'] {
  const supports = new Map<string, { totalPairs: number; mappedPairs: number }>();
  let mappedPairs = 0;
  for (const pair of pairs) {
    const mapped = pair.cameras.length > 0;
    if (mapped) mappedPairs += 1;
    const current = supports.get(pair.support) ?? {
      totalPairs: 0,
      mappedPairs: 0,
    };
    current.totalPairs += 1;
    if (mapped) current.mappedPairs += 1;
    supports.set(pair.support, current);
  }
  return {
    totalPairs: pairs.length,
    mappedPairs,
    percent: percentage(mappedPairs, pairs.length),
    bySupport: Array.from(supports, ([support, value]) => ({
      support,
      ...value,
      percent: percentage(value.mappedPairs, value.totalPairs),
    })).sort((a, b) => a.support.localeCompare(b.support, 'es')),
  };
}

function inputSignature(
  campaign: CampaignDoc,
  pairs: EffectiveSupportPair[],
  scopeOrigins: EffectiveScopeOrigin[],
  startDate: string,
  endDate: string,
): string {
  const payload = JSON.stringify({
    name: campaign.name ?? '',
    startDate,
    endDate,
    pairs: pairs
      .map((pair) => ({
        storeNumber: pair.storeNumber,
        support: pair.support,
        cameraNames: [...pair.cameraNames].sort(),
        source: pair.source,
        ekonNumber: pair.ekonNumber,
      }))
      .sort((a, b) =>
        `${a.storeNumber}|${a.support}`.localeCompare(
          `${b.storeNumber}|${b.support}`,
        ),
      ),
  });
  return createHash('sha256').update(payload).digest('hex');
}

function snapshotIsFresh(
  generatedAt: number,
  endDate: string,
  now: number,
): boolean {
  const endOfCampaign = new Date(`${endDate}T23:59:59Z`).getTime();
  if (now <= endOfCampaign) return now - generatedAt < ACTIVE_CACHE_MS;
  return generatedAt > endOfCampaign;
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

function viewerByLocationDay(
  rows: ViewerExportRow[],
): Map<string, {
  watchers: number;
  attentionTenths: number;
  dwellTenths: number;
  demographics: Map<string, number>;
}> {
  const result = new Map<
    string,
    {
      watchers: number;
      attentionTenths: number;
      dwellTenths: number;
      demographics: Map<string, number>;
    }
  >();
  for (const row of rows) {
    const locationId = numeric(row.location_id);
    const date = recordDate(row.period_start);
    if (!locationId || !date) continue;
    const key = `${locationId}|${date}`;
    const current = result.get(key) ?? {
      watchers: 0,
      attentionTenths: 0,
      dwellTenths: 0,
      demographics: new Map<string, number>(),
    };
    const watchers = numeric(row.watcher_count);
    current.watchers += watchers;
    current.attentionTenths += numeric(row.attention_time_in_tenths_of_sec);
    current.dwellTenths += numeric(row.dwell_time_in_tenths_of_sec);
    const gender = numeric(row.gender);
    const age = numeric(row.age);
    const demoKey = `${gender}|${age}`;
    current.demographics.set(
      demoKey,
      (current.demographics.get(demoKey) ?? 0) + watchers,
    );
    result.set(key, current);
  }
  return result;
}

function otsByLocationDay(rows: OtsExportRow[]): Map<string, OtsExportRow> {
  const result = new Map<string, OtsExportRow>();
  for (const row of rows) {
    const locationId = numeric(row.location_id);
    const date = recordDate(row.period_start);
    if (!locationId || !date) continue;
    result.set(`${locationId}|${date}`, row);
  }
  return result;
}

function buildMeasurementRows(
  pairs: SupportPair[],
  dates: string[],
  otsRows: OtsExportRow[],
  viewerRows: ViewerExportRow[],
): {
  cameraDays: CameraDay[];
  supportDays: SupportDay[];
  demographics: DemographicRow[];
  incidents: Incident[];
} {
  const ots = otsByLocationDay(otsRows);
  const viewers = viewerByLocationDay(viewerRows);
  const medians = new Map<number, number>();

  for (const pair of pairs) {
    for (const camera of pair.cameras) {
      const durations = dates
        .map((date) => numeric(ots.get(`${camera.id}|${date}`)?.duration))
        .filter((duration) => duration > 0);
      medians.set(camera.id, median(durations));
    }
  }

  const cameraDays: CameraDay[] = [];
  const cameraDayIndex = new Map<string, CameraDay>();
  for (const pair of pairs) {
    for (const camera of pair.cameras) {
      const baseline = medians.get(camera.id) ?? 0;
      for (const date of dates) {
        const key = `${camera.id}|${date}`;
        const otsRow = ots.get(key);
        const viewer = viewers.get(key);
        const duration = numeric(otsRow?.duration);
        let status: MeasurementStatus = 'complete';
        if (!otsRow) status = 'missing';
        else if (
          baseline > 0 &&
          duration > 0 &&
          duration < baseline * PARTIAL_DURATION_RATIO
        ) {
          status = 'partial';
        }
        const row: CameraDay = {
          locationId: camera.id,
          locationName: (camera.name ?? camera.label ?? String(camera.id)).trim(),
          boxId: camera.box_id ?? null,
          siteId: camera.site_id ?? null,
          active: camera.active !== false,
          lastSeen: camera.last_seen ?? null,
          date,
          storeNumber: pair.storeNumber,
          storeName: pair.storeName,
          support: pair.support,
          durationSeconds: duration,
          ots: numeric(otsRow?.ots_count),
          effectiveOts: numeric(otsRow?.effective_ots_count),
          watchers: viewer?.watchers ?? 0,
          attentionTenths: viewer?.attentionTenths ?? 0,
          dwellTenths: viewer?.dwellTenths ?? 0,
          status,
        };
        cameraDays.push(row);
        cameraDayIndex.set(key, row);
      }
    }
  }

  const supportDays: SupportDay[] = [];
  const demographics: DemographicRow[] = [];
  for (const pair of pairs) {
    if (pair.cameras.length === 0) continue;
    for (const date of dates) {
      const all = pair.cameras
        .map((camera) => cameraDayIndex.get(`${camera.id}|${date}`))
        .filter((row): row is CameraDay => row != null);
      const complete = all.filter((row) => row.status === 'complete');
      const partial = all.filter((row) => row.status === 'partial');
      const selected = complete.length > 0 ? complete : partial;
      const status: MeasurementStatus =
        selected.length === 0
          ? 'missing'
          : all.every((row) => row.status === 'complete')
            ? 'complete'
            : 'partial';
      const watchersTotal = selected.reduce(
        (sum, row) => sum + row.watchers,
        0,
      );
      supportDays.push({
        date,
        storeNumber: pair.storeNumber,
        storeName: pair.storeName,
        support: pair.support,
        configuredCameras: all.length,
        measuredCameras: selected.length,
        status,
        ots: average(selected.map((row) => row.ots)),
        effectiveOts: average(selected.map((row) => row.effectiveOts)),
        watchers: average(selected.map((row) => row.watchers)),
        attentionSeconds:
          watchersTotal > 0
            ? selected.reduce((sum, row) => sum + row.attentionTenths, 0) /
              watchersTotal /
              10
            : 0,
        dwellSeconds:
          watchersTotal > 0
            ? selected.reduce((sum, row) => sum + row.dwellTenths, 0) /
              watchersTotal /
              10
            : 0,
      });

      if (selected.length === 0) continue;
      const demoKeys = new Set<string>();
      for (const row of selected) {
        const viewer = viewers.get(`${row.locationId}|${date}`);
        for (const key of viewer?.demographics.keys() ?? []) demoKeys.add(key);
      }
      for (const demoKey of demoKeys) {
        const [genderText, ageText] = demoKey.split('|');
        const counts = selected.map(
          (row) =>
            viewers
              .get(`${row.locationId}|${date}`)
              ?.demographics.get(demoKey) ?? 0,
        );
        demographics.push({
          date,
          storeNumber: pair.storeNumber,
          storeName: pair.storeName,
          support: pair.support,
          gender: Number(genderText),
          age: Number(ageText),
          watchers: average(counts),
        });
      }
    }
  }

  const incidentsMap = new Map<string, Incident>();
  for (const row of cameraDays) {
    if (row.status === 'complete') continue;
    const incidentStatus = row.status === 'missing' ? 'missing' : 'partial';
    const key = `${row.locationId}|${incidentStatus}`;
    const incident = incidentsMap.get(key) ?? {
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      locationId: row.locationId,
      locationName: row.locationName,
      dates: [],
      status: incidentStatus,
    };
    incident.dates.push(row.date);
    incidentsMap.set(key, incident);
  }

  return {
    cameraDays,
    supportDays,
    demographics,
    incidents: Array.from(incidentsMap.values()),
  };
}

async function generateReport(
  campaignId: string,
  campaign: CampaignDoc,
  pairsWithoutLocations: Array<Omit<SupportPair, 'cameras'>>,
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
  if (mappedLocations.length > 0 && measuredEndDate) {
    const common = {
      locations: mappedLocations.join(','),
      start: `${startDate}T00:00:00`,
      end: `${measuredEndDate}T23:59:59`,
      time_resolution: '1d',
    };
    otsRows = (await exportData({
      ...common,
      data_type: 'ots',
    })) as OtsExportRow[];
    viewerRows = (await exportData({
      ...common,
      data_type: 'viewers',
      group_by_demographics: '1',
    })) as ViewerExportRow[];
  }

  const measurement = buildMeasurementRows(
    resolved.pairs,
    dates,
    otsRows,
    viewerRows,
  );
  return {
    schemaVersion: 2,
    campaignId,
    campaignName: campaign.name ?? '',
    startDate,
    endDate,
    generatedAt: Date.now(),
    scopeOrigins,
    coverage: buildCoverage(resolved.pairs),
    ...measurement,
    unmappedCameraNames: resolved.unmappedCameraNames,
  };
}

export const campaignReport = onCall(
  {
    secrets: [QUIVIDI_API_USERNAME, QUIVIDI_API_TOKEN],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request): Promise<{ report: CampaignReport; cached: boolean }> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
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
    const signature = inputSignature(campaign, pairs, startDate, endDate);
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
          updatedByUid: request.auth.uid,
          updatedByEmail:
            typeof request.auth.token.email === 'string'
              ? request.auth.token.email
              : '',
        },
        { merge: true },
      );
    }

    return { report, cached: false };
  },
);
