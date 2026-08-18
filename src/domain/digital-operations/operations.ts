import type {
  DigitalDiffState,
  DigitalOperationalItem,
  DigitalPlacementRow,
  DigitalSupportProfile,
} from './models';
import { hashText, stableKey } from './normalize';

export function aggregateOperationalItems(
  rows: readonly DigitalPlacementRow[],
  profiles: readonly DigitalSupportProfile[],
  batchId: string,
  now = Date.now(),
): DigitalOperationalItem[] {
  const groups = new Map<string, DigitalPlacementRow[]>();
  for (const row of rows) {
    const key = stableKey([
      row.year,
      row.campaignNumber,
      row.retailerCode,
      row.supportCode,
      row.creativityId,
      row.periodId,
    ]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([operationalKey, group]) => {
    const first = group[0]!;
    const compatible: (keyof DigitalPlacementRow)[] = [
      'client',
      'advertiser',
      'product',
      'periodStart',
      'periodEnd',
      'fixationStart',
      'fixationEnd',
      'placementMode',
    ];
    const invalid = compatible.filter(
      (key) => new Set(group.map((r) => JSON.stringify(r[key]))).size > 1,
    );
    if (invalid.length)
      throw new Error(
        `Elemento ${operationalKey} incompatible: ${invalid.join(', ')}.`,
      );
    const profile = profiles.find((p) => p.id === first.profileId);
    return {
      id: hashText(operationalKey),
      operationalKey,
      logicalFlightKey: first.logicalFlightKey,
      source: 'ekon-campaign-tracking' as const,
      retailerCode: first.retailerCode,
      retailerLabel: profile?.retailerLabel ?? first.retailerCode,
      supportCode: first.supportCode,
      supportLabel: profile?.supportLabel ?? first.supportCode,
      cmsName: profile?.cmsName ?? null,
      campaignNumber: first.campaignNumber,
      periodId: first.periodId,
      periodLabel: first.periodLabel,
      periodStart: first.periodStart,
      periodEnd: first.periodEnd,
      fixationStart: first.fixationStart,
      fixationEnd: first.fixationEnd,
      placementMode: first.placementMode,
      client: first.client,
      advertiser: first.advertiser,
      product: first.product,
      creativityId: first.creativityId,
      creativityTitle: first.creativityTitle,
      creativityStatus: first.creativityStatus,
      centers: group.reduce((sum, r) => sum + (r.centers ?? 0), 0),
      supports: group.reduce((sum, r) => sum + (r.supports ?? 0), 0),
      placementRowIds: group.map((r) => r.id),
      active: true,
      firstBatchId: batchId,
      lastBatchId: batchId,
      updatedAt: now,
    };
  });
}

export interface DigitalDiffEntry {
  state: DigitalDiffState;
  before: DigitalPlacementRow | null;
  after: DigitalPlacementRow;
}
export function diffPlacementRows(
  previous: readonly DigitalPlacementRow[],
  incoming: readonly DigitalPlacementRow[],
  confirmedPeriods: ReadonlySet<string>,
  batchId: string,
  now = Date.now(),
): DigitalDiffEntry[] {
  const old = new Map(previous.map((r) => [r.recordKey, r])),
    next = new Map(incoming.map((r) => [r.recordKey, r]));
  const result: DigitalDiffEntry[] = [];
  for (const row of incoming) {
    const before = old.get(row.recordKey);
    const state: DigitalDiffState = !before
      ? 'nueva'
      : !before.active
        ? 'restaurada'
        : before.fingerprint === row.fingerprint
          ? 'sin-cambios'
          : 'modificada';
    result.push({
      state,
      before: before ?? null,
      after: {
        ...row,
        id: before?.id ?? row.id,
        firstBatchId: before?.firstBatchId ?? batchId,
        lastBatchId: batchId,
        revision: before
          ? before.revision + (state === 'sin-cambios' ? 0 : 1)
          : 1,
        active: true,
        missingSinceBatchId: null,
        updatedAt: now,
      },
    });
  }
  for (const before of previous)
    if (
      !next.has(before.recordKey) &&
      before.active &&
      confirmedPeriods.has(before.periodId)
    )
      result.push({
        state: 'no-incluida',
        before,
        after: {
          ...before,
          active: false,
          lastBatchId: batchId,
          missingSinceBatchId: batchId,
          revision: before.revision + 1,
          updatedAt: now,
        },
      });
  return result;
}
