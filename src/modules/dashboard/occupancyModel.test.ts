import { describe, it, expect } from 'vitest';
import {
  buildOccupancyDashboard,
  presetRange,
  type DateRange,
  type OccupancyCampaignInput,
  type OccupancyFilters,
} from './occupancyModel';
import { parseCampaignDate } from '@/modules/operational-tracking/businessDays';
import {
  classifySupport,
  type AdmiraScreen,
  type SupportOwner,
} from '@/domain';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';

// --- Fixtures ---------------------------------------------------------------

function range(a: string, b: string): DateRange {
  return { start: parseCampaignDate(a)!, end: parseCampaignDate(b)! };
}
const MAY = range('2026-05-01', '2026-05-31');

function screen(o: {
  id: string;
  numero: string;
  calendarSupport?: string;
  modelo?: string;
  active?: boolean;
  nombre?: string;
}): AdmiraScreen {
  return {
    id: o.id,
    original: {
      'TIPO DE pantallas': '',
      CENTROS: '',
      CIRCUITO: '',
      RESOLUCION: '',
      FORMATO: '',
      'Nombre en plataforma': '',
      'TIPO DE PASES': '',
      'Numero de Tienda': o.numero,
      'Nombre de tienda': o.nombre ?? 'Tienda Oficial',
      Modelo: o.modelo ?? '',
      ARTICULOS: '',
      BRANDS: '',
    },
    metadata: {
      active: o.active ?? true,
      createdAt: 0,
      updatedAt: 0,
      createdBy: '',
      updatedBy: '',
      source: '',
      sourceSheet: '',
      sourceRow: 0,
      deactivationReason: null,
      version: 1,
      calendarSupport: o.calendarSupport ?? '',
    },
  };
}

function support(o: {
  support: string;
  owner?: SupportOwner;
  stores?: { numero: string; nombre?: string }[];
}): CampaignSupport {
  return {
    support: o.support,
    owner: o.owner ?? classifySupport(o.support),
    stores: (o.stores ?? []).map((s) => ({
      numero: s.numero,
      nombre: s.nombre ?? '',
    })),
  };
}

function campaign(o: Partial<OccupancyCampaignInput>): OccupancyCampaignInput {
  return {
    id: o.id ?? o.name ?? 'id',
    name: o.name ?? 'CAMPAÑA',
    nameKey: o.nameKey ?? (o.name ?? 'campaña').toLowerCase(),
    tipo: o.tipo ?? '',
    fechaInicio: o.fechaInicio ?? '2026-05-05',
    fechaFin: o.fechaFin ?? '2026-05-15',
    supports: o.supports ?? [],
  };
}

function tracking(
  nameKey: string,
  classification: 'institutional' | 'provider',
): CampaignOperationalTracking {
  return {
    campaignNameKey: nameKey,
    classification,
  } as unknown as CampaignOperationalTracking;
}

function build(
  campaigns: OccupancyCampaignInput[],
  screens: AdmiraScreen[],
  opts: {
    tracking?: CampaignOperationalTracking[];
    range?: DateRange;
    filters?: OccupancyFilters;
  } = {},
) {
  return buildOccupancyDashboard({
    campaigns,
    screens,
    tracking: opts.tracking ?? [],
    range: opts.range ?? MAY,
    filters: opts.filters,
  });
}

const CRIUS = 'VIDEO WALL CRIUS';

// --- Periodo / intersección --------------------------------------------------

