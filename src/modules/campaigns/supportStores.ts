import { normalizeSupport } from '@/domain';
import {
  hasStoreDetail,
  isMupiPendonSupport,
} from '@/modules/consolidation/instoreEkon';
import type { ConsolidationIssue } from '@/modules/consolidation/consolidate';
import type {
  CampaignSupport,
  ParsedCampaign,
  StoreRef,
} from '@/modules/liverpool-import/campaignParse';

/**
 * Tiendas finales de un soporte para el detalle de campaña («ojito»).
 *
 * - `calendar`: el soporte trae su detalle desde el Calendario Liverpool (o
 *   una captura manual) y se muestra tal cual.
 * - `ekon`: Mupi/Pendón sin detalle cuyas tiendas se tomaron de la campaña
 *   Ekon vinculada (`resolveNoDetailSupports`), igual que el CSV y Quividi.
 * - `blocked`: Mupi/Pendón sin detalle que no pudo resolverse; `issue` explica
 *   por qué (sin vínculo, sin lote o Ekon sin tiendas del soporte).
 * - `pending`: aún no hay resolución Ekon (cargando, sin acceso a Ekon o la
 *   campaña quedó fuera del periodo consultado).
 *
 * Pura: recibe el soporte original y la campaña ya resuelta por la misma
 * función que alimenta la consolidación, para que el detalle muestre las
 * mismas tiendas que van al CSV.
 */
export type SupportStoreSource =
  | { kind: 'calendar' }
  | { kind: 'ekon'; stores: StoreRef[] }
  | { kind: 'blocked'; issue: ConsolidationIssue }
  | { kind: 'pending' };

export function supportStoreSource(
  support: CampaignSupport,
  resolved: Pick<ParsedCampaign, 'supports'> | undefined,
  issues: readonly ConsolidationIssue[],
): SupportStoreSource {
  if (!isMupiPendonSupport(support.support) || hasStoreDetail(support)) {
    return { kind: 'calendar' };
  }
  const key = normalizeSupport(support.support);
  const fromEkon = resolved?.supports.find(
    (s) =>
      s.scopeSource === 'resolution-selected' &&
      normalizeSupport(s.support) === key,
  );
  if (fromEkon) return { kind: 'ekon', stores: fromEkon.stores };
  const issue = issues.find(
    (i) =>
      i.code.startsWith('ekon-') &&
      !i.store &&
      normalizeSupport(i.support) === key,
  );
  if (issue) return { kind: 'blocked', issue };
  return { kind: 'pending' };
}
