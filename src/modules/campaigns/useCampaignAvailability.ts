import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getQuividiCampaignAvailability,
  type QuividiCampaignAvailability,
} from '@/services/quividi';

interface AvailabilityCache {
  version: number;
  items: Map<string, QuividiCampaignAvailability | null>;
  failed: Set<string>;
  pending: Set<string>;
}

/** Cobertura solo de la página visible; caché de sesión, invalidada al actualizar. */
export function useCampaignAvailability(
  campaignIds: readonly string[],
  enabled: boolean,
  version: number,
) {
  const idsKey = JSON.stringify(campaignIds);
  const ids = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const cache = useMemo<AvailabilityCache>(
    () => ({
      version,
      items: new Map(),
      failed: new Set(),
      pending: new Set(),
    }),
    [version],
  );
  const currentCache = useRef(cache);
  const mounted = useRef(false);
  const [, render] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    currentCache.current = cache;
    if (!enabled) return;
    const missing = ids.filter(
      (id) =>
        !cache.items.has(id) && !cache.pending.has(id) && !cache.failed.has(id),
    );
    if (missing.length === 0) return;
    missing.forEach((id) => cache.pending.add(id));
    void getQuividiCampaignAvailability(missing)
      .then((items) => {
        const byId = new Map(items.map((item) => [item.campaignId, item]));
        missing.forEach((id) => cache.items.set(id, byId.get(id) ?? null));
      })
      .catch(() => {
        missing.forEach((id) => cache.failed.add(id));
      })
      .finally(() => {
        missing.forEach((id) => cache.pending.delete(id));
        if (mounted.current && currentCache.current === cache)
          render((n) => n + 1);
      });
  }, [ids, enabled, cache]);

  return {
    items: cache.items,
    failed: cache.failed,
    loaded: (id: string) => cache.items.has(id) || cache.failed.has(id),
  };
}