describe('occupancy — periodo', () => {
  it('1) campaña dentro del periodo aparece', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.totals.distinctCampaigns).toBe(1);
    expect(d.supports[0]!.distinctCampaigns).toBe(1);
  });

  it('2) campaña futura fuera del periodo se excluye', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: '2026-06-10',
          fechaFin: '2026-06-20',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.totals.distinctCampaigns).toBe(0);
    expect(d.supports).toHaveLength(0);
  });

  it('3) campaña terminada fuera del periodo se excluye', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: '2026-03-01',
          fechaFin: '2026-03-20',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.totals.distinctCampaigns).toBe(0);
  });

  it('4) intersección parcial recorta los días-campaña', () => {
    // 2026-04-25..2026-05-04 → dentro de mayo: 05-01..05-04 = 4 días.
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: '2026-04-25',
          fechaFin: '2026-05-04',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.totals.campaignDays).toBe(4);
    expect(d.supports[0]!.campaignDays).toBe(4);
  });

  it('5) fecha inválida genera incidencia y se excluye', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: 'no-fecha',
          fechaFin: '',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.totals.distinctCampaigns).toBe(0);
    expect(d.issues.some((i) => i.code === 'invalid-date')).toBe(true);
  });

  it('40) periodo de un solo día', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: '2026-05-10',
          fechaFin: '2026-05-20',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
      { range: range('2026-05-15', '2026-05-15') },
    );
    expect(d.totals.campaignDays).toBe(1);
    expect(d.totals.peakConcurrentCampaigns).toBe(1);
  });

  it('41) periodo que cruza fin de mes', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          fechaInicio: '2026-05-28',
          fechaFin: '2026-06-03',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
      { range: range('2026-05-30', '2026-06-02') },
    );
    expect(d.totals.campaignDays).toBe(4); // 30,31,01,02
  });
});

// --- Clasificación -----------------------------------------------------------

describe('occupancy — clasificación', () => {
  const cat = [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })];
  const camp = campaign({
    name: 'A',
    nameKey: 'a',
    supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
  });

  it('6) institucional desde tracking', () => {
    const d = build([{ ...camp, tipo: 'PROVEEDOR' }], cat, {
      tracking: [tracking('a', 'institutional')],
    });
    expect(d.supports[0]!.classification).toMatchObject({
      institutional: 1,
      provider: 0,
    });
  });

  it('7) proveedor desde tracking', () => {
    const d = build([{ ...camp, tipo: 'INSTITUCIONAL' }], cat, {
      tracking: [tracking('a', 'provider')],
    });
    expect(d.supports[0]!.classification.provider).toBe(1);
  });

  it('8) clasificación derivada de campaign.tipo', () => {
    const d = build([{ ...camp, tipo: 'Campaña INSTITUCIONAL' }], cat);
    expect(d.supports[0]!.classification.institutional).toBe(1);
  });

  it('9) clasificación pendiente cuando el tipo es ambiguo', () => {
    const d = build([{ ...camp, tipo: 'Digital' }], cat);
    expect(d.supports[0]!.classification.unknown).toBe(1);
  });

  it('33) segmentación institucional/proveedor/pendiente', () => {
    const cat2 = [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })];
    const d = build(
      [
        campaign({
          name: 'I',
          nameKey: 'i',
          tipo: 'INSTITUCIONAL',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'P',
          nameKey: 'p',
          tipo: 'PROVEEDOR',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'U',
          nameKey: 'u',
          tipo: 'Otro',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      cat2,
    );
    expect(d.supports[0]!.classification).toEqual({
      institutional: 1,
      provider: 1,
      unknown: 1,
    });
  });
});

// --- Combinaciones y deduplicación ------------------------------------------

