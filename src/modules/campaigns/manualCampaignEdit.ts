import {
  campaignKey,
  describeChanges,
  type StoredCampaign,
} from './campaignDiff';
import {
  campaignOrigin,
  type ManualCampaignInput,
  type ManualCampaignSupportInput,
} from './manualCampaign';
import {
  hasStoreDetail,
  isMupiPendonSupport,
} from '@/modules/consolidation/instoreEkon';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import { effectiveCampaignSupportScope } from '@/modules/liverpool-import/campaignParse';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

/**
 * Edición de campañas **manuales** (tiendas, soportes, vigencias, nombre, tipo,
 * link). Solo aplica mientras la campaña siga siendo manual: cuando el calendario
 * de Liverpool la adopta, manda Liverpool y las correcciones se hacen con
 * «Corregir» (que deja `manualOverrides`). Cada edición exige un motivo y queda
 * en el historial append-only de la campaña.
 */

/** Motivo por el que una campaña no se puede editar como manual; `null` si sí. */
export function manualEditBlocker(campaign: StoredCampaign): string | null {
  if (campaignOrigin(campaign) !== 'manual') {
    return 'Esta campaña ya no es manual (la adoptó el calendario de Liverpool). Usa «Corregir».';
  }
  if (campaign.active === false) {
    return 'La campaña está inactiva.';
  }
  return null;
}

function toIso(value: string): string {
  return parseCampaignDate(value)?.toISOString().slice(0, 10) ?? value;
}

/** Precarga el formulario con los datos guardados de una campaña manual. */
export function campaignToManualInput(
  campaign: StoredCampaign,
): ManualCampaignInput {
  const supports: ManualCampaignSupportInput[] = campaign.supports.map((s) => {
    const effective = effectiveCampaignSupportScope(s);
    const scope: ManualCampaignSupportInput['scope'] =
      effective !== 'all'
        ? 'selected'
        : isMupiPendonSupport(s.support) && !hasStoreDetail(s)
          ? 'ekon'
          : 'all';
    return {
      support: s.support,
      scope,
      stores: scope === 'selected' ? s.stores : [],
    };
  });
  return {
    name: campaign.name,
    tipo: campaign.tipo,
    fechaInicio: toIso(campaign.fechaInicio),
    fechaFin: toIso(campaign.fechaFin),
    link: campaign.link,
    vendidoPor: campaign.vendidoPor,
    supports,
  };
}

/** Cambios legibles entre la versión guardada y la editada (vacío = sin cambios). */
export function manualEditChanges(
  before: ParsedCampaign,
  after: ParsedCampaign,
): string[] {
  return describeChanges(before, after);
}

export function manualEditComment(
  changes: readonly string[],
  reason: string,
  actorEmail: string,
  at: number,
): string {
  return `Edición de campaña manual: ${changes.join('; ')}. Motivo: ${reason.trim()}. Realizada por ${actorEmail || 'usuario sin correo'} el ${new Date(at).toISOString()}.`;
}

/** ¿La campaña ya tiene testigos marcados? Sirve para avisar antes de cambiar tiendas o fechas. */
export function hasMarkedWitnesses(
  tracking:
    | {
        witnessStart?: { completed: boolean };
        witnessComplete?: { completed: boolean };
      }
    | null
    | undefined,
): boolean {
  return (
    !!tracking?.witnessStart?.completed ||
    !!tracking?.witnessComplete?.completed
  );
}

/** Llave de nombre usada por `campaigns.nameKey`. */
export function manualNameKey(name: string): string {
  return campaignKey(name);
}
