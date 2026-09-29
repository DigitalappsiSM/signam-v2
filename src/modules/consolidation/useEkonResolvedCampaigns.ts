import { useEffect, useMemo, useState } from 'react';
import type { UserRole } from '@/domain';
import { can } from '@/app/permissions';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  listEkonLinks,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';
import {
  campaignsNeedingEkon,
  ekonContextFor,
  loadEkonStoreContext,
  EMPTY_EKON_CONTEXT,
  type LoadedEkonContext,
} from './ekonStoreContext';
import { resolveCampaignsWithEkon } from './instoreEkon';
import type { ConsolidationIssue } from './consolidate';

/**
 * Devuelve las campañas con los Mupi/Pendón sin detalle ya resueltos con las
 * tiendas de Ekon, para que Seguimiento y el dashboard calculen tiendas y metas
 * de testigos igual que el CSV.
 *
 * - Roles que no pueden leer Ekon (comercial): esos soportes se retiran sin
 *   incidencia; nunca se expanden a todo el catálogo.
 * - Mientras carga Ekon (o si falla la lectura) ocurre lo mismo.
 */
export function useEkonResolvedCampaigns(
  campaigns: readonly StoredCampaign[],
  role: UserRole,
): { campaigns: StoredCampaign[]; issues: ConsolidationIssue[] } {
  const readable = can(role, 'reconciliation.read');
  const needsEkon = useMemo(
    () => campaignsNeedingEkon(campaigns).length > 0,
    [campaigns],
  );
  const [state, setState] = useState<{
    links: CampaignEkonLink[];
    loaded: LoadedEkonContext;
    ok: boolean;
  }>({ links: [], loaded: EMPTY_EKON_CONTEXT, ok: false });

  useEffect(() => {
    if (!readable || !needsEkon) return;
    let cancelled = false;
    void (async () => {
      try {
        const links = await listEkonLinks();
        const loaded = await loadEkonStoreContext(campaigns, links);
        if (!cancelled) setState({ links, loaded, ok: true });
      } catch {
        if (!cancelled) {
          setState({ links: [], loaded: EMPTY_EKON_CONTEXT, ok: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaigns, readable, needsEkon]);

  return useMemo(
    () =>
      resolveCampaignsWithEkon(campaigns, (campaign) =>
        ekonContextFor(
          campaign,
          state.links,
          state.loaded,
          readable && state.ok,
        ),
      ),
    [campaigns, state, readable],
  );
}
