import { createHash } from 'node:crypto';
import type { ScreenDoc } from './effectiveScope';
import { buildBackendMeasurementPointId, normalizedStoreCode } from './measurementPoint';

/** The only VidiCenter network this pipeline may read. */
export const LIVERPOOL_NETWORK_ID = 3089;
export const HISTORY_START_DATE = '2026-01-01';

/** One export at its finest useful resolution, not every redundant roll-up. */
export const HISTORY_EXPORTS = [
  { type: 'viewers', resolution: 'finest' },
  { type: 'viewers', resolution: '1h' },
  { type: 'ots', resolution: '5m' },
  { type: 'ots', resolution: '1h' },
  { type: 'viewers_apc', resolution: 'finest' },
  { type: 'content_plays', resolution: '1h' },
  { type: 'content_plays', resolution: '5m' },
  { type: 'compass', resolution: '1h' },
  { type: 'extrapolated_ots', resolution: '1h' },
  { type: 'extrapolated_watchers', resolution: '1h' },
  { type: 'footfall', resolution: '1h' },
  { type: 'footfall', resolution: 'finest' },
  { type: 'gate', resolution: '1h' },
  { type: 'gate', resolution: '5m' },
  { type: 'im', resolution: '1h' },
  { type: 'im_nobackup', resolution: '1h' },
  { type: 'im_ots', resolution: '1h' },
  { type: 'im_ots_nobackup', resolution: '1h' },
  { type: 'targeted_im', resolution: '1h' },
  { type: 'pmp_sales_by_demographics', resolution: '1h' },
  { type: 'pmp_sales_funnel', resolution: '1h' },
  { type: 'proof_of_play_by_location_footfall_faces', resolution: '1h' },
  { type: 'proof_of_play_by_location', resolution: '1h' },
  { type: 'proof_of_play_by_site_footfall_faces', resolution: '1h' },
  { type: 'proof_of_play_by_site', resolution: '1h' },
  { type: 'proof_of_play_vehicle_person_by_location', resolution: '1h' },
  { type: 'proof_of_play_vehicle_person_by_site', resolution: '1h' },
  { type: 'vehicles_footfall', resolution: '1h' },
  { type: 'vehicles', resolution: '1h' },
  { type: 'vehicles', resolution: 'finest' },
  { type: 'retail_analytics_footfall', resolution: '1h' },
  { type: 'retail_analytics_footfall', resolution: 'finest' },
  { type: 'retail_analytics_footfall_aggregated', resolution: '1h' },

] as const;

export const CONSUMER_HISTORY_EXPORTS = [
  { type: 'ots', resolution: '1d' },
  { type: 'viewers', resolution: '1d' },
  { type: 'viewers_demographics', resolution: '1d' },
] as const;

/** Audience or traffic rows establish measurement; playback and estimates do not. */
const MEASUREMENT_TYPES = new Set([
  'viewers', 'viewers_demographics', 'ots', 'viewers_apc', 'compass', 'footfall', 'gate',
  'vehicles', 'vehicles_footfall', 'retail_analytics_footfall',
  'retail_analytics_footfall_aggregated',
]);

export function isMeasurementExport(type: string): boolean {
  return MEASUREMENT_TYPES.has(type);
}

export function earliestMeasuredDate(
  previous: string | null,
  date: string,
  type: string,
  rowCount: number,
): string | null {
  if (rowCount <= 0 || !isMeasurementExport(type)) return previous;
  return previous && previous < date ? previous : date;
}


export interface HistoryRangeTask {
  startDate: string;
  endDate: string;
  locationId: number;
  type: string;
  resolution: string;
  siteId?: number;
}

export function historyDateRange(startDate: string, endDate: string): string[] {
  const result: string[] = [];
  const end = Date.parse(`${endDate}T00:00:00Z`);
  for (let cursor = Date.parse(`${startDate}T00:00:00Z`); cursor <= end; cursor += 86_400_000) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return result;
}

export function historyRowCivilDate(row: Record<string, unknown>): string | null {
  for (const key of ['period_start', 'start', 'date', 'timestamp', 'datetime']) {
    const value = row[key];
    if (typeof value !== 'string') continue;
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1]!;
  }
  return null;
}

