import { normalizeSupport } from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import { effectiveCampaignSupportScope } from '@/modules/liverpool-import/campaignParse';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';

export function campaignQuividiCoverage(
  campaign: StoredCampaign,
  screens: readonly AdmiraScreen[],
): { coveredPairs: number; totalPairs: number } {
  let coveredPairs = 0;
  let totalPairs = 0;

  for (const support of campaign.supports) {
    const supportName = normalizeSupport(support.support);
    const supportScreens = screens.filter(
      (screen) =>
        screen.metadata.active !== false &&
        normalizeSupport(screen.metadata.calendarSupport ?? '') === supportName,
    );
    const scope = effectiveCampaignSupportScope(support);
    const stores =
      scope === 'all'
        ? Array.from(
            new Set(
              supportScreens.map((screen) =>
                normalizeStore(screen.original['Numero de Tienda']),
              ),
            ),
          ).filter(Boolean)
        : scope === 'selected'
          ? Array.from(
              new Set(
                support.stores.map((store) => normalizeStore(store.numero)),
              ),
            ).filter(Boolean)
          : [];

    for (const store of stores) {
      totalPairs += 1;
      const hasCamera = supportScreens.some(
        (screen) =>
          normalizeStore(screen.original['Numero de Tienda']) === store &&
          Boolean(screen.metadata.quividiCameraName?.trim()),
      );
      if (hasCamera) coveredPairs += 1;
    }
  }
  return { coveredPairs, totalPairs };
}

export function campaignHasQuividiCoverage(
  campaign: StoredCampaign,
  screens: readonly AdmiraScreen[],
): boolean {
  return campaignQuividiCoverage(campaign, screens).coveredPairs > 0;
}
