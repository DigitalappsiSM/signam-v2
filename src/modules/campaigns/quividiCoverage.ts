import type { AdmiraScreen } from '@/domain';
import { normalizeSupport } from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import {
  effectiveCampaignSupportScope,
  type CampaignSupport,
} from '@/modules/liverpool-import/campaignParse';

export interface QuividiCampaignLike {
  supports: CampaignSupport[];
}

export interface QuividiSupportPair {
  storeNumber: string;
  storeName: string;
  support: string;
  cameraNames: string[];
}

function activeScreen(screen: AdmiraScreen): boolean {
  return screen.metadata.active !== false;
}

function screenPairKey(screen: AdmiraScreen): string {
  return [
    normalizeStore(screen.original['Numero de Tienda']),
    normalizeSupport(screen.metadata.calendarSupport ?? ''),
  ].join('|');
}

export function quividiPairsForCampaign(
  campaign: QuividiCampaignLike,
  screens: readonly AdmiraScreen[],
): QuividiSupportPair[] {
  const active = screens.filter(activeScreen);
  const screensByPair = new Map<string, AdmiraScreen[]>();
  for (const screen of active) {
    const key = screenPairKey(screen);
    const list = screensByPair.get(key) ?? [];
    list.push(screen);
    screensByPair.set(key, list);
  }

  const pairs = new Map<string, QuividiSupportPair>();
  for (const campaignSupport of campaign.supports) {
    const support = normalizeSupport(campaignSupport.support);
    if (!support) continue;
    const scope = effectiveCampaignSupportScope(campaignSupport);
    if (scope === 'invalid') continue;

    const stores =
      scope === 'all'
        ? Array.from(
            new Set(
              active
                .filter(
                  (screen) =>
                    normalizeSupport(screen.metadata.calendarSupport ?? '') ===
                    support,
                )
                .map((screen) =>
                  normalizeStore(screen.original['Numero de Tienda']),
                )
                .filter(Boolean),
            ),
          )
        : campaignSupport.stores
            .map((store) => normalizeStore(store.numero))
            .filter(Boolean);

    for (const storeNumber of stores) {
      const key = [storeNumber, support].join('|');
      const matching = screensByPair.get(key) ?? [];
      const cameraNames = Array.from(
        new Set(
          matching
            .flatMap((screen) => [
              screen.metadata.quividiCameraName?.trim() ?? '',
              screen.metadata.quividiCameraName2?.trim() ?? '',
            ])
            .filter(Boolean),
        ),
      );
      const storeName =
        matching
          .map((screen) => screen.original['Nombre de tienda']?.trim())
          .find(Boolean) ?? '';
      pairs.set(key, {
        storeNumber,
        storeName,
        support,
        cameraNames,
      });
    }
  }
  return Array.from(pairs.values());
}

export function hasQuividiCoverage(
  campaign: QuividiCampaignLike,
  screens: readonly AdmiraScreen[],
): boolean {
  return quividiPairsForCampaign(campaign, screens).some(
    (pair) => pair.cameraNames.length > 0,
  );
}
