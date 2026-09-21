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

/**
 * Ventana operativa para salud técnica.
 *
 * 10:00–11:00 se conserva como margen de arranque: algunas tiendas encienden
 * cámaras a las 11:00 por operación local. La futura lógica de alertas no debe
 * declarar una pérdida por ausencia durante esa primera hora. La ventana núcleo
 * que debe evaluarse para continuidad empieza a las 11:00 y termina a las 22:00.
 */
export const CAMERA_HEALTH_OPERATIONAL_START_HOUR = 10;
export const CAMERA_HEALTH_CORE_START_HOUR = 11;
export const CAMERA_HEALTH_OPERATIONAL_END_HOUR = 22;
export const CAMERA_HEALTH_EXPECTED_OPERATIONAL_HOURS =
  CAMERA_HEALTH_OPERATIONAL_END_HOUR - CAMERA_HEALTH_OPERATIONAL_START_HOUR;
export const CAMERA_HEALTH_EXPECTED_CORE_HOURS =
  CAMERA_HEALTH_OPERATIONAL_END_HOUR - CAMERA_HEALTH_CORE_START_HOUR;

interface OperationalPairDraft {
  storeNumber: string;
  storeName: string;
  support: string;
  cameraNames: Set<string>;
  cameraLocationIds: Set<number>;
}

interface HourlyOperationalAggregate {
  measuredHours: Set<number>;
  otsHours: Set<number>;
  ots: number;
  coreMeasuredHours: Set<number>;
  coreOtsHours: Set<number>;
  coreOts: number;
}

export interface CameraHealthMappingSummary {
  activeConfiguredPairs: number;
  configuredCameraNames: number;
  configuredLocationIds: number;
  mappedCameras: number;
  unconfiguredScreens: number;
  duplicateCameraNames: string[];
  duplicateLocationIds: number[];
  unmappedCameraNames: string[];
  unmappedLocationIds: number[];
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
  operationalWindowStartHour: number;
  operationalGraceUntilHour: number;
  operationalWindowEndHour: number;
  expectedOperationalHours: number;
  expectedCoreHours: number;
  operationalMeasuredHours: number;
  operationalOtsHours: number;
  coreMeasuredHours: number;
  coreOtsHours: number;
  firstMeasuredHour: number | null;
  lastMeasuredHour: number | null;
  firstOtsHour: number | null;
  lastOtsHour: number | null;
  operationalOts: number;
  coreOts: number;
  computedAt: number;
}

export interface OperationalPairBuildResult {
  pairs: EffectiveSupportPair[];
  unconfiguredScreens: number;
  duplicateCameraNames: string[];
  duplicateLocationIds: number[];
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
  const nameOwners = new Map<string, Set<string>>();
  const idOwners = new Map<number, Set<string>>();
  let unconfiguredScreens = 0;

  for (const screen of screens) {
    if (!activeScreen(screen)) continue;

    const storeNumber = normalizeStore(
      screen.original?.['Numero de Tienda'] ?? '',
    );
    const storeName = screen.original?.['Nombre de tienda']?.trim() ?? '';
    const support = normalizeSupport(screen.metadata?.calendarSupport ?? '');
    const cameraName = screen.metadata?.quividiCameraName?.trim() ?? '';
    const rawLocationId = screen.metadata?.quividiLocationId;
    const locationId =
      typeof rawLocationId === 'number' &&
      Number.isInteger(rawLocationId) &&
      rawLocationId > 0
        ? rawLocationId
        : null;

    if (!storeNumber || !support || (!locationId && !cameraName)) {
      unconfiguredScreens += 1;
      continue;
    }

    const key = `${storeNumber}|${support}`;
    const draft = drafts.get(key) ?? {
      storeNumber,
      storeName,
      support,
      cameraNames: new Set<string>(),
      cameraLocationIds: new Set<number>(),
    };
    if (!draft.storeName && storeName) draft.storeName = storeName;

    if (locationId !== null) {
      draft.cameraLocationIds.add(locationId);
      const owners = idOwners.get(locationId) ?? new Set<string>();
      owners.add(key);
      idOwners.set(locationId, owners);
    } else {
      draft.cameraNames.add(cameraName);
      const owners = nameOwners.get(cameraName) ?? new Set<string>();
      owners.add(key);
      nameOwners.set(cameraName, owners);
    }
    drafts.set(key, draft);
  }

  const duplicateCameraNames = Array.from(nameOwners)
    .filter(([, keys]) => keys.size > 1)
    .map(([cameraName]) => cameraName)
    .sort((a, b) => a.localeCompare(b, 'es'));
  const duplicateLocationIds = Array.from(idOwners)
    .filter(([, keys]) => keys.size > 1)
    .map(([locationId]) => locationId)
    .sort((a, b) => a - b);

  const duplicateNames = new Set(duplicateCameraNames);
  const duplicateIds = new Set(duplicateLocationIds);
  const pairs: EffectiveSupportPair[] = Array.from(drafts.values())
    .map((draft) => ({
      storeNumber: draft.storeNumber,
      storeName: draft.storeName,
      support: draft.support,
      cameraNames: Array.from(draft.cameraNames)
        .filter((name) => !duplicateNames.has(name))
        .sort((a, b) => a.localeCompare(b, 'es')),
      cameraLocationIds: Array.from(draft.cameraLocationIds)
        .filter((id) => !duplicateIds.has(id))
        .sort((a, b) => a - b),
      // Campo estructural requerido por la capa de medición. En salud operativa
      // el origen real es siempre el catálogo de pantallas, no una campaña.
      source: 'calendar-all' as const,
      ekonNumber: null,
    }))
    .filter(
      (pair) =>
        pair.cameraNames.length > 0 || (pair.cameraLocationIds?.length ?? 0) > 0,
    )
    .sort((a, b) =>
      `${a.storeNumber}|${a.support}`.localeCompare(
        `${b.storeNumber}|${b.support}`,
        'es',
      ),
    );