describe('occupancy — combinaciones y dedup', () => {
  it('10) una campaña, una tienda, un soporte', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.supports).toHaveLength(1);
    expect(d.stores).toHaveLength(1);
    expect(d.matrix).toHaveLength(1);
    expect(d.stores[0]!.distinctSupports).toBe(1);
  });

  it('11) una campaña con varios soportes en una tienda', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [
            support({ support: CRIUS, stores: [{ numero: '5' }] }),
            support({ support: 'PANTALLA', stores: [{ numero: '5' }] }),
            support({ support: 'TOTEM', stores: [{ numero: '5' }] }),
          ],
        }),
      ],
      [
        screen({ id: 'a', numero: '5', calendarSupport: CRIUS }),
        screen({ id: 'b', numero: '5', calendarSupport: 'PANTALLA' }),
        screen({ id: 'c', numero: '5', calendarSupport: 'TOTEM' }),
      ],
    );
    const polanco = d.stores[0]!;
    expect(polanco.distinctCampaigns).toBe(1); // una campaña en la tienda
    expect(polanco.distinctSupports).toBe(3); // tres combinaciones tienda-soporte
    expect(polanco.physicalScreens).toBe(3);
    expect(d.matrix).toHaveLength(3);
  });

  it('12) una campaña con un soporte en varias tiendas', () => {
    const stores = Array.from({ length: 20 }, (_, i) => ({
      numero: String(i + 1),
    }));
    const cat = stores.map((s, i) =>
      screen({ id: `s${i}`, numero: s.numero, calendarSupport: CRIUS }),
    );
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores })],
        }),
      ],
      cat,
    );
    expect(d.supports[0]!.distinctCampaigns).toBe(1);
    expect(d.supports[0]!.distinctStores).toBe(20);
    expect(d.supports[0]!.physicalScreens).toBe(20);
  });

  it('18-19) varias pantallas físicas y dedup por screen.id', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [
            support({
              support: CRIUS,
              stores: [{ numero: '5' }, { numero: '5' }],
            }),
          ],
        }),
      ],
      [
        screen({ id: 'a', numero: '5', calendarSupport: CRIUS }),
        screen({ id: 'b', numero: '5', calendarSupport: CRIUS }),
      ],
    );
    // Dos pantallas físicas; la tienda repetida no las duplica.
    expect(d.matrix[0]!.screenIds.sort()).toEqual(['a', 'b']);
    expect(d.stores[0]!.physicalScreens).toBe(2);
    expect(d.stores[0]!.distinctCampaigns).toBe(1);
  });

  it('20) números 003 y 3 cruzan igual', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '003' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '3', calendarSupport: CRIUS })],
    );
    expect(d.stores).toHaveLength(1);
    expect(d.stores[0]!.storeNumber).toBe('3');
    expect(d.stores[0]!.physicalScreens).toBe(1);
  });

  it('21) usa el nombre oficial del catálogo', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [
            support({
              support: CRIUS,
              stores: [{ numero: '5', nombre: 'DEL COMENTARIO' }],
            }),
          ],
        }),
      ],
      [
        screen({
          id: 'a',
          numero: '5',
          calendarSupport: CRIUS,
          nombre: 'Polanco 03',
        }),
      ],
    );
    expect(d.stores[0]!.storeName).toBe('Polanco 03');
  });
});

// --- Pantallas inactivas / incidencias --------------------------------------

describe('occupancy — inactivas e incidencias', () => {
  it('22-23) solo pantalla inactiva no suma y genera incidencia', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS, active: false })],
    );
    expect(d.supports).toHaveLength(0);
    expect(d.issues.some((i) => i.code === 'screen-inactive')).toBe(true);
  });

  it('24) tienda no encontrada', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '999' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.issues.some((i) => i.code === 'store-not-in-catalog')).toBe(true);
  });

  it('25) soporte sin correspondencia en una tienda existente', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: 'TOTEM', stores: [{ numero: '5' }] })],
        }),
      ],
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(d.issues.some((i) => i.code === 'store-support-mismatch')).toBe(
      true,
    );
  });

  it('26) "asignada" sin comentario expande las pantallas activas', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [] })],
        }),
      ],
      [
        screen({ id: 'a', numero: '1', calendarSupport: CRIUS }),
        screen({ id: 'b', numero: '2', calendarSupport: CRIUS }),
      ],
    );
    expect(d.supports[0]!.distinctStores).toBe(2);
    expect(d.supports[0]!.physicalScreens).toBe(2);
  });

  it('27) "asignada" sin pantallas activas genera incidencia', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [] })],
        }),
      ],
      [],
    );
    expect(d.supports).toHaveLength(0);
    expect(d.issues.some((i) => i.code === 'support-not-in-catalog')).toBe(
      true,
    );
  });
});

// --- InStore Media -----------------------------------------------------------

