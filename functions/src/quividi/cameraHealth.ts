import {
  normalizeStore,
  normalizeSupport,
  type EffectiveSupportPair,
  type ScreenDoc,
} from './effectiveScope';
import {
  buildMeasurementRows,
  resolvePairs,
  type MeasurementStatus,
  type OtsExportRow,
  type SupportPair,
  type TopologyLocation,
  type ViewerExportRow,
} from './measurement';

export const CAMERA_HEALTH_SCHEMA_VERSION = 1;
export const CAMERA_HEALTH_LOOKBACK_DAYS = 28;
export const CAMERA_HEALTH_MAX_BACKFILL_DAYS = 90;

interface OperationalPairDraft {
  storeNumber: string;
  storeName: string;
  support: string;
  cameraNames: Set<string>;
}

export interface CameraHealthMappingSummary {
  activeConfiguredPairs: number;
  configuredCameraNames: number;
  mappedCameras: number;
  unconfiguredScreens: number;
  duplicateCameraNames: string[];
  unmappedCameraNames: string[];
}

export interface CameraHealthScope {
  pairs: SupportPair[];
  mappedLocationIds: number[];
  mapping: CameraHealthMappingSummary;
}

export interface CameraHealthRecord {
  schemaVersion: 1;
  source: 'quividi';
  date: string;
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  boxId: number | null;
  siteId: number | null;
  topologyActive: boolean;
  lastSeen: string | null;
  durationSeconds: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  measurementStatus: MeasurementStatus;
  hasMeasurement: boolean;
  hasOts: boolean;
  computedAt: number;
}

export interface OperationalPairBuildResult {
  pairs: EffectiveSupportPair[];
  unconfiguredScreens: number;
  duplicateCameraNames: string[];
}

function activeScreen(screen: ScreenDoc): boolean {
  return screen.metadata?.active !== false;
}

/**
 * Construye el inventario operativo desde el catálogo, no desde campañas.
 *
 * Una cámara solo puede pertenecer a una combinación tienda + soporte. Si el
 * mismo nombre Quividi aparece en dos combinaciones distintas, se excluye de
 * salud operativa y se reporta como duplicado para no atribuir datos al activo
 * equivocado.
 */
export function buildOperationalPairs(
  screens: readonly ScreenDoc[],
): OperationalPairBuildResult {
  const drafts = new Map<string, OperationalPairDraft>();
  const owners = new Map<string, Set<string>>();
  let unconfiguredScreens = 0;

  for (const screen of screens) {
    if (!activeScreen(screen)) continue;

    const storeNumber = normalizeStore(
      screen.original?.['Numero de Tienda'] ?? '',
    );
    const storeName = screen.original?.['Nombre de tienda']?.trim() ?? '';
    const support = normalizeSupport(screen.metadata?.calendarSupport ?? '');
    const cameraName = screen.metadata?.quividiCameraName?.trim() ?? '';

    if (!storeNumber || !support || !cameraName) {
      unconfiguredScreens += 1;
      continue;
    }

    const key = `${storeNumber}|${support}`;
    const draft = drafts.get(key) ?? {
      storeNumber,
      storeName,
      support,
      cameraNames: new Set<string>(),
    };
    if (!draft.storeName && storeName) draft.storeName = storeName;
    draft.cameraNames.add(cameraName);
    drafts.set(key, draft);

    const cameraOwners = owners.get(cameraName) ?? new Set<string>();
    cameraOwners.add(key);
    owners.set(cameraName, cameraOwners);
  }

  const duplicateCameraNames = Array.from(owners)
    .filter(([, keys]) => keys.size > 1)
    .map(([cameraName]) => cameraName)
    .sort((a, b) => a.localeCompare(b, 'es'));

  const duplicates = new Set(duplicateCameraNames);
  const pairs: EffectiveSupportPair[] = Array.from(drafts.values())
    .map((draft) => ({
      storeNumber: draft.storeNumber,
      storeName: draft.storeName,
      support: draft.support,
      cameraNames: Array.from(draft.cameraNames)
        .filter((name) => !duplicates.has(name))
        .sort((a, b) => a.localeCompare(b, 'es')),
      // Campo estructural requerido por la capa de medición. En salud operativa
      // el origen real es siempre el catálogo de pantallas, no una campaña.
      source: 'calendar-all' as const,
      ekonNumber: null,
    }))
    .filter((pair) => pair.cameraNames.length > 0)
    .sort((a, b) =>
      `${a.storeNumber}|${a.support}`.localeCompare(
        `${b.storeNumber}|${b.support}`,
        'es',
      ),
    );

  return { pairs, unconfiguredScreens, duplicateCameraNames };
}

export function prepareCameraHealthScope(
  screens: readonly ScreenDoc[],
  topology: TopologyLocation[],
): CameraHealthScope {
  const operational = buildOperationalPairs(screens);
  const resolved = resolvePairs(operational.pairs, topology);
  const mappedLocationIds = Array.from(
    new Set(
      resolved.pairs.flatMap((pair) =>
        pair.cameras.map((camera) => camera.id),
      ),
    ),
  ).sort((a, b) => a - b);

  return {
    pairs: resolved.pairs,
    mappedLocationIds,
    mapping: {
      activeConfiguredPairs: resolved.pairs.length,
      configuredCameraNames: operational.pairs.reduce(
        (sum, pair) => sum + pair.cameraNames.length,
        0,
      ),
      mappedCameras: mappedLocationIds.length,
      unconfiguredScreens: operational.unconfiguredScreens,
      duplicateCameraNames: operational.duplicateCameraNames,
      unmappedCameraNames: resolved.unmappedCameraNames,
    },
  };
}

export function cameraHealthDocumentId(
  date: string,
  locationId: number,
): string {
  return `${date}__${locationId}`;
}

export function lookbackStartDate(endDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new RangeError('endDate debe tener formato YYYY-MM-DD.');
  }
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError('days debe ser un entero positivo.');
  }
  const date = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('endDate no es una fecha válida.');
  }
  date.setUTCDate(date.getUTCDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

export function buildCameraHealthRecords(
  scope: CameraHealthScope,
  dates: string[],
  otsRows: OtsExportRow[],
  viewerRows: ViewerExportRow[],
  computedAt: number,
): CameraHealthRecord[] {
  const { cameraDays } = buildMeasurementRows(
    scope.pairs,
    dates,
    otsRows,
    viewerRows,
  );

  return cameraDays
    .map((row) => ({
      schemaVersion: CAMERA_HEALTH_SCHEMA_VERSION as 1,
      source: 'quividi' as const,
      date: row.date,
      locationId: row.locationId,
      locationName: row.locationName,
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      boxId: row.boxId,
      siteId: row.siteId,
      topologyActive: row.active,
      lastSeen: row.lastSeen,
      durationSeconds: row.durationSeconds,
      ots: row.ots,
      effectiveOts: row.effectiveOts,
      watchers: row.watchers,
      attentionSeconds:
        row.watchers > 0 ? row.attentionTenths / row.watchers / 10 : 0,
      dwellSeconds:
        row.watchers > 0 ? row.dwellTenths / row.watchers / 10 : 0,
      measurementStatus: row.status,
      hasMeasurement: row.durationSeconds > 0,
      hasOts: row.ots > 0,
      computedAt,
    }))
    .sort((a, b) =>
      `${a.date}|${a.locationId}`.localeCompare(
        `${b.date}|${b.locationId}`,
      ),
    );
}