export function historyMonthRangeAt(
  index: number,
  startMonth: string,
  locationIds: readonly number[],
  plan: readonly { type: string; resolution: string }[],
  maxDate: string,
): HistoryRangeTask | null {
  if (!locationIds.length || !plan.length || index < 0) return null;
  const exportIndex = index % plan.length;
  const locationIndex = Math.floor(index / plan.length) % locationIds.length;
  const monthIndex = Math.floor(index / (plan.length * locationIds.length));
  const start = new Date(`${startMonth.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + monthIndex);
  const startDate = start.toISOString().slice(0, 10);
  if (startDate > maxDate) return null;
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  const monthEnd = end.toISOString().slice(0, 10);
  return {
    startDate,
    endDate: monthEnd < maxDate ? monthEnd : maxDate,
    locationId: locationIds[locationIndex]!,
    ...plan[exportIndex]!,
  };
}

export interface StoreBinding {
  locationId: number;
  storeId: string;
  storeName: string;
  support: string;
  pointId: string | null;
  validFrom: string;
  validTo: string | null;
  source: 'catalog' | 'catalog_inferred' | 'manual';
}

export interface HistoryCatalogStore {
  storeId: string;
  number: string;
  name: string;
  supports: string[];
}

/** Includes inactive screens and stores without cameras; never invents a store/support. */
export function historyCatalogStores(screens: readonly ScreenDoc[]): HistoryCatalogStore[] {
  const stores = new Map<string, HistoryCatalogStore>();
  for (const screen of screens) {
    const number = normalizedStoreCode(screen.original?.['Numero de Tienda'] ?? '');
    if (!number || Number(number) === 0) continue;
    const storeId = `LIV-${number}`;
    const name = screen.original?.['Nombre de tienda']?.trim() ?? '';
    const store = stores.get(storeId) ?? { storeId, number, name, supports: [] };
    if (!store.name && name) store.name = name;
    const support = screen.metadata?.calendarSupport?.trim() ?? '';
    if (support && !store.supports.includes(support)) store.supports.push(support);
    stores.set(storeId, store);
  }
  return [...stores.values()].map((store) => ({
    ...store, supports: store.supports.sort((a, b) => a.localeCompare(b, 'es')),
  })).sort((a, b) => Number(a.number) - Number(b.number));
}

export function validHistoryCatalogSelection(
  stores: readonly HistoryCatalogStore[], storeId: string, support: string, pointId: string | null,
): boolean {
  if (!stores.some((store) => store.storeId === storeId && store.supports.includes(support))) return false;
  return !pointId || buildBackendMeasurementPointId({
    storeNumber: storeId.replace(/^LIV-/, ''), support,
    pointCode: pointId.split('-').at(-1) ?? '',
  }) === pointId;
}

/** Preserve evidence outside a manually replaced range; reject ambiguous human evidence. */
export function replaceHistoricalBinding(
  existing: readonly StoreBinding[], binding: StoreBinding,
): StoreBinding[] {
  const result: StoreBinding[] = [];
  const shift = (date: string, days: number) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  for (const other of existing) {
    if (other.locationId !== binding.locationId) { result.push(other); continue; }
    if (other.source === 'catalog_inferred') continue;
    if (other.source === 'manual' && other.validFrom === binding.validFrom) continue;
    const overlaps = (binding.validTo === null || other.validFrom <= binding.validTo) &&
      (other.validTo === null || other.validTo >= binding.validFrom);
    if (!overlaps) { result.push(other); continue; }
    if (other.source === 'manual') throw new RangeError('La vigencia se superpone con otro vínculo de tienda.');
    if (other.validFrom < binding.validFrom) {
      result.push({ ...other, validTo: shift(binding.validFrom, -1) });
    }
    if (binding.validTo && (!other.validTo || other.validTo > binding.validTo)) {
      result.push({ ...other, validFrom: shift(binding.validTo, 1) });
    }
  }
  return [...result, binding];
}

/** The current catalog is a useful historical hypothesis, never source evidence. */
export function inferredCatalogBinding(binding: StoreBinding): StoreBinding | null {
  if (binding.source !== 'catalog' || binding.validFrom <= HISTORY_START_DATE) return null;
  const end = new Date(`${binding.validFrom}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    ...binding,
    validFrom: HISTORY_START_DATE,
    validTo: end.toISOString().slice(0, 10),
    source: 'catalog_inferred',
  };
}