describe('occupancy — InStore Media', () => {
  it("28-29) MUPPI'S y PENDON con tiendas cuentan como demanda sin pantallas físicas", () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [
            support({ support: "MUPPI'S", stores: [{ numero: '5' }] }),
            support({ support: 'PENDON', stores: [{ numero: '5' }] }),
          ],
        }),
      ],
      [
        screen({
          id: 'a',
          numero: '5',
          calendarSupport: 'OTRO',
          nombre: 'Polanco',
        }),
      ],
    );
    const ism = d.supports.filter((s) => s.owner === 'instore-media');
    expect(ism).toHaveLength(2);
    expect(ism.every((s) => s.physicalScreens === 0)).toBe(true);
    expect(ism[0]!.campaigns).toHaveLength(1);
  });

  it('30) InStore Media sin comentario genera incidencia', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: "MUPPI'S", stores: [] })],
        }),
      ],
      [],
    );
    expect(d.issues.some((i) => i.code === 'instore-without-stores')).toBe(
      true,
    );
    expect(d.supports).toHaveLength(0);
  });

  it('usa nombre oficial para InStore cuando la tienda existe', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [
            support({ support: "MUPPI'S", stores: [{ numero: '5' }] }),
          ],
        }),
      ],
      [
        screen({
          id: 'a',
          numero: '5',
          calendarSupport: 'OTRO',
          nombre: 'Polanco Oficial',
        }),
      ],
    );
    expect(d.stores[0]!.storeName).toBe('Polanco Oficial');
  });
});

// --- Guadalajara -------------------------------------------------------------

describe('occupancy — Guadalajara Galerías', () => {
  it('31-32) cuenta una campaña y dos pantallas (CRIUS + CUADRADA)', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          supports: [support({ support: CRIUS, stores: [{ numero: '78' }] })],
        }),
      ],
      [
        screen({
          id: 'crius',
          numero: '78',
          calendarSupport: CRIUS,
          modelo: 'CRIUS',
          nombre: 'L GDL',
        }),
        screen({
          id: 'cuadrada',
          numero: '78',
          calendarSupport: 'VIDEO WALL CUADRADA',
          modelo: 'CUADRADA',
          nombre: 'L GDL',
        }),
      ],
    );
    expect(d.matrix).toHaveLength(1);
    expect(d.matrix[0]!.distinctCampaigns).toBe(1);
    expect(d.matrix[0]!.screenIds.sort()).toEqual(['crius', 'cuadrada']);
    expect(d.stores[0]!.physicalScreens).toBe(2);
  });
});

// --- Pico / distintas / días -------------------------------------------------

describe('occupancy — pico simultáneo y agregados', () => {
  const cat = [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })];

  it('13-15) dos campañas simultáneas → pico 2', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          nameKey: 'a',
          fechaInicio: '2026-05-01',
          fechaFin: '2026-05-10',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'B',
          nameKey: 'b',
          fechaInicio: '2026-05-05',
          fechaFin: '2026-05-15',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      cat,
    );
    expect(d.supports[0]!.peakConcurrentCampaigns).toBe(2);
    expect(d.totals.peakConcurrentCampaigns).toBe(2);
  });

  it('14) dos campañas no simultáneas → pico 1', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          nameKey: 'a',
          fechaInicio: '2026-05-01',
          fechaFin: '2026-05-05',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'B',
          nameKey: 'b',
          fechaInicio: '2026-05-10',
          fechaFin: '2026-05-15',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      cat,
    );
    expect(d.supports[0]!.peakConcurrentCampaigns).toBe(1);
    expect(d.supports[0]!.distinctCampaigns).toBe(2);
  });

  it('16-17) distintas y días-campaña', () => {
    const d = build(
      [
        campaign({
          name: 'A',
          nameKey: 'a',
          fechaInicio: '2026-05-01',
          fechaFin: '2026-05-10',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'B',
          nameKey: 'b',
          fechaInicio: '2026-05-01',
          fechaFin: '2026-05-05',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
      ],
      cat,
    );
    expect(d.supports[0]!.distinctCampaigns).toBe(2);
    expect(d.supports[0]!.campaignDays).toBe(15); // 10 + 5
  });
});

// --- Filtros -----------------------------------------------------------------

