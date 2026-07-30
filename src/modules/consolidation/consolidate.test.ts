import { describe, it, expect } from 'vitest';
import { consolidate, summarizeIssues } from './consolidate';
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
  active = true,
): AdmiraScreen {
  return {
    id,
    original: { ...emptyOriginal(), ...original },
    metadata: {
      ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
      active,
      calendarSupport,
    },
  };
}

function campaign(
  name: string,
  supports: ParsedCampaign['supports'],
): ParsedCampaign {
  return {
    row: 2,
    name,
    tipo: '',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '',
    fechaFin: '',
    mes: '',
    supports,
  };
}

describe('consolidate', () => {
  it('cruza por tienda + normalización y agrupa por resolución', () => {
    const screens = [
      screen(
        's1',
        {
          'Numero de Tienda': '78',
          RESOLUCION: '914 x 908',
          ARTICULOS: 'VW 914x908',
          BRANDS: 'Nike',
          CENTROS: 'GDL',
          CIRCUITO: 'VIDEOWALL',
          'TIPO DE PASES': 'PASES FULL',
        },
        'VIDEO WALL CRIUS',
      ),
    ];
    const campaigns = [
      campaign('Nike Verano', [
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool',
          stores: [{ numero: '78', nombre: 'L GUADALAJARA' }],
        },
      ]),
    ];

    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(1);
    const c = result.consolidations[0]!;
    expect(c.admiraCampaignName).toBe('Nike Verano_ VW 914x908');
    expect(c.resolution).toBe('914 x 908');
    expect(c.rows).toHaveLength(1);
    expect(c.rows[0]).toMatchObject({
      RETAILERS: 'LIVERPOOL',
      ARTICULOS: 'VW 914x908',
      'TIPO DE PASES': 'PASES FULL',
    });
  });

  it('genera un CSV por cada resolución distinta de la campaña', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: '914 x 908', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        'b',
        { 'Numero de Tienda': '2', RESOLUCION: '900 X 900', ARTICULOS: 'B' },
        'LED',
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '2', nombre: '' },
          ],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(2);
    expect(result.consolidations.map((c) => c.resolution).sort()).toEqual([
      '900 X 900',
      '914 x 908',
    ]);
  });

  it('concatena artículos distintos de la misma resolución con " + "', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: '914 x 908', ARTICULOS: 'A1' },
        'LED',
      ),
      screen(
        'b',
        { 'Numero de Tienda': '2', RESOLUCION: '914 x 908', ARTICULOS: 'A2' },
        'LED',
      ),
      screen(
        'c',
        { 'Numero de Tienda': '3', RESOLUCION: '914 x 908', ARTICULOS: 'A1' },
        'LED',
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '2', nombre: '' },
            { numero: '3', nombre: '' },
          ],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(1);
    expect(result.consolidations[0]!.admiraCampaignName).toBe('Camp_ A1 + A2');
  });

  it('excluye soportes InStore Media y los reporta', () => {
    const campaigns = [
      campaign('Camp', [
        {
          support: "MUPPI'S",
          owner: 'instore-media',
          stores: [{ numero: '1', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, []);
    expect(result.consolidations).toHaveLength(0);
    expect(result.excludedInstore).toEqual([
      { campaign: 'Camp', support: "MUPPI'S" },
    ]);
  });

  it('reporta pantalla inactiva solicitada y la excluye', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
        false,
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'screen-inactive')).toBe(true);
  });

  it('reporta tienda inexistente en el catálogo (verdad absoluta) sin forzarla', () => {
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [{ numero: '99', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, []);
    expect(result.consolidations).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'store-not-in-catalog')).toBe(
      true,
    );
  });

  it('distingue tienda existente pero sin ese soporte (posible error de Liverpool)', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '5', RESOLUCION: 'R', ARTICULOS: 'A' },
        'OTRO',
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [{ numero: '5', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'store-support-mismatch')).toBe(
      true,
    );
  });

  it('excluye pantallas cuyo TIPO DE pantallas es ISM', () => {
    const screens = [
      screen(
        'a',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          'TIPO DE pantallas': 'ISM DIGITAL',
        },
        'LED',
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(0);
    expect(result.ismExcludedCount).toBe(1);
  });

  it('aplica la excepción de Guadalajara Galerías (tienda 78 + VIDEO WALL CRIUS)', () => {
    const screens = [
      screen(
        'crius',
        {
          'Numero de Tienda': '78',
          Modelo: 'CRIUS',
          RESOLUCION: '914 x 908',
          ARTICULOS: 'VW 914x908',
        },
        'VIDEO WALL CRIUS',
      ),
      // CUADRADA mapeada a OTRO soporte: se incluye por la excepción.
      screen(
        'cuad',
        {
          'Numero de Tienda': '78',
          Modelo: 'CUADRADA',
          RESOLUCION: '900 X 900',
          ARTICULOS: 'VW 900x900',
        },
        'PANTALLAS CUADRADAS',
      ),
    ];
    const campaigns = [
      campaign('Nike Verano', [
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool',
          stores: [{ numero: '78', nombre: 'L GUADALAJARA GALERIAS' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    const names = result.consolidations.map((c) => c.admiraCampaignName).sort();
    expect(names).toEqual([
      'Nike Verano_ VW 900x900',
      'Nike Verano_ VW 914x908',
    ]);
  });

  it('soporte "Asignada" sin comentario incluye todas las pantallas del soporte', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        'b',
        { 'Numero de Tienda': '2', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      // Otro soporte: no debe incluirse.
      screen(
        'c',
        { 'Numero de Tienda': '3', RESOLUCION: 'R', ARTICULOS: 'X' },
        'OTRO',
      ),
    ];
    const campaigns = [
      // Sin tiendas (celda "Asignada" sin comentario).
      campaign('REGRESO A CLASES', [
        { support: 'LED', owner: 'liverpool', stores: [] },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(1);
    expect(result.consolidations[0]!.screenIds.sort()).toEqual(['a', 'b']);
  });

  it('reporta soporte asignado sin comentario que no existe en el catálogo', () => {
    const campaigns = [
      campaign('Camp', [
        { support: 'INEXISTENTE', owner: 'liverpool', stores: [] },
      ]),
    ];
    const result = consolidate(campaigns, []);
    expect(result.issues.some((i) => i.code === 'support-not-in-catalog')).toBe(
      true,
    );
  });

  it('summarizeIssues agrupa por código y por soporte', () => {
    const campaigns = [
      campaign('Camp', [
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '2', nombre: '' },
          ],
        },
      ]),
    ];
    const result = consolidate(campaigns, []);
    const summary = summarizeIssues(result.issues);
    expect(summary.total).toBe(2);
    expect(summary.byCode['store-not-in-catalog']).toBe(2);
    expect(summary.bySupport['VIDEO WALL CRIUS']).toBe(2);
  });

  it('ignora pantallas sin normalización (sin mapear)', () => {
    const screens = [
      screen(
        'a',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        '',
      ),
    ];
    const campaigns = [
      campaign('Camp', [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ]),
    ];
    const result = consolidate(campaigns, screens);
    expect(result.consolidations).toHaveLength(0);
    expect(result.issues.some((i) => i.code === 'store-not-in-catalog')).toBe(
      true,
    );
  });
});
