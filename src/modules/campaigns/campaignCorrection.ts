import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import { parseCampaignDate } from './dateFilter';

export const EDITABLE_CAMPAIGN_FIELDS = [
  'fechaInicio',
  'fechaFin',
  'link',
  'mes',
  'vendidoPor',
  'tipo',
] as const;

export type EditableCampaignField = (typeof EDITABLE_CAMPAIGN_FIELDS)[number];

export const CAMPAIGN_FIELD_LABELS: Record<EditableCampaignField, string> = {
  fechaInicio: 'Fecha de inicio',
  fechaFin: 'Fecha de fin',
  link: 'Link de contenido',
  mes: 'Mes',
  vendidoPor: 'Vendido por',
  tipo: 'Tipo de campaña',
};

export interface CampaignManualOverride {
  value: string;
  reason: string;
  correctedAt: number;
  correctedByUid: string;
  correctedByEmail: string;
}

export type CampaignManualOverrides = Partial<
  Record<EditableCampaignField, CampaignManualOverride>
>;

export interface CampaignCorrectionChange {
  field: EditableCampaignField;
  label: string;
  before: string;
  after: string;
}

export interface CampaignCorrectionEvent {
  id: string;
  campaignId: string;
  campaignName: string;
  changes: CampaignCorrectionChange[];
  reason: string;
  comment: string;
  actorUid: string;
  actorEmail: string;
  at: number;
}

export type CampaignCorrectionValues = Partial<
  Record<EditableCampaignField, string>
>;

/** Aplica correcciones activas sobre una fila importada. */
export function applyManualOverrides(
  campaign: ParsedCampaign,
  overrides?: CampaignManualOverrides,
): ParsedCampaign {
  if (!overrides) return campaign;
  const next = { ...campaign };
  for (const field of EDITABLE_CAMPAIGN_FIELDS) {
    const override = overrides[field];
    if (override) next[field] = override.value;
  }
  return next;
}

export function correctionChanges(
  campaign: ParsedCampaign,
  values: CampaignCorrectionValues,
): CampaignCorrectionChange[] {
  return EDITABLE_CAMPAIGN_FIELDS.flatMap((field) => {
    const requested = values[field];
    if (requested == null) return [];
    const before = campaign[field].trim();
    const after = requested.trim();
    return before === after
      ? []
      : [{ field, label: CAMPAIGN_FIELD_LABELS[field], before, after }];
  });
}

function validOperationalDate(value: string): Date | null {
  const date = parseCampaignDate(value);
  if (!date) return null;
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date : null;
}

/** Valida el estado final, no solo el campo aislado que cambió. */
export function campaignCorrectionError(
  campaign: ParsedCampaign,
  values: CampaignCorrectionValues,
  reason: string,
): string | null {
  if (reason.trim().length < 5) {
    return 'Escribe un motivo de al menos 5 caracteres.';
  }
  const changes = correctionChanges(campaign, values);
  if (changes.length === 0) return 'No hay cambios por guardar.';
  if (changes.some((change) => change.after === '')) {
    return 'Los campos corregidos no pueden quedar vacíos.';
  }

  const next = { ...campaign, ...values };
  const start = validOperationalDate(next.fechaInicio);
  const end = validOperationalDate(next.fechaFin);
  if (!start || !end) {
    return 'La vigencia debe contener fechas válidas entre 2000 y 2100.';
  }
  if (start.getTime() > end.getTime()) {
    return 'La fecha de inicio no puede ser posterior a la fecha de fin.';
  }
  return null;
}

export function correctionComment(
  changes: readonly CampaignCorrectionChange[],
  reason: string,
  actorEmail: string,
  at: number,
): string {
  const detail = changes
    .map(
      (change) =>
        `${change.label}: "${change.before || 'vacío'}" → "${change.after || 'vacío'}"`,
    )
    .join('; ');
  return `Corrección manual de ${detail}. Motivo: ${reason.trim()}. Realizada por ${actorEmail || 'usuario sin correo'} el ${new Date(at).toISOString()}.`;
}