describe('occupancy — filtros', () => {
  const cat = [
    screen({ id: 'a', numero: '5', calendarSupport: CRIUS, nombre: 'Polanco' }),
    screen({
      id: 'b',
      numero: '6',
      calendarSupport: 'PANTALLA',
      nombre: 'Satélite',
    }),
  ];
  const camps = [
    campaign({
      name: 'I',
      nameKey: 'i',
      tipo: 'INSTITUCIONAL',
      supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
    }),
    campaign({
      name: 'P',
      nameKey: 'p',
      tipo: 'PROVEEDOR',
      supports: [support({ support: 'PANTALLA', stores: [{ numero: '6' }] })],
    }),
  ];

  it('34) filtro solo institucional', () => {
    const d = build(camps, cat, {
      filters: { classification: 'institutional' },
    });
    expect(d.totals.distinctCampaigns).toBe(1);
    expect(d.supports.every((s) => s.classification.provider === 0)).toBe(true);
  });

  it('35) filtro solo proveedor', () => {
    const d = build(camps, cat, { filters: { classification: 'provider' } });
    expect(d.totals.distinctCampaigns).toBe(1);
    expect(d.supports[0]!.classification.provider).toBe(1);
  });

  it('36) filtro por tienda', () => {
    const d = build(camps, cat, { filters: { store: '5' } });
    expect(d.stores).toHaveLength(1);
    expect(d.stores[0]!.storeNumber).toBe('5');
  });

  it('37) filtro por soporte', () => {
    const d = build(camps, cat, { filters: { support: 'PANTALLA' } });
    expect(d.supports).toHaveLength(1);
    expect(d.supports[0]!.supportName).toBe('PANTALLA');
  });
});

// --- Orden / empates / vacíos ------------------------------------------------

describe('occupancy — orden, empates y vacíos', () => {
  it('38) ordena por mayor carga (pico)', () => {
    const cat = [
      screen({ id: 'a', numero: '5', calendarSupport: CRIUS }),
      screen({ id: 'b', numero: '5', calendarSupport: 'PANTALLA' }),
    ];
    const d = build(
      [
        campaign({
          name: 'A',
          nameKey: 'a',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'B',
          nameKey: 'b',
          supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'C',
          nameKey: 'c',
          supports: [
            support({ support: 'PANTALLA', stores: [{ numero: '5' }] }),
          ],
        }),
      ],
      cat,
    );
    // CRIUS tiene 2 campañas (pico 2), PANTALLA 1 → CRIUS primero.
    expect(d.supports[0]!.supportKey).toBe(CRIUS);
    expect(d.supports[0]!.peakConcurrentCampaigns).toBe(2);
  });

  it('39) empate estable por nombre', () => {
    const cat = [
      screen({ id: 'a', numero: '5', calendarSupport: 'AAA' }),
      screen({ id: 'b', numero: '5', calendarSupport: 'BBB' }),
    ];
    const d = build(
      [
        campaign({
          name: 'A',
          nameKey: 'a',
          supports: [support({ support: 'BBB', stores: [{ numero: '5' }] })],
        }),
        campaign({
          name: 'B',
          nameKey: 'b',
          supports: [support({ support: 'AAA', stores: [{ numero: '5' }] })],
        }),
      ],
      cat,
    );
    // Ambos pico 1 y 1 distinta → orden alfabético por nombre de soporte.
    expect(d.supports.map((s) => s.supportName)).toEqual(['AAA', 'BBB']);
  });

  it('42) cero campañas', () => {
    const d = build([], []);
    expect(d.supports).toHaveLength(0);
    expect(d.stores).toHaveLength(0);
    expect(d.totals).toEqual({
      peakConcurrentCampaigns: 0,
      distinctCampaigns: 0,
      campaignDays: 0,
      distinctStores: 0,
      distinctSupports: 0,
      physicalScreens: 0,
    });
  });

  it('43) totales seguros con denominador cero (sin NaN)', () => {
    const d = build([], []);
    expect(Number.isNaN(d.totals.campaignDays)).toBe(false);
    expect(d.totals.peakConcurrentCampaigns).toBe(0);
  });
});

// --- presetRange -------------------------------------------------------------

