import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

const QUIVIDI_API_USERNAME = defineSecret('QUIVIDI_API_USERNAME');
const QUIVIDI_API_TOKEN = defineSecret('QUIVIDI_API_TOKEN');
const BASE_URL = 'https://vidicenter.quividi.com/api/v1';

interface Location {
  id: number;
  label: string;
  box_id?: number | null;
  site_id?: number | null;
  active?: boolean;
}

interface ExportResponse {
  state: 'started' | 'in_progress' | 'finished' | 'failed';
  fail_reason?: string;
  data?: Record<string, unknown>[];
}

interface CameraRef {
  locationId: number;
  boxId: number | null;
  siteId: number | null;
  name: string;
}

interface SupportMapping {
  key: string;
  retailer: string;
  storeNumber: string;
  storeName: string;
  support: string;
  cameras: CameraRef[];
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function authHeader(): string {
  const raw = QUIVIDI_API_USERNAME.value() + ':' + QUIVIDI_API_TOKEN.value();
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

async function quividiGet<T>(path: string): Promise<T> {
  const response = await fetch(BASE_URL + path, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new HttpsError(
      response.status === 401 ? 'unauthenticated' : 'internal',
      'Quividi respondió HTTP ' + response.status + '.',
    );
  }
  return (await response.json()) as T;
}

async function exportData(params: URLSearchParams): Promise<Record<string, unknown>[]> {
  const path = '/data/?' + params.toString();
  let delay = 1200;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = await quividiGet<ExportResponse>(path);
    if (result.state === 'finished') return result.data ?? [];
    if (result.state === 'failed') {
      throw new HttpsError(
        'internal',
        'Quividi no pudo generar el export: ' + (result.fail_reason ?? 'sin detalle'),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(5000, Math.round(delay * 1.5));
  }
  throw new HttpsError(
    'deadline-exceeded',
    'Quividi sigue procesando el export. Intenta nuevamente en unos minutos.',
  );
}

function campaignDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('failed-precondition', 'La campaña no tiene vigencia válida.');
  }
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const mx = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (mx) {
    return mx[3] + '-' + mx[2].padStart(2, '0') + '-' + mx[1].padStart(2, '0');
  }
  throw new HttpsError('failed-precondition', 'No se pudo interpretar la vigencia de la campaña.');
}

function inclusiveEnd(date: string): string {
  return date + 'T23:59:59';
}

function startOfDay(date: string): string {
  return date + 'T00:00:00';
}

function numberValue(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function dateValue(row: Record<string, unknown>): string {
  const explicit = row.period_start_date;
  if (typeof explicit === 'string' && explicit.length >= 10) return explicit.slice(0, 10);
  const period = row.period_start;
  return typeof period === 'string' ? period.slice(0, 10) : '';
}

async function resolveMappings(campaignId: string): Promise<{
  campaign: Record<string, unknown>;
  mappings: SupportMapping[];
  uncovered: Array<{ storeNumber: string; storeName: string; support: string }>;
}> {
  const db = getFirestore();
  const campaignSnap = await db.collection('campaigns').doc(campaignId).get();
  if (!campaignSnap.exists) throw new HttpsError('not-found', 'La campaña no existe.');
  const campaign = campaignSnap.data() ?? {};
  const supports = Array.isArray(campaign.supports) ? campaign.supports : [];
  const screensSnap = await db.collection('screens').get();
  const screens = screensSnap.docs.map((doc) => doc.data());

  const locationList = await quividiGet<Location[]>('/locations/');
  const locationByName = new Map(locationList.map((location) => [normalize(location.label), location]));

  const mappings: SupportMapping[] = [];
  const uncovered: Array<{ storeNumber: string; storeName: string; support: string }> = [];

  for (const supportValue of supports) {
    const support = supportValue as Record<string, unknown>;
    const supportName = typeof support.support === 'string' ? support.support : '';
    const selectedStores = Array.isArray(support.stores)
      ? support.stores as Array<Record<string, unknown>>
      : [];
    const scope = typeof support.scope === 'string'
      ? support.scope
      : selectedStores.length === 0 ? 'all' : 'selected';
    if (scope === 'invalid') continue;

    const candidateScreens = screens.filter((screen) => {
      const original = (screen.original ?? {}) as Record<string, unknown>;
      const metadata = (screen.metadata ?? {}) as Record<string, unknown>;
      if (metadata.active === false) return false;
      if (normalize(String(metadata.calendarSupport ?? '')) !== normalize(supportName)) return false;
      if (scope === 'all') return true;
      const store = normalize(String(original['Numero de Tienda'] ?? ''));
      return selectedStores.some((selected) => normalize(String(selected.numero ?? '')) === store);
    });

    const byStore = new Map<string, typeof candidateScreens>();
    for (const screen of candidateScreens) {
      const original = (screen.original ?? {}) as Record<string, unknown>;
      const storeNumber = String(original['Numero de Tienda'] ?? '').trim();
      const bucket = byStore.get(storeNumber) ?? [];
      bucket.push(screen);
      byStore.set(storeNumber, bucket);
    }

    for (const [storeNumber, storeScreens] of byStore) {
      const firstOriginal = (storeScreens[0]?.original ?? {}) as Record<string, unknown>;
      const storeName = String(firstOriginal['Nombre de tienda'] ?? '').trim();
      const cameras: CameraRef[] = [];
      const seen = new Set<number>();
      for (const screen of storeScreens) {
        const metadata = (screen.metadata ?? {}) as Record<string, unknown>;
        const cameraName = String(metadata.quividiCameraName ?? '').trim();
        if (!cameraName) continue;
        const location = locationByName.get(normalize(cameraName));
        if (!location || seen.has(location.id)) continue;
        seen.add(location.id);
        cameras.push({
          locationId: location.id,
          boxId: location.box_id ?? null,
          siteId: location.site_id ?? null,
          name: location.label,
        });
      }
      if (cameras.length === 0) {
        uncovered.push({ storeNumber, storeName, support: supportName });
        continue;
      }
      mappings.push({
        key: ['Liverpool', storeNumber, supportName].map(normalize).join('|'),
        retailer: 'Liverpool',
        storeNumber,
        storeName,
        support: supportName,
        cameras,
      });
    }

    if (scope === 'selected') {
      for (const selected of selectedStores) {
        const storeNumber = String(selected.numero ?? '').trim();
        if (!byStore.has(storeNumber)) {
          uncovered.push({
            storeNumber,
            storeName: String(selected.nombre ?? '').trim(),
            support: supportName,
          });
        }
      }
    }
  }
  return { campaign, mappings, uncovered };
}

export const getCampaignAudience = onCall(
  {
    secrets: [QUIVIDI_API_USERNAME, QUIVIDI_API_TOKEN],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const campaignId = (request.data as { campaignId?: unknown } | undefined)?.campaignId;
    if (typeof campaignId !== 'string' || !campaignId) {
      throw new HttpsError('invalid-argument', 'Falta campaignId.');
    }

    const { campaign, mappings, uncovered } = await resolveMappings(campaignId);
    const startDate = campaignDate(campaign.fechaInicio);
    const endDate = campaignDate(campaign.fechaFin);
    const locationIds = Array.from(
      new Set(mappings.flatMap((mapping) => mapping.cameras.map((camera) => camera.locationId))),
    );

    if (locationIds.length === 0) {
      return {
        campaignId,
        campaignName: String(campaign.name ?? ''),
        startDate,
        endDate,
        mappings,
        uncovered,
        cameraDays: [],
        generatedAt: Date.now(),
      };
    }

    const common = {
      locations: locationIds.join(','),
      start: startOfDay(startDate),
      end: inclusiveEnd(endDate),
      time_resolution: '1d',
    };

    const otsParams = new URLSearchParams({ ...common, data_type: 'ots' });
    const viewersParams = new URLSearchParams({ ...common, data_type: 'viewers' });
    const demographicsParams = new URLSearchParams({
      ...common,
      data_type: 'viewers',
      group_by_demographics: '1',
    });

    const [otsRows, viewerRows, demographicRows] = await Promise.all([
      exportData(otsParams),
      exportData(viewersParams),
      exportData(demographicsParams),
    ]);

    const viewersByKey = new Map<string, Record<string, unknown>>();
    for (const row of viewerRows) {
      viewersByKey.set(String(row.location_id) + '|' + dateValue(row), row);
    }
    const demographicsByKey = new Map<
      string,
      { gender: Record<string, number>; age: Record<string, number>; ageGender: Record<string, number> }
    >();
    const genderName = ['unknown', 'male', 'female'];
    const ageName = ['unknown', 'child', 'young_adult', 'adult', 'senior'];
    for (const row of demographicRows) {
      const key = String(row.location_id) + '|' + dateValue(row);
      const bucket = demographicsByKey.get(key) ?? { gender: {}, age: {}, ageGender: {} };
      const gender = genderName[numberValue(row, 'gender')] ?? 'unknown';
      const age = ageName[numberValue(row, 'age')] ?? 'unknown';
      const count = numberValue(row, 'watcher_count');
      bucket.gender[gender] = (bucket.gender[gender] ?? 0) + count;
      bucket.age[age] = (bucket.age[age] ?? 0) + count;
      bucket.ageGender[age + '|' + gender] = (bucket.ageGender[age + '|' + gender] ?? 0) + count;
      demographicsByKey.set(key, bucket);
    }

    const locationNames = new Map(
      mappings.flatMap((mapping) => mapping.cameras.map((camera) => [camera.locationId, camera.name] as const)),
    );
    const cameraDays = otsRows.map((row) => {
      const locationId = numberValue(row, 'location_id');
      const date = dateValue(row);
      const viewer = viewersByKey.get(String(locationId) + '|' + date);
      const watchers = viewer ? numberValue(viewer, 'watcher_count') : numberValue(row, 'watcher_count');
      const attentionTenths = viewer ? numberValue(viewer, 'attention_time_in_tenths_of_sec') : 0;
      const dwellTenths = viewer ? numberValue(viewer, 'dwell_time_in_tenths_of_sec') : 0;
      return {
        date,
        locationId,
        cameraName: locationNames.get(locationId) ?? String(locationId),
        ots: numberValue(row, 'ots_count'),
        effectiveOts: numberValue(row, 'effective_ots_count'),
        watchers,
        attentionSeconds: watchers > 0 ? attentionTenths / 10 / watchers : null,
        dwellSeconds: watchers > 0 ? dwellTenths / 10 / watchers : null,
        durationSeconds: numberValue(row, 'duration'),
        demographics:
          demographicsByKey.get(String(locationId) + '|' + date) ??
          { gender: {}, age: {}, ageGender: {} },
      };
    });

    const snapshot = {
      campaignId,
      campaignName: String(campaign.name ?? ''),
      startDate,
      endDate,
      mappings,
      uncovered,
      cameraDays,
      generatedAt: Date.now(),
      schemaVersion: 1,
    };
    await getFirestore()
      .collection('campaignAudienceSnapshots')
      .doc(campaignId)
      .set(snapshot, { merge: true });

    return snapshot;
  },
);
