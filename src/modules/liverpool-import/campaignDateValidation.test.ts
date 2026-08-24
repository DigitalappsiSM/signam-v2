import { describe, expect, it } from 'vitest';
import type { ParsedCampaign } from './campaignParse';
import { validateCampaignDates } from './campaignDateValidation';

function campaign(
  name: string,
  fechaInicio: string,
  fechaFin: string,
): ParsedCampaign {
  return {
    row: 210,
    name,
    tipo: 'PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio,
    fechaFin,
    mes: 'Agosto',
    link: '',
    supports: [],
  };
}

describe('validateCampaignDates', () => {
  it('acepta la vigencia válida de TRAMONTINA', () => {
    expect(
      validateCampaignDates(
        [campaign('TRAMONTINA', '8/17/2026', '8/31/2026')],
        'Hoja 2',
      ),
    ).toEqual([]);
  });

  it('bloquea el año 0266 de MAGFESA e identifica fila y campaña', () => {
    const issues = validateCampaignDates(
      [campaign('MAGFESA', '8/17/2026', '8/31/0266')],
      'Hoja 2',
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'blocking',
      location: { sheet: 'Hoja 2', row: 210, column: 'FECHA FIN' },
    });
    expect(issues[0]?.message).toContain('MAGFESA');
    expect(issues[0]?.message).toContain('año 266');
  });

  it('bloquea fechas vacías o imposibles', () => {
    const issues = validateCampaignDates(
      [campaign('SIN FECHA', '', '31/02/2026')],
      'Hoja 2',
    );

    expect(issues).toHaveLength(2);
    expect(issues.every((issue) => issue.severity === 'blocking')).toBe(true);
  });

  it('bloquea rangos invertidos', () => {
    const issues = validateCampaignDates(
      [campaign('FRIGIDAIRE', '1/1/2027', '12/31/2026')],
      'Hoja 2',
    );

    expect(issues).toEqual([
      expect.objectContaining({ code: 'campaign-date-range-inverted' }),
    ]);
  });
});