  return {
    pairs,
    unconfiguredScreens,
    duplicateCameraNames,
    duplicateLocationIds,
  };
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
      configuredLocationIds: operational.pairs.reduce(
        (sum, pair) => sum + (pair.cameraLocationIds?.length ?? 0),
        0,
      ),
      mappedCameras: mappedLocationIds.length,
      unconfiguredScreens: operational.unconfiguredScreens,
      duplicateCameraNames: operational.duplicateCameraNames,
      duplicateLocationIds: operational.duplicateLocationIds,
      unmappedCameraNames: resolved.unmappedCameraNames,
      unmappedLocationIds: resolved.unmappedLocationIds,
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

function hourlyKey(row: OtsExportRow): {
  key: string;
  hour: number;
} | null {
  const locationId =
    typeof row.location_id === 'number' && Number.isFinite(row.location_id)
      ? row.location_id
      : 0;
  if (locationId <= 0 || typeof row.period_start !== 'string') return null;
  const match = row.period_start.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/,
  );
  if (!match) return null;
  const hour = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return { key: `${locationId}|${match[1]}`, hour };
}

function buildHourlyOperationalIndex(
  rows: readonly OtsExportRow[],
): Map<string, HourlyOperationalAggregate> {
  const index = new Map<string, HourlyOperationalAggregate>();

  for (const row of rows) {
    const parsed = hourlyKey(row);
    if (!parsed) continue;
    if (
      parsed.hour < CAMERA_HEALTH_OPERATIONAL_START_HOUR ||
      parsed.hour >= CAMERA_HEALTH_OPERATIONAL_END_HOUR
    ) {
      continue;
    }

    const current = index.get(parsed.key) ?? {
      measuredHours: new Set<number>(),
      otsHours: new Set<number>(),
      ots: 0,
      coreMeasuredHours: new Set<number>(),
      coreOtsHours: new Set<number>(),
      coreOts: 0,
    };
    const duration =
      typeof row.duration === 'number' && Number.isFinite(row.duration)
        ? row.duration
        : 0;
    const ots =
      typeof row.ots_count === 'number' && Number.isFinite(row.ots_count)
        ? row.ots_count
        : 0;

    if (duration > 0) current.measuredHours.add(parsed.hour);
    if (ots > 0) current.otsHours.add(parsed.hour);
    current.ots += ots;

    if (parsed.hour >= CAMERA_HEALTH_CORE_START_HOUR) {
      if (duration > 0) current.coreMeasuredHours.add(parsed.hour);
      if (ots > 0) current.coreOtsHours.add(parsed.hour);
      current.coreOts += ots;
    }

    index.set(parsed.key, current);
  }

  return index;
}

function minHour(values: ReadonlySet<number>): number | null {
  if (values.size === 0) return null;
  return Math.min(...values);
}

function maxHour(values: ReadonlySet<number>): number | null {
  if (values.size === 0) return null;
  return Math.max(...values);
}

export function buildCameraHealthRecords(
  scope: CameraHealthScope,
  dates: string[],
  otsRows: OtsExportRow[],
  viewerRows: ViewerExportRow[],
  hourlyOtsRows: OtsExportRow[],
  computedAt: number,
): CameraHealthRecord[] {
  const { cameraDays } = buildMeasurementRows(
    scope.pairs,
    dates,
    otsRows,
    viewerRows,
  );
  const hourly = buildHourlyOperationalIndex(hourlyOtsRows);

  return cameraDays
    .map((row) => {
      const operational = hourly.get(`${row.locationId}|${row.date}`);
      const measuredHours = operational?.measuredHours ?? new Set<number>();
      const otsHours = operational?.otsHours ?? new Set<number>();
      return {
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
        operationalWindowStartHour: CAMERA_HEALTH_OPERATIONAL_START_HOUR,
        operationalGraceUntilHour: CAMERA_HEALTH_CORE_START_HOUR,
        operationalWindowEndHour: CAMERA_HEALTH_OPERATIONAL_END_HOUR,
        expectedOperationalHours: CAMERA_HEALTH_EXPECTED_OPERATIONAL_HOURS,
        expectedCoreHours: CAMERA_HEALTH_EXPECTED_CORE_HOURS,
        operationalMeasuredHours: measuredHours.size,
        operationalOtsHours: otsHours.size,
        coreMeasuredHours: operational?.coreMeasuredHours.size ?? 0,
        coreOtsHours: operational?.coreOtsHours.size ?? 0,
        firstMeasuredHour: minHour(measuredHours),
        lastMeasuredHour: maxHour(measuredHours),
        firstOtsHour: minHour(otsHours),
        lastOtsHour: maxHour(otsHours),
        operationalOts: operational?.ots ?? 0,
        coreOts: operational?.coreOts ?? 0,
        computedAt,
      };
    })
    .sort((a, b) =>
      `${a.date}|${a.locationId}`.localeCompare(
        `${b.date}|${b.locationId}`,
      ),
    );
}
