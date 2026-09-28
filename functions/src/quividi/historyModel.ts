import { createHash } from 'node:crypto';
import type { ScreenDoc } from './effectiveScope';
import { normalizedStoreCode } from './measurementPoint';

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

export interface StoreBinding {
  locationId: number;
  storeId: string;
  storeName: string;
  support: string;
  pointId: string;
  validFrom: string;
  validTo: string | null;
  source: 'catalog' | 'catalog_inferred' | 'manual';
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
    if (!store || !support) continue;
    for (const [rawId, pointId] of [
      [screen.metadata?.quividiLocationId, screen.metadata?.measurementPointId],
      [screen.metadata?.quividiLocationId2, screen.metadata?.measurementPointId2],
    ] as const) {
      if (typeof rawId !== 'number' || !locationIds.has(rawId) || !pointId) continue;
      if (!pointId.trim().startsWith(`LIV-${store}-`)) {
        invalid.add(rawId);
        continue;
      }
      const binding: StoreBinding = {
        locationId: rawId,
        storeId: `LIV-${store}`,
        storeName: screen.original?.['Nombre de tienda']?.trim() ?? '',
        support,
        pointId: pointId.trim(),
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
    const unique = new Map(group.map((item) => [item.pointId, item]));
    if (unique.size !== 1 || invalid.has(id)) conflicts.push(id);
    else candidates.push([...unique.values()][0]!);
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
