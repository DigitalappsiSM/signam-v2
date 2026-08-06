import { describe, it, expect } from 'vitest';
import {
  analyzeLowOccupancy,
  isCampaignActiveOn,
  countsForOccupancy,
  toIsoDate,
} from './occupancyAnalysis';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
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

function campaign(over: Partial<ParsedCampaign>): ParsedCampaign {
  return {
    row: 2,
    name: over.name ?? 'Camp',
    tipo: over.tipo ?? 'ISM/PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: over.fechaInicio ?? '2026-08-01',
    fechaFin: over.fechaFin ?? '2026-08-31',
    mes: '',
    link: '',
    supports: over.supports ?? [],
    ...over,
  };
}

/** Un soporte con tiendas por número. */
function support(
  name: string,
  ...stores: string[]
): ParsedCampaign['supports'] {
  return [
    {
      support: name,
      owner: 'liverpool',
      stores: stores.map((numero) => ({ numero, nombre: '' })),
    },
  ];
}

const DATE = '2026-08-15';

describe('helpers de fecha y clasificación', () => {
  it('toIsoDate formatea a AAAA-MM-DD en UTC', () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 7, 6)))).toBe('2026-08-06');
  });

  it('vigencia inclusiva en inicio y fin', () => {
    const c = { fechaInicio: '2026-08-10', fechaFin: '2026-08-20' };
    expect(isCampaignActiveOn(c, parseCampaignDate('2026-08-10')!)).toBe(true);
    expect(isCampaignActiveOn(c, parseCampaignDate('2026-08-20')!)).toBe(true);
    expect(isCampaignActiveOn(c, parseCampaignDate('2026-08-15')!)).toBe(true);
    expect(isCampaignActiveOn(c, parseCampaignDate('2026-08-09')!)).toBe(false);
    expect(isCampaignActiveOn(c, parseCampaignDate('2026-08-21')!)).toBe(false);
  });

  it('solo Proveedor cuenta para la ocupación', () => {
    expect(countsForOccupancy({ tipo: 'ISM/PROVEEDOR' })).toBe(true);
    expect(countsForOccupancy({ tipo: 'ISM/INSTITUCIONAL 1' })).toBe(false);
    expect(countsForOccupancy({ tipo: 'INSTITUCIONAL' })).toBe(false);
    expect(countsForOccupancy({ tipo: 'algo raro' })).toBe(false);
    expect(countsForOccupancy({ tipo: '' })).toBe(false);
  });
});

describe('analyzeLowOccupancy — niveles y ratios', () => {
  const screens = [
    screen(
      's1',
      { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
      'LED',
    ),
  ];

  function analyzeWith(campaigns: ParsedCampaign[]) {
    return analyzeLowOccupancy({ campaigns, screens, analysisDate: DATE });
  }

  it('0 proveedores → Sin ocupación, sin ratio, fuera de ambos CSV', () => {
    const res = analyzeWith([]);
    expect(res.units).toHaveLength(1);
    const u = res.units[0]!;
    expect(u.providerCount).toBe(0);
    expect(u.level).toBe('sin-ocupacion');
    expect(u.recommendedRatio).toBeNull();
    const group = res.groups[0]!;
    expect(group.ratio1Rows).toHaveLength(0);
    expect(group.ratio3Rows).toHaveLength(0);
    expect(group.zeroUnits).toHaveLength(1);
  });

  it('1 proveedor → crítica y Ratio 1', () => {
    const res = analyzeWith([
      campaign({ name: 'C1', supports: support('LED', '1') }),
    ]);
    const u = res.units[0]!;
    expect(u.providerCount).toBe(1);
    expect(u.level).toBe('baja-critica');
    expect(u.recommendedRatio).toBe(1);
  });

  it('2 proveedores → preventiva y Ratio 1', () => {
    const s = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'B' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens: s,
      analysisDate: DATE,
    });
    const u = res.units[0]!;
    expect(u.providerCount).toBe(2);
    expect(u.level).toBe('baja-preventiva');
    expect(u.recommendedRatio).toBe(1);
  });

  it('3 proveedores → normal y Ratio 3', () => {
    const s = ['A', 'B', 'C'].map((art, i) =>
      screen(
        `s${i}`,
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: art },
        'LED',
      ),
    );
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens: s,
      analysisDate: DATE,
    });
    const u = res.units[0]!;
    expect(u.providerCount).toBe(3);
    expect(u.level).toBe('normal');
    expect(u.recommendedRatio).toBe(3);
  });

  it('4 o más permanecen en Ratio 3', () => {
    const s = ['A', 'B', 'C', 'D'].map((art, i) =>
      screen(
        `s${i}`,
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: art },
        'LED',
      ),
    );
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens: s,
      analysisDate: DATE,
    });
    const u = res.units[0]!;
    expect(u.providerCount).toBe(4);
    expect(u.recommendedRatio).toBe(3);
  });
});

