import { createHash } from 'node:crypto';
import type {
  CampaignDoc,
  EffectiveScopeOrigin,
  EffectiveSupportPair,
} from './effectiveScope';

/**
 * Lógica pura del reporte de audiencia Quividi.
 *
 * Extraída de `index.ts` sin cambios de comportamiento para poder probarla:
 * este módulo no importa `firebase-admin` ni `firebase-functions`, así que sus
 * pruebas corren con el Vitest de la raíz sin instalar las dependencias de
 * `functions/`. El acceso a VidiCenter, a Firestore y las callables siguen en
 * `index.ts`.
 */

export interface ReportCoverage {
  totalPairs: number;
  mappedPairs: number;
  percent: number;
  bySupport: Array<{
    support: string;
    totalPairs: number;
    mappedPairs: number;
    percent: number;
  }>;
}

export const ACTIVE_CACHE_MS = 24 * 60 * 60 * 1000;
export const PARTIAL_DURATION_RATIO = 0.8;

export type MeasurementStatus = 'complete' | 'partial' | 'missing';

export interface TopologyLocation {
  id: number;
  name?: string;
  label?: string;
  box_id?: number | null;
  site_id?: number | null;
  active?: boolean;
  last_seen?: string | null;
}

export interface OtsExportRow {
  location_id?: number;
  period_start?: string;
  duration?: number;
  ots_count?: number;
  effective_ots_count?: number;
}

export interface ViewerExportRow {
  location_id?: number;
  period_start?: string;
  watcher_count?: number;
  attention_time_in_tenths_of_sec?: number;
  dwell_time_in_tenths_of_sec?: number;
  gender?: number;
  age?: number;
}

export interface SupportPair extends EffectiveSupportPair {
  cameras: TopologyLocation[];
}

export interface CameraDay {
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

export interface SupportDay {
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

export interface DemographicRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  gender: number;
  age: number;
  watchers: number;
}

export interface Incident {
  storeNumber: string;
  storeName: string;
  support: string;
  locationId: number;
  locationName: string;
  dates: string[];
  status: 'partial' | 'missing';
}

export function parseCivilDate(value: string): string | null {
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

export function dayList(start: string, end: string): string[] {
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


export function lastCompleteUtcDate(now: number): string {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function measurableEndDate(
  startDate: string,
  scheduledEndDate: string,
  now: number,
): string | null {
  const cutoff = lastCompleteUtcDate(now);
  const endDate = scheduledEndDate < cutoff ? scheduledEndDate : cutoff;
  return endDate >= startDate ? endDate : null;
}

export function recordDate(periodStart: unknown): string | null {
  if (typeof periodStart !== 'string') return null;
  const match = periodStart.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function percentage(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function resolvePairs(
  pairs: EffectiveSupportPair[],
  locations: TopologyLocation[],
): {
  pairs: SupportPair[];
  unmappedCameraNames: string[];
  unmappedLocationIds: number[];
} {
  const byName = new Map<string, TopologyLocation[]>();
  const byId = new Map<number, TopologyLocation>();
  for (const location of locations) {
    byId.set(location.id, location);
    const name = (location.name ?? location.label ?? '').trim();
    if (!name) continue;
    const group = byName.get(name) ?? [];
    group.push(location);
    byName.set(name, group);
  }

  const unmappedNames = new Set<string>();
  const unmappedIds = new Set<number>();
  const resolved = pairs.map((pair) => {
    const cameras: TopologyLocation[] = [];
    const cameraIds = new Set<number>();

    for (const id of pair.cameraLocationIds ?? []) {
      const location = byId.get(id);
      if (location) {
        if (!cameraIds.has(location.id)) {
          cameras.push(location);
          cameraIds.add(location.id);
        }
      } else {
        unmappedIds.add(id);
      }
    }

    for (const name of pair.cameraNames) {
      const candidates = byName.get(name) ?? [];
      if (candidates.length === 1) {
        const location = candidates[0]!;
        if (!cameraIds.has(location.id)) {
          cameras.push(location);
          cameraIds.add(location.id);
        }
      } else {
        unmappedNames.add(
          candidates.length === 0 ? name : `${name} (duplicada en Quividi)`,
        );
      }
    }
    return { ...pair, cameras };
  });
  return {
    pairs: resolved,
    unmappedCameraNames: Array.from(unmappedNames).sort(),
    unmappedLocationIds: Array.from(unmappedIds).sort((a, b) => a - b),
  };
}

export function buildCoverage(pairs: SupportPair[]): ReportCoverage {
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

export function inputSignature(
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
    scopeOrigins,
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

export function snapshotIsFresh(
  generatedAt: number,
  endDate: string,
  now: number,
): boolean {
  const endOfCampaign = new Date(`${endDate}T23:59:59Z`).getTime();
  if (now <= endOfCampaign) return now - generatedAt < ACTIVE_CACHE_MS;
  return generatedAt > endOfCampaign;
}

export function viewerByLocationDay(
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

export function otsByLocationDay(rows: OtsExportRow[]): Map<string, OtsExportRow> {
  const result = new Map<string, OtsExportRow>();
  for (const row of rows) {
    const locationId = numeric(row.location_id);
    const date = recordDate(row.period_start);
    if (!locationId || !date) continue;
    result.set(`${locationId}|${date}`, row);
  }
  return result;
}

export function buildMeasurementRows(
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
