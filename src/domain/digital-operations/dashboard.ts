import type {
  DigitalOperationalItem,
  DigitalOperationalTracking,
} from './models';
import { DIGITAL_CHECK_KEYS, digitalProgress } from './tracking';
export function buildDigitalDashboard(
  items: readonly DigitalOperationalItem[],
  tracking: readonly DigitalOperationalTracking[],
) {
  const byTracking = new Map(tracking.map((t) => [t.operationalItemId, t]));
  const active = items.filter(
    (i) => i.active && byTracking.get(i.id)?.lifecycleStatus !== 'cancelled',
  );
  const cancelled = items.filter(
    (i) => byTracking.get(i.id)?.lifecycleStatus === 'cancelled',
  );
  const count = (values: string[]) =>
    Object.fromEntries(
      [...new Set(values)]
        .sort()
        .map((v) => [v, values.filter((x) => x === v).length]),
    );
  const progresses = active
    .map((i) => byTracking.get(i.id))
    .filter(Boolean)
    .map((t) => digitalProgress(t!) ?? 0);
  return {
    activeItems: active.length,
    cancelledItems: cancelled.length,
    averageProgress: progresses.length
      ? progresses.reduce((a, b) => a + b, 0) / progresses.length
      : 0,
    pendingByCheck: Object.fromEntries(
      DIGITAL_CHECK_KEYS.map((k) => [
        k,
        active.filter((i) => !byTracking.get(i.id)?.checks[k].completed).length,
      ]),
    ),
    distinctCampaigns: new Set(active.map((i) => i.campaignNumber)).size,
    byRetailer: count(active.map((i) => i.retailerLabel)),
    bySupport: count(active.map((i) => i.supportLabel)),
    byPeriod: count(active.map((i) => i.periodId)),
    byPlacementMode: count(active.map((i) => i.placementMode)),
    totalCenters: active.reduce((s, i) => s + i.centers, 0),
    totalSupports: active.reduce((s, i) => s + i.supports, 0),
    byClientAdvertiser: count(
      active.map((i) => `${i.client} / ${i.advertiser}`),
    ),
  };
}
