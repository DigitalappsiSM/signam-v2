import { describe, it, expect } from 'vitest';
import { csvFileName, consolidationCsv } from './csvExport';
import type { Consolidation } from '@/modules/consolidation/consolidate';

function consolidation(over: Partial<Consolidation> = {}): Consolidation {
  return {
    campaignName: 'Nike Verano',
    resolution: '914 x 908',
    admiraCampaignName: 'Nike Verano_ VW 914x908',
    articulos: 'VW 914x908',
    rows: [
      {
        ARTICULOS: 'VW 914x908',
        BRANDS: 'Nike',
        CENTROS: 'GDL',
        CIRCUITO: 'VIDEOWALL',
        RESOLUCION: '914 x 908',
        RETAILERS: 'LIVERPOOL',
        'TIPO DE PASES': 'PASES FULL',
      },
    ],
    screenIds: ['s1'],
    storeCount: 1,
    ...over,
  };
}

describe('csvFileName', () => {
  it('usa el nombre Admira y agrega .csv', () => {
    expect(csvFileName(consolidation())).toBe('Nike Verano_ VW 914x908.csv');
  });

  it('sanea caracteres inválidos de nombre de archivo', () => {
    const name = csvFileName(
      consolidation({ admiraCampaignName: 'A/B:C*?"<>|D' }),
    );
    expect(name).toBe('A_B_C______D.csv');
  });
});

describe('consolidationCsv', () => {
  it('incluye encabezado, RETAILERS=LIVERPOOL y BOM', () => {
    const csv = consolidationCsv(consolidation());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain(
      'ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,TIPO DE PASES',
    );
    expect(csv).toContain(
      'VW 914x908,Nike,GDL,VIDEOWALL,914 x 908,LIVERPOOL,PASES FULL',
    );
  });
});
