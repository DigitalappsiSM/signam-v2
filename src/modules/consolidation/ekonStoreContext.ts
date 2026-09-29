import type { StoredEkonAssignment } from '@/domain/ekon';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import { listActiveAssignmentsByEkonNumber } from '@/services/ekonAssignments';
import { hasCompletedBatch } from '@/services/ekonImports';
import {
  ekonNumberForCampaign,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';
import {
  hasStoreDetail,
  isMupiPendonSupport,
  type EkonStoreContext,
} from './instoreEkon';

/**
 * Carga del contexto Ekon que necesita `resolveCampaignsWithEkon`. Solo consulta
 * Ekon cuando alguna campaña tiene Mupi/Pendón sin detalle; el resto de las
 * pantallas no paga ninguna lectura extra.
 */

export interface LoadedEkonContext {
  /** Asignaciones vigentes por número de campaña Ekon. */
  assignments: ReadonlyMap<string, StoredEkonAssignment[]>;
  hasCompletedBatch: boolean;
}

export const EMPTY_EKON_CONTEXT: LoadedEkonContext = {
  assignments: new Map(),
  hasCompletedBatch: false,
};

/** Campañas con algún Mupi/Pendón sin detalle de tiendas. */
export function campaignsNeedingEkon<T extends StoredCampaign>(
  campaigns: readonly T[],
): T[] {
  return campaigns.filter((campaign) =>
    campaign.supports.some(
      (s) => isMupiPendonSupport(s.support) && !hasStoreDetail(s),
    ),
  );
}

/** Lee lote y asignaciones de las campañas que lo necesitan. Puede lanzar. */
export async function loadEkonStoreContext(
  campaigns: readonly StoredCampaign[],
  links: readonly CampaignEkonLink[],
): Promise<LoadedEkonContext> {
  const needy = campaignsNeedingEkon(campaigns);
  if (needy.length === 0) return EMPTY_EKON_CONTEXT;

  const numbers = new Set<string>();
  for (const campaign of needy) {
    const number = ekonNumberForCampaign(campaign, links);
    if (number != null) numbers.add(String(number));
  }
  const batch = await hasCompletedBatch();
  const map = new Map<string, StoredEkonAssignment[]>();
  const all = [...numbers];
  // Evita disparar decenas de consultas simultáneas contra Firestore.
  for (let i = 0; i < all.length; i += 8) {
    const chunk = all.slice(i, i + 8);
    const rows = await Promise.all(
      chunk.map((n) => listActiveAssignmentsByEkonNumber(n)),
    );
    chunk.forEach((n, offset) => map.set(n, rows[offset] ?? []));
  }
  return { assignments: map, hasCompletedBatch: batch };
}

/** Contexto Ekon de UNA campaña a partir de lo ya cargado. */
export function ekonContextFor(
  campaign: StoredCampaign,
  links: readonly CampaignEkonLink[],
  loaded: LoadedEkonContext,
  available: boolean,
): EkonStoreContext {
  const number = ekonNumberForCampaign(campaign, links);
  return {
    available,
    hasEkonLink: number != null,
    hasCompletedBatch: loaded.hasCompletedBatch,
    assignments:
      number != null ? (loaded.assignments.get(String(number)) ?? []) : [],
  };
}
