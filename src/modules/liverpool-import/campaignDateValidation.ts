import type { ValidationIssue } from '@/domain';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import type { ParsedCampaign } from './campaignParse';

export const MIN_CAMPAIGN_YEAR = 2000;
export const MAX_CAMPAIGN_YEAR = 2100;

function dateIssue(
  campaign: ParsedCampaign,
  sheet: string | null,
  field: 'inicio' | 'fin',
  message: string,
): ValidationIssue {
  return {
    severity: 'blocking',
    code: `campaign-${field}-date-invalid`,
    message: `Fila ${campaign.row}, campaña "${campaign.name}": ${message}`,
    location: {
      ...(sheet ? { sheet } : {}),
      row: campaign.row,
      column: field === 'inicio' ? 'FECHA INICIO' : 'FECHA FIN',
    },
  };
}

/**
 * Valida la vigencia antes de que la importación escriba en Firestore.
 *
 * Una fecha sintácticamente válida pero fuera del horizonte operativo también
 * es bloqueante: evita aceptar errores como `8/31/0266`, que JavaScript puede
 * representar como el año 266 y que después desaparecen de filtros actuales.
 */
export function validateCampaignDates(
  campaigns: readonly ParsedCampaign[],
  sheet: string | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const campaign of campaigns) {
    const fields = [
      ['inicio', campaign.fechaInicio],
      ['fin', campaign.fechaFin],
    ] as const;
    const parsed = new Map<'inicio' | 'fin', Date>();

    for (const [field, raw] of fields) {
      const date = parseCampaignDate(raw);
      if (!date) {
        issues.push(
          dateIssue(
            campaign,
            sheet,
            field,
            `${field === 'inicio' ? 'FECHA INICIO' : 'FECHA FIN'} "${raw || '(vacía)'}" no es una fecha válida.`,
          ),
        );
        continue;
      }

      const year = date.getUTCFullYear();
      if (year < MIN_CAMPAIGN_YEAR || year > MAX_CAMPAIGN_YEAR) {
        issues.push(
          dateIssue(
            campaign,
            sheet,
            field,
            `${field === 'inicio' ? 'FECHA INICIO' : 'FECHA FIN'} "${raw}" tiene el año ${year}, fuera del rango permitido ${MIN_CAMPAIGN_YEAR}–${MAX_CAMPAIGN_YEAR}.`,
          ),
        );
        continue;
      }
      parsed.set(field, date);
    }

    const start = parsed.get('inicio');
    const end = parsed.get('fin');
    if (start && end && start.getTime() > end.getTime()) {
      issues.push({
        severity: 'blocking',
        code: 'campaign-date-range-inverted',
        message: `Fila ${campaign.row}, campaña "${campaign.name}": FECHA INICIO "${campaign.fechaInicio}" es posterior a FECHA FIN "${campaign.fechaFin}".`,
        location: {
          ...(sheet ? { sheet } : {}),
          row: campaign.row,
          column: 'FECHA INICIO / FECHA FIN',
        },
      });
    }
  }

  return issues;
}
