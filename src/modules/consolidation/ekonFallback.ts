import { classifySupport, type SupportOwner } from '@/domain';
import {
  collectOperativeStores,
  planFallbackSupports,
  type EkonAssignment,
  type FallbackIssue,
  type SyntheticSupport,
} from '@/domain/ekon';
import type {
  ParsedCampaign,
  CampaignSupport,
} from '@/modules/liverpool-import/campaignParse';

/**
 * Integración del fallback Ekon con la consolidación existente.
 *
 * En lugar de reimplementar la generación de CSV, el fallback SOLO añade
 * "soportes sintéticos" (`MEGA MUPI DIGITAL` / `BANNER DIGITAL`) a la campaña
 * Liverpool cuando corresponde. La consolidación normal los resuelve contra el
 * Master por `Numero de Tienda` + `NORMALIZACION LIVERPOOL`, conservando
 * encabezados, columna guarda, BOM, escape y llave `Campaña + RESOLUCION`.
 */

/** Datos Ekon necesarios para decidir el fallback de una campaña. */
export interface CampaignFallbackContext {
  /** Asignaciones Ekon VIGENTES del número vinculado (activas, sin conflicto). */
  assignments: readonly EkonAssignment[];
  hasEkonLink: boolean;
  hasCompletedBatch: boolean;
}

export interface CampaignFallbackResult {
  campaign: ParsedCampaign;
  added: SyntheticSupport[];
  issues: FallbackIssue[];
}

/** Soportes ya marcados en la campaña (texto literal). */
export function markedSupports(campaign: ParsedCampaign): string[] {
  return campaign.supports.map((s) => s.support);
}

/**
 * Convierte un soporte sintético en un `CampaignSupport` (owner Liverpool). El
 * `owner` se recalcula por seguridad; ambos soportes fallback son Liverpool.
 */
function toCampaignSupport(synthetic: SyntheticSupport): CampaignSupport {
  const owner: SupportOwner = classifySupport(synthetic.support);
  return {
    support: synthetic.support,
    owner,
    stores: synthetic.stores.map((s) => ({ numero: s.numero, nombre: '' })),
  };
}

/**
 * Aplica el fallback a UNA campaña: calcula el plan y devuelve la campaña
 * (posiblemente aumentada con soportes sintéticos) más lo añadido y las
 * incidencias. Puro. Si no aplica, devuelve la campaña sin cambios.
 */
export function applyCampaignFallback(
  campaign: ParsedCampaign,
  context: CampaignFallbackContext,
): CampaignFallbackResult {
  const plan = planFallbackSupports({
    markedSupports: markedSupports(campaign),
    assignments: context.assignments,
    operativeStores: collectOperativeStores(campaign.supports),
    hasCompletedBatch: context.hasCompletedBatch,
    hasEkonLink: context.hasEkonLink,
  });

  if (plan.syntheticSupports.length === 0) {
    return { campaign, added: [], issues: plan.issues };
  }

  return {
    campaign: {
      ...campaign,
      supports: [
        ...campaign.supports,
        ...plan.syntheticSupports.map(toCampaignSupport),
      ],
    },
    added: plan.syntheticSupports,
    issues: plan.issues,
  };
}

/**
 * Aplica el fallback a un conjunto de campañas usando el contexto Ekon por
 * campaña (`contextByRow`, indexado por `campaign.row`). Devuelve las campañas
 * aumentadas y el conjunto de incidencias de fallback.
 */
export function applyFallbackToCampaigns(
  campaigns: readonly ParsedCampaign[],
  contextByRow: ReadonlyMap<number, CampaignFallbackContext>,
): { campaigns: ParsedCampaign[]; issues: FallbackIssue[] } {
  const out: ParsedCampaign[] = [];
  const issues: FallbackIssue[] = [];
  for (const campaign of campaigns) {
    const context = contextByRow.get(campaign.row);
    if (!context) {
      out.push(campaign);
      continue;
    }
    const result = applyCampaignFallback(campaign, context);
    out.push(result.campaign);
    issues.push(...result.issues);
  }
  return { campaigns: out, issues };
}
