import { describe, expect, it } from 'vitest';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import {
  applyManualOverrides,
  campaignCorrectionError,
  correctionChanges,
  correctionComment,
} from './campaignCorrection';

const campaign: ParsedCampaign = {
  row: 211,
  name: 'MAGFESA',
  tipo: 'ISM/PROVEEDOR',
  vendidoPor: 'LIVERPOOL',
  fechaInicio: '8/17/26',
  fechaFin: '8/31/0266',
  mes: 'AGOSTO',
  link: '',
  supports: [],
};

describe('campaignCorrection', () => {
  it('corrige la vigencia inválida y describe solo el campo modificado', () => {
    const values = { fechaFin: '2026-08-31' };
    expect(campaignCorrectionError(campaign, values, 'Error de captura')).toBe(
      null,
    );
    expect(correctionChanges(campaign, values)).toEqual([
      {
        field: 'fechaFin',
        label: 'Fecha de fin',
        before: '8/31/0266',
        after: '2026-08-31',
      },
    ]);
  });

  it('rechaza motivo corto, fechas fuera de rango y rangos invertidos', () => {
    expect(
      campaignCorrectionError(campaign, { fechaFin: '2026-08-31' }, 'x'),
    ).toMatch(/motivo/i);
    expect(
      campaignCorrectionError(
        { ...campaign, fechaFin: '2026-08-31' },
        { fechaInicio: '2027-01-01' },
        'Ajuste solicitado',
      ),
    ).toMatch(/posterior/i);
  });

  it('aplica la corrección activa al valor de una reimportación', () => {
    expect(
      applyManualOverrides(campaign, {
        fechaFin: {
          value: '2026-08-31',
          reason: 'Error de captura',
          correctedAt: 1,
          correctedByUid: 'u1',
          correctedByEmail: 'a@b.mx',
        },
      }).fechaFin,
    ).toBe('2026-08-31');
  });

  it('genera el comentario automático con motivo, usuario y hora', () => {
    const changes = correctionChanges(campaign, {
      fechaFin: '2026-08-31',
    });
    expect(
      correctionComment(changes, 'Error de captura', 'a@b.mx', 0),
    ).toContain(
      'Corrección manual de Fecha de fin: "8/31/0266" → "2026-08-31"',
    );
    expect(
      correctionComment(changes, 'Error de captura', 'a@b.mx', 0),
    ).toContain('a@b.mx');
  });
});
