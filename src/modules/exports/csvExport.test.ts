import { describe, it, expect } from 'vitest';
import { csvFileName, consolidationCsv, zipFileName } from './csvExport';
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

describe('zipFileName', () => {
  it('usa el nombre de campaña + " Todas las resoluciones.zip"', () => {
    expect(zipFileName('COLCHONIZA 2026 E2')).toBe(
      'COLCHONIZA 2026 E2_ Todas las resoluciones.zip',
    );
  });

  it('sanea caracteres inválidos y no añade artículos ni resolución', () => {
    expect(zipFileName('A/B:C*?"<>|D')).toBe(
      'A_B_C______D_ Todas las resoluciones.zip',
    );
  });
});

describe('consolidationCsv', () => {
  it('pone LIVERPOOL en A1 con columna A vacía, encabezado exacto (Tipo de Pases), RETAILERS=LIVERPOOL y BOM', () => {
    const csv = consolidationCsv(consolidation());
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // Fila 1: A1 = "LIVERPOOL", encabezado real desde la columna B.
    expect(csv.slice(1).startsWith('LIVERPOOL,ARTICULOS')).toBe(true);
    expect(csv).toContain(
      'LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases',
    );
    // Cada fila de datos empieza con la columna A vacía.
    expect(csv).toContain(
      ',VW 914x908,Nike,GDL,VIDEOWALL,914 x 908,LIVERPOOL,PASES FULL',
    );
  });
});
