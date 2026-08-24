import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking } from './types';

/**
 * Campañas activas que quedaron sin documento de seguimiento, considerando la
 * llave estable actual (`campaignId`) y documentos legacy por identidad.
 */
export function campaignsMissingOperationalTracking(
  campaigns: readonly StoredCampaign[],
  tracking: readonly CampaignOperationalTracking[],
): StoredCampaign[] {
  const trackedCampaignIds = new Set(
    tracking.flatMap((item) => (item.campaignId ? [item.campaignId] : [])),
  );
  const legacyIdentities = new Set(
    tracking
      .filter((item) => !item.campaignId)
      .map((item) => item.campaignNameKey),
  );

  return campaigns.filter(
    (campaign) =>
      campaign.active !== false &&
      !trackedCampaignIds.has(campaign.id) &&
      !legacyIdentities.has(campaignIdentity(campaign)),
  );
}