describe('presetRange', () => {
  const today = parseCampaignDate('2026-05-14')!; // jueves

  it('hoy es un solo día', () => {
    const r = presetRange('today', today);
    expect(r.start.getTime()).toBe(r.end.getTime());
  });

  it('próximos 7 días abarca 7 días', () => {
    const r = presetRange('next-7', today);
    expect(Math.round((r.end.getTime() - r.start.getTime()) / 86400000)).toBe(
      6,
    );
  });

  it('semana actual va de lunes a domingo', () => {
    const r = presetRange('this-week', today);
    expect(r.start.getUTCDay()).toBe(1); // lunes
    expect(r.end.getUTCDay()).toBe(0); // domingo
  });

  it('mes actual cubre todo el mes', () => {
    const r = presetRange('this-month', today);
    expect(r.start.getUTCDate()).toBe(1);
    expect(r.end.getUTCMonth()).toBe(4); // mayo (0-index)
    expect(r.end.getUTCDate()).toBe(31);
  });
});

describe('buildOccupancyDashboard — serie diaria y dona por clasificación', () => {
  it('la serie cubre cada día civil del periodo', () => {
    const d = buildOccupancyDashboard({
      campaigns: [],
      screens: [],
      tracking: [],
      range: range('2026-05-01', '2026-05-05'),
    });
    expect(d.series).toHaveLength(5);
    expect(d.series[0]?.date.getUTCDate()).toBe(1);
    expect(d.series[4]?.date.getUTCDate()).toBe(5);
    expect(d.series.every((p) => p.total === 0)).toBe(true);
  });

  it('cuenta campañas simultáneas por día y las separa por clasificación', () => {
    const campaigns = [
      campaign({
        name: 'INST',
        tipo: 'INSTITUCIONAL',
        fechaInicio: '2026-05-01',
        fechaFin: '2026-05-03',
        supports: [
          support({ support: 'VIDEO WALL', stores: [{ numero: '1' }] }),
        ],
      }),
      campaign({
        name: 'PROV',
        tipo: 'PROVEEDOR',
        fechaInicio: '2026-05-02',
        fechaFin: '2026-05-04',
        supports: [
          support({ support: 'VIDEO WALL', stores: [{ numero: '1' }] }),
        ],
      }),
    ];
    const screens = [
      screen({ id: 's1', numero: '1', calendarSupport: 'VIDEO WALL' }),
    ];
    const d = buildOccupancyDashboard({
      campaigns,
      screens,
      tracking: [],
      range: range('2026-05-01', '2026-05-05'),
    });
    // Día 2 y 3: ambas activas (pico 2, una de cada clasificación).
    const day2 = d.series[1];
    expect(day2?.total).toBe(2);
    expect(day2?.institutional).toBe(1);
    expect(day2?.provider).toBe(1);
    // Día 5: ninguna activa.
    expect(d.series[4]?.total).toBe(0);
    // Dona: dos campañas distintas del periodo, una por clasificación.
    expect(d.classificationTotals.institutional).toBe(1);
    expect(d.classificationTotals.provider).toBe(1);
    expect(d.classificationTotals.unknown).toBe(0);
  });

  it('la serie respeta el filtro de clasificación', () => {
    const campaigns = [
      campaign({
        name: 'INST',
        tipo: 'INSTITUCIONAL',
        fechaInicio: '2026-05-01',
        fechaFin: '2026-05-10',
        supports: [
          support({ support: 'VIDEO WALL', stores: [{ numero: '1' }] }),
        ],
      }),
      campaign({
        name: 'PROV',
        tipo: 'PROVEEDOR',
        fechaInicio: '2026-05-01',
        fechaFin: '2026-05-10',
        supports: [
          support({ support: 'VIDEO WALL', stores: [{ numero: '1' }] }),
        ],
      }),
    ];
    const screens = [
      screen({ id: 's1', numero: '1', calendarSupport: 'VIDEO WALL' }),
    ];
    const filters: OccupancyFilters = { classification: 'institutional' };
    const d = buildOccupancyDashboard({
      campaigns,
      screens,
      tracking: [],
      range: MAY,
      filters,
    });
    expect(d.classificationTotals.institutional).toBe(1);
    expect(d.classificationTotals.provider).toBe(0);
    expect(d.series.some((p) => p.provider > 0)).toBe(false);
    expect(d.series.some((p) => p.institutional > 0)).toBe(true);
  });
});
