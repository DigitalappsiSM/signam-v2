import { describe, it, expect } from 'vitest';
import { analyzeLowOccupancy } from './occupancyAnalysis';
import { buildRatioCsv, hasRatioRows, ratioRows } from './occupancyCsv';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

function screen(
  id: string,
  original: Partial<AdmiraScreenOriginal>,
  calendarSupport: string,
): AdmiraScreen {
  return {
    id,
    original: { ...emptyOriginal(), ...original },
    metadata: {
      ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
      active: true,
      calendarSupport,
    },
  };
}

function campaign(
  name: string,
  support: string,
  ...stores: string[]
): ParsedCampaign {
  return {
    row: 2,
    name,
    tipo: 'ISM/PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '2026-08-01',
    fechaFin: '2026-08-31',
    mes: '',
    link: '',
    supports: [
      {
        support,
        owner: 'liverpool',
        stores: stores.map((numero) => ({ numero, nombre: '' })),
      },
    ],
  };
}

const DATE = '2026-08-15';
const DATES = { analysisDate: DATE, generatedDate: '2026-08-06' };

/** Escenario: LED/R con una tienda de 1 proveedor (Ratio 1) y otra de 3 (Ratio 3). */
function scenario() {
  const screens = [
    // Tienda 1: un solo contenido → Ratio 1.
    screen(
      't1',
      {
        'Numero de Tienda': '1',
        RESOLUCION: 'R',
        ARTICULOS: 'A',
        CENTROS: 'C1',
        CIRCUITO: 'VIDEOWALL',
        BRANDS: 'Nike',
        'TIPO DE PASES': 'PASES FULL',
      },
      'LED',
    ),
    // Tienda 2: tres contenidos → Ratio 3.
    ...['X', 'Y', 'Z'].map((art, i) =>
      screen(
        `t2-${i}`,
        {
          'Numero de Tienda': '2',
          RESOLUCION: 'R',
          ARTICULOS: art,
          CENTROS: 'C2',
        },
        'LED',
      ),
    ),
  ];
  const campaigns = [
    campaign('Camp A', 'LED', '1'),
    campaign('Camp X', 'LED', '2'),
    campaign('Camp Y', 'LED', '2'),
    campaign('Camp Z', 'LED', '2'),
  ];
  return analyzeLowOccupancy({ campaigns, screens, analysisDate: DATE });
}

describe('CSV Ratio 1 / Ratio 3', () => {
  it('separa Ratio 1 y Ratio 3 y deja fuera los ceros', () => {
    const res = scenario();
    const group = res.groups[0]!;
    expect(group.ratio1Units.map((u) => u.storeNumber)).toEqual(['1']);
    expect(group.ratio3Units.map((u) => u.storeNumber)).toEqual(['2']);
    expect(group.ratio1Rows).toHaveLength(1);
    expect(group.ratio3Rows).toHaveLength(3);
  });

  it('agrupa por soporte + resolución (soportes distintos → grupos distintos)', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        'b',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'B' },
        'APARADOR',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign('C1', 'LED', '1'), campaign('C2', 'APARADOR', '1')],
      screens,
      analysisDate: DATE,
    });
    expect(res.groups).toHaveLength(2);
  });

  it('resoluciones distintas → grupos distintos', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: '900 X 900', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        'b',
        { 'Numero de Tienda': '1', RESOLUCION: '914 x 908', ARTICULOS: 'B' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign('C1', 'LED', '1')],
      screens,
      analysisDate: DATE,
    });
    expect(res.groups).toHaveLength(2);
  });

  it('el contenido usa el formato exacto de Admira (encabezado, guarda, BOM, CRLF)', () => {
    const res = scenario();
    const csv = buildRatioCsv(res.groups[0]!, 1, DATES)!;
    const lines = csv.content.split('\r\n');
    expect(csv.content.startsWith('﻿')).toBe(true); // BOM
    expect(csv.content.includes('\r\n')).toBe(true); // CRLF
    expect(lines[0]).toBe(
      '﻿LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases',
    );
    // Fila de datos empieza con celda vacía (columna guarda).
    expect(lines[1]!.startsWith(',')).toBe(true);
    // RETAILERS = LIVERPOOL.
    expect(lines[1]).toContain('LIVERPOOL');
    expect(lines[1]).toContain('PASES FULL');
  });

  it('RATIO 1/3 no aparece en las columnas de datos', () => {
    const res = scenario();
    const r1 = buildRatioCsv(res.groups[0]!, 1, DATES)!;
    const r3 = buildRatioCsv(res.groups[0]!, 3, DATES)!;
    const body1 = r1.content.split('\r\n').slice(1).join('\n');
    const body3 = r3.content.split('\r\n').slice(1).join('\n');
    expect(body1).not.toMatch(/RATIO\s*1/i);
    expect(body3).not.toMatch(/RATIO\s*3/i);
    // Pero sí aparece en el nombre.
    expect(r1.fileName).toContain('RATIO_1');
    expect(r3.fileName).toContain('RATIO_3');
  });

  it('ambas fechas aparecen en el nombre', () => {
    const res = scenario();
    const r1 = buildRatioCsv(res.groups[0]!, 1, DATES)!;
    expect(r1.fileName).toContain('ANALISIS_2026-08-15');
    expect(r1.fileName).toContain('GENERADO_2026-08-06');
  });

  it('no genera archivo vacío (devuelve null si no hay filas)', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
    ];
    // Sin proveedores: 0 filas en ambos ratios.
    const res = analyzeLowOccupancy({
      campaigns: [],
      screens,
      analysisDate: DATE,
    });
    const group = res.groups[0]!;
    expect(hasRatioRows(group, 1)).toBe(false);
    expect(hasRatioRows(group, 3)).toBe(false);
    expect(buildRatioCsv(group, 1, DATES)).toBeNull();
    expect(buildRatioCsv(group, 3, DATES)).toBeNull();
  });

  it('deduplica filas idénticas', () => {
    const screens = [
      screen(
        'a',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          CENTROS: 'C',
        },
        'LED',
      ),
      screen(
        'b',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          CENTROS: 'C',
        },
        'LED',
      ),
    ];
    // Un solo contenido (misma campaña + artículo), fila duplicada colapsada.
    const res = analyzeLowOccupancy({
      campaigns: [campaign('C1', 'LED', '1')],
      screens,
      analysisDate: DATE,
    });
    const group = res.groups[0]!;
    expect(res.units[0]!.providerCount).toBe(1);
    expect(ratioRows(group, 1)).toHaveLength(1);
  });
});