/** Site-wide exports cannot safely be assigned to each location in that site. */
export function exportDataClass(type: string):
  'source' | 'derived' | 'site_aggregate' {
  if (type.includes('_by_site')) return 'site_aggregate';
  if (type.startsWith('extrapolated_') || type.startsWith('im') ||
      type === 'targeted_im') return 'derived';
  return 'source';
}

export function inventoryBindings(
  screens: readonly ScreenDoc[],
  locationIds: ReadonlySet<number>,
  observedOn: string,
): { candidates: StoreBinding[]; conflicts: number[] } {
  const byLocation = new Map<number, StoreBinding[]>();
  const invalid = new Set<number>();
  for (const screen of screens) {
    if (screen.metadata?.active === false) continue;
    const store = normalizedStoreCode(screen.original?.['Numero de Tienda'] ?? '');
    const support = screen.metadata?.calendarSupport?.trim() ?? '';
    if (!store || Number(store) === 0 || !support) continue;
    for (const [rawId, pointId] of [
      [screen.metadata?.quividiLocationId, screen.metadata?.measurementPointId],
      [screen.metadata?.quividiLocationId2, screen.metadata?.measurementPointId2],
    ] as const) {
      if (typeof rawId !== 'number' || !locationIds.has(rawId)) continue;
      if (pointId && !validHistoryCatalogSelection(historyCatalogStores([screen]), `LIV-${store}`, support, pointId.trim())) {
        invalid.add(rawId);
        continue;
      }
      const binding: StoreBinding = {
        locationId: rawId,
        storeId: `LIV-${store}`,
        storeName: screen.original?.['Nombre de tienda']?.trim() ?? '',
        support,
        pointId: pointId?.trim() || null,
        validFrom: observedOn,
        validTo: null,
        source: 'catalog',
      };
      const group = byLocation.get(rawId) ?? [];
      group.push(binding);
      byLocation.set(rawId, group);
    }
  }
  const candidates: StoreBinding[] = [];
  const conflicts: number[] = [];
  for (const [id, group] of byLocation) {
    const unique = new Map(group.map((item) => [`${item.storeId}|${item.support}`, item]));
    if (unique.size !== 1 || invalid.has(id)) conflicts.push(id);
    else {
      const candidate = [...unique.values()][0]!;
      const points = new Set(group.map((item) => item.pointId).filter(Boolean));
      candidates.push({ ...candidate, pointId: points.size === 1 ? [...points][0]! : null });
    }
  }
  for (const id of invalid) if (!byLocation.has(id)) conflicts.push(id);
  return { candidates, conflicts: conflicts.sort((a, b) => a - b) };
}

export function resolveHistoricalBinding(
  bindings: readonly StoreBinding[],
  locationId: number,
  date: string,
): StoreBinding | null {
  const matches = bindings.filter((item) =>
    item.locationId === locationId && item.validFrom <= date &&
    (item.validTo === null || date <= item.validTo),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Quividi makes no ordering guarantee; identical rows and their multiplicity remain. */
export function rowsFingerprint(rows: readonly Record<string, unknown>[]): string {
  return createHash('sha256')
    .update(rows.map(canonical).sort().join('\n'))
    .digest('hex');
}

export function historyPartitionId(
  locationId: number,
  date: string,
  type: string,
  resolution: string,
): string {
  if (!Number.isInteger(locationId) || locationId < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^[a-z_]+$/.test(type) || !/^(finest|5m|1h)$/.test(resolution)) {
    throw new RangeError('Partición Quividi inválida.');
  }
  return `${LIVERPOOL_NETWORK_ID}__${locationId}__${date}__${type}__${resolution}`;
}

export function rawHistoryPath(partitionId: string, hash: string): string {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new RangeError('Huella inválida.');
  return `quividi-history/network-${LIVERPOOL_NETWORK_ID}/${partitionId}/${hash}.json.gz`;
}
