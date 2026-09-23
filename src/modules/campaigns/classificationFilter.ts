import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import { campaignIdentity, type StoredCampaign } from './campaignDiff';
import {
  classifyFromTipo,
  type AutoClassification,
} from '@/modules/operational-tracking/campaignClassification';

/**
 * Filtro Institucional / Proveedor / Pendiente de la sección Campañas.
 *
 * Mismo criterio que Seguimiento operativo: manda la clasificación guardada en
 * `campaignOperationalTracking` (por `campaign.id`, o el documento legacy por
 * identidad); si no existe, se deduce de `tipo` ("Tipo de Campaña" del
 * calendario) con `classifyFromTipo`. Nunca se asume Proveedor: lo ambiguo
 * queda como `unknown` (Pendiente).
 */

export type ClassificationFilter = AutoClassification | 'all';

export const CLASSIFICATION_FILTER_OPTIONS: ReadonlyArray<{
  value: ClassificationFilter;
  label: string;
}> = [
  { value: 'all', label: 'Todas' },
  { value: 'provider', label: 'Proveedor' },
  { value: 'institutional', label: 'Institucional' },
  { value: 'unknown', label: 'Pendiente' },
];

/** Clasificación efectiva por `campaign.id`. */
export function resolveClassifications(
  campaigns: readonly StoredCampaign[],
  tracking: readonly CampaignOperationalTracking[],
): Map<string, AutoClassification> {
  const byId = new Map<string, CampaignOperationalTracking>();
  const legacyByKey = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) {
    if (t.campaignId) byId.set(t.campaignId, t);
    else legacyByKey.set(t.campaignNameKey, t);
  }
  const out = new Map<string, AutoClassification>();
  for (const c of campaigns) {
    const t = byId.get(c.id) ?? legacyByKey.get(campaignIdentity(c)) ?? null;
    out.set(c.id, t ? t.classification : classifyFromTipo(c.tipo));
  }
  return out;
}

export function matchesClassification(
  classification: AutoClassification | undefined,
  filter: ClassificationFilter,
): boolean {
  if (filter === 'all') return true;
  return (classification ?? 'unknown') === filter;
}
