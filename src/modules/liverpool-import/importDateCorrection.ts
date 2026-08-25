import type { ParsedCampaign } from './campaignParse';
import { validateCampaignDates } from './campaignDateValidation';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import {
  campaignCorrectionError,
  type CampaignCorrectionValues,
} from '@/modules/campaigns/campaignCorrection';

/**
 * Corrección de vigencia capturada **durante la importación** del calendario,
 * para campañas nuevas cuya fecha de origen es inválida (año fuera de rango,
 * texto no interpretable o inicio posterior a fin).
 *
 * No modifica el archivo de Liverpool: la corrección se aplica en memoria para
 * desbloquear la importación y, al guardar, se persiste como `manualOverrides`
 * de la campaña más un evento auditable en su bitácora `corrections`, igual que
 * una corrección hecha desde la pantalla de Campañas. Así una reimportación del
 * mismo archivo no restaura silenciosamente la fecha errónea.
 *
 * La llave es la **fila de origen** (`ParsedCampaign.row`), estable aunque la
 * corrección cambie las fechas (y con ellas la identidad de la campaña).
 */
export interface ImportDateCorrection {
  /** Valor corregido de la fecha de inicio (ISO `AAAA-MM-DD`). */
  fechaInicio: string;
  /** Valor corregido de la fecha de fin (ISO `AAAA-MM-DD`). */
  fechaFin: string;
  /** Motivo auditable (mínimo 5 caracteres). */
  reason: string;
  /** Valores originales del archivo, conservados para el historial. */
  before: { fechaInicio: string; fechaFin: string };
}

export type ImportDateCorrections = Map<number, ImportDateCorrection>;

/** Aplica las correcciones de fecha (por fila de origen) sobre las campañas. */
export function applyImportDateCorrections(
  campaigns: readonly ParsedCampaign[],
  corrections: ImportDateCorrections,
): ParsedCampaign[] {
  if (corrections.size === 0) return [...campaigns];
  return campaigns.map((campaign) => {
    const correction = corrections.get(campaign.row);
    if (!correction) return campaign;
    return {
      ...campaign,
      fechaInicio: correction.fechaInicio,
      fechaFin: correction.fechaFin,
    };
  });
}

/** ¿La campaña tiene una vigencia bloqueante (fecha inválida o invertida)? */
export function campaignHasBlockingDates(campaign: ParsedCampaign): boolean {
  return validateCampaignDates([campaign], null).length > 0;
}

/**
 * Prefill de un `<input type="date">`: devuelve el ISO `AAAA-MM-DD` si la fecha
 * es válida y está dentro del horizonte operativo; si no, cadena vacía para que
 * el usuario capture el valor correcto.
 */
export function toDateInputValue(raw: string): string {
  const date = parseCampaignDate(raw);
  if (!date) return '';
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Valida una corrección de importación reutilizando la misma regla de negocio
 * de las correcciones de Campañas (fechas válidas 2000–2100, inicio ≤ fin,
 * motivo ≥ 5 caracteres y al menos un cambio). Devuelve el mensaje de error o
 * `null` si es válida.
 */
export function importDateCorrectionError(
  campaign: ParsedCampaign,
  values: CampaignCorrectionValues,
  reason: string,
): string | null {
  return campaignCorrectionError(campaign, values, reason);
}