describe('analyzeLowOccupancy — clasificación de campañas', () => {
  const screens = [
    screen(
      's1',
      { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
      'LED',
    ),
  ];
  const analyze = (tipo: string) =>
    analyzeLowOccupancy({
      campaigns: [campaign({ tipo, supports: support('LED', '1') })],
      screens,
      analysisDate: DATE,
    }).units[0]!.providerCount;

  it('institucional no cuenta', () => {
    expect(analyze('INSTITUCIONAL')).toBe(0);
    expect(analyze('marca/institucional relleno')).toBe(0);
  });
  it('ISM/INSTITUCIONAL 1 no cuenta', () => {
    expect(analyze('ISM/INSTITUCIONAL 1')).toBe(0);
  });
  it('ISM/PROVEEDOR cuenta', () => {
    expect(analyze('ISM/PROVEEDOR')).toBe(1);
  });
  it('clasificación desconocida no se asume Proveedor', () => {
    expect(analyze('cualquier cosa')).toBe(0);
    expect(analyze('')).toBe(0);
  });
});

describe('analyzeLowOccupancy — vigencia', () => {
  const screens = [
    screen(
      's1',
      { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
      'LED',
    ),
  ];
  const count = (fechaInicio: string, fechaFin: string) =>
    analyzeLowOccupancy({
      campaigns: [
        campaign({ fechaInicio, fechaFin, supports: support('LED', '1') }),
      ],
      screens,
      analysisDate: DATE,
    }).units[0]!.providerCount;

  it('fechas de inicio y fin son inclusivas', () => {
    expect(count('2026-08-15', '2026-08-15')).toBe(1);
  });
  it('campaña pasada no cuenta', () => {
    expect(count('2026-07-01', '2026-08-14')).toBe(0);
  });
  it('campaña futura no cuenta antes de su vigencia', () => {
    expect(count('2026-08-16', '2026-08-31')).toBe(0);
  });
});

describe('analyzeLowOccupancy — conteo Campaña + ARTICULOS', () => {
  it('misma campaña y mismo artículo se deduplica (una sola vez)', () => {
    const screens = [
      screen(
        's1',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          'TIPO DE PASES': 'PASES MEDIUM',
        },
        'LED',
      ),
      screen(
        's2',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          'TIPO DE PASES': 'PASES FULL',
        },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens,
      analysisDate: DATE,
    });
    // TIPO DE PASES no divide el conteo: un solo contenido.
    expect(res.units[0]!.providerCount).toBe(1);
    expect(res.units[0]!.contents[0]!.screenIds.sort()).toEqual(['s1', 's2']);
  });

  it('dos artículos de una campaña cuentan como dos', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'B' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens,
      analysisDate: DATE,
    });
    expect(res.units[0]!.providerCount).toBe(2);
  });

  it('dos campañas con el mismo artículo cuentan como dos', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [
        campaign({ name: 'C1', supports: support('LED', '1') }),
        campaign({ name: 'C2', supports: support('LED', '1') }),
      ],
      screens,
      analysisDate: DATE,
    });
    expect(res.units[0]!.providerCount).toBe(2);
  });
});

describe('analyzeLowOccupancy — separación de unidades', () => {
  it('dos soportes de una tienda se separan', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'B' },
        'APARADOR',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [
        campaign({
          name: 'C1',
          supports: [
            {
              support: 'LED',
              owner: 'liverpool',
              stores: [{ numero: '1', nombre: '' }],
            },
            {
              support: 'APARADOR',
              owner: 'liverpool',
              stores: [{ numero: '1', nombre: '' }],
            },
          ],
        }),
      ],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(2);
    expect(res.groups).toHaveLength(2);
  });

  it('dos resoluciones de una tienda se separan', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: '900 X 900', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '1', RESOLUCION: '914 x 908', ARTICULOS: 'B' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(2);
    expect(res.groups).toHaveLength(2);
  });
});

describe('analyzeLowOccupancy — universo de pantallas', () => {
  it('pantalla inactiva no participa', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
        false,
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [campaign({ name: 'C1', supports: support('LED', '1') })],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(0);
  });

  it('pantalla sin normalización se reporta y se excluye', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        '',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(0);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it('soporte sin comentario aplica a todas las tiendas', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '2', RESOLUCION: 'R', ARTICULOS: 'A' },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [
        campaign({
          name: 'C1',
          supports: [{ support: 'LED', owner: 'liverpool', stores: [] }],
        }),
      ],
      screens,
      analysisDate: DATE,
    });
    // Dos unidades (tienda 1 y tienda 2), cada una con un proveedor.
    expect(res.units).toHaveLength(2);
    expect(res.units.every((u) => u.providerCount === 1)).toBe(true);
  });

  it('excluye soportes InStore Media del universo', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R', ARTICULOS: 'A' },
        "MUPPI'S",
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(0);
  });

  it('excluye pantallas ISM del universo', () => {
    const screens = [
      screen(
        's1',
        {
          'Numero de Tienda': '1',
          RESOLUCION: 'R',
          ARTICULOS: 'A',
          'TIPO DE pantallas': 'ISM DIGITAL',
        },
        'LED',
      ),
    ];
    const res = analyzeLowOccupancy({
      campaigns: [],
      screens,
      analysisDate: DATE,
    });
    expect(res.units).toHaveLength(0);
  });

  it('la excepción de Guadalajara Galerías permanece', () => {
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
    const res = analyzeLowOccupancy({
      campaigns: [
        campaign({
          name: 'Nike',
          supports: support('VIDEO WALL CRIUS', '78'),
        }),
      ],
      screens,
      analysisDate: DATE,
    });
    // La unidad CUADRADA (900x900) recibe el contenido por la excepción.
    const cuad = res.units.find((u) => u.resolution === '900 X 900');
    expect(cuad).toBeDefined();
    expect(cuad!.providerCount).toBe(1);
  });
});
