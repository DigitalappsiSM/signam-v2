import { describe, expect, it } from 'vitest';
import {
  applyImportDateCorrections,
  campaignHasBlockingDates,
  importDateCorrectionError,
  toDateInputValue,
  type ImportDateCorrections,
} from './importDateCorrection';
import type { ParsedCampaign } from './campaignParse';

function campaign(overrides: Partial<ParsedCampaign> = {}): ParsedCampaign {
  return {
    row: 10,
    name: 'OSTER',
    tipo: 'Proveedor',
    vendidoPor: 'Liverpool',
    fechaInicio: '2026-08-01',
    fechaFin: '2026-08-31',
    mes: 'Agosto',
    link: '',
    supports: [],
    ...overrides,
  };
}

describe('campaignHasBlockingDates', () => {
  it('acepta una vigencia válida dentro del rango', () => {
    expect(campaignHasBlockingDates(campaign())).toBe(false);
  });

  it('marca un año fuera del rango 2000–2100', () => {
    expect(campaignHasBlockingDates(campaign({ fechaFin: '8/31/0266' }))).toBe(
      true,
    );
  });

  it('marca inicio posterior a fin', () => {
    expect(
      campaignHasBlockingDates(
        campaign({ fechaInicio: '2027-06-08', fechaFin: '2026-06-22' }),
      ),
    ).toBe(true);
  });
});

describe('applyImportDateCorrections', () => {
  it('sustituye las fechas por fila de origen y deja intactas las demás', () => {
    const rows = [
      campaign({ row: 5, name: 'A', fechaFin: '8/31/0266' }),
      campaign({ row: 6, name: 'B' }),
    ];
    const corrections: ImportDateCorrections = new Map([
      [
        5,
        {
          fechaInicio: '2026-08-01',
          fechaFin: '2026-08-31',
          reason: 'Año mal capturado en el archivo',
          before: { fechaInicio: '2026-08-01', fechaFin: '8/31/0266' },
        },
      ],
    ]);
    const result = applyImportDateCorrections(rows, corrections);
    expect(result[0]!.fechaFin).toBe('2026-08-31');
    expect(campaignHasBlockingDates(result[0]!)).toBe(false);
    expect(result[1]).toBe(rows[1]);
  });

  it('sin correcciones devuelve una copia equivalente', () => {
    const rows = [campaign()];
    expect(applyImportDateCorrections(rows, new Map())).toEqual(rows);
  });
});

describe('toDateInputValue', () => {
  it('devuelve ISO para una fecha válida', () => {
    expect(toDateInputValue('15/08/2026')).toBe('2026-08-15');
    expect(toDateInputValue('2026-08-15')).toBe('2026-08-15');
  });

  it('devuelve cadena vacía para fechas inválidas o fuera de rango', () => {
    expect(toDateInputValue('8/31/0266')).toBe('');
    expect(toDateInputValue('no es fecha')).toBe('');
    expect(toDateInputValue('')).toBe('');
  });
});

describe('importDateCorrectionError', () => {
  const broken = campaign({ fechaFin: '8/31/0266' });

  it('exige motivo de al menos 5 caracteres', () => {
    expect(
      importDateCorrectionError(
        broken,
        { fechaInicio: '2026-08-01', fechaFin: '2026-08-31' },
        'x',
      ),
    ).toMatch(/motivo/i);
  });

  it('rechaza inicio posterior a fin', () => {
    expect(
      importDateCorrectionError(
        broken,
        { fechaInicio: '2026-09-01', fechaFin: '2026-08-31' },
        'Corrección de vigencia',
      ),
    ).toMatch(/posterior/i);
  });

  it('acepta una corrección válida con motivo', () => {
    expect(
      importDateCorrectionError(
        broken,
        { fechaInicio: '2026-08-01', fechaFin: '2026-08-31' },
        'Año 0266 mal capturado; corresponde a 2026',
      ),
    ).toBeNull();
  });
});
