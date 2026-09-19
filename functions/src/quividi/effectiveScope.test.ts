import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  buildEffectiveSupportPairs,
  normalizeStore,
  normalizeSupport,
  type CampaignDoc,
  type EkonAssignmentDoc,
  type ScreenDoc,
} from './effectiveScope';

/**
 * Pruebas de caracterización del alcance efectivo Quividi.
 *
 * Congelan el comportamiento vigente (no el deseado) para que cualquier
 * refactor posterior —compartir la caché de asignaciones, paralelizar la
 * disponibilidad— tenga red de seguridad. Si una de estas pruebas cambia,
 * cambió una regla de negocio y necesita decisión documentada.
 */

interface LinkRow {
  campaignNameKey?: string;
  ekonCampaignNumber?: number;
}

interface AssignmentRow {
  campaignNumber?: string;
  active?: boolean;
  conflict?: string | null;
  determinanteKey?: string;
  tienda?: string;
  circuito?: string;
  articulo?: string;
  inicioPeriodo?: string | null;
  finPeriodo?: string | null;
  centroAdministrativo?: boolean;
}

interface FakeData {
  links: Record<string, LinkRow>;
  legacyLinks: LinkRow[];
  assignments: AssignmentRow[];
}

interface Counters {
  linkGets: number;
  legacyQueries: number;
  assignmentQueries: number;
}

function counters(): Counters {
  return { linkGets: 0, legacyQueries: 0, assignmentQueries: 0 };
}

/**
 * Firestore mínimo que replica exactamente las llamadas que hace el módulo:
 * `campaignEkonLinks.doc(id).get()`, la consulta legacy por `campaignNameKey`
 * y `ekonAssignments.where(campaignNumber).where(active == true).get()`.
 */
function fakeDb(data: FakeData, count: Counters): Firestore {
  const db = {
    collection(name: string) {
      if (name === 'campaignEkonLinks') {
        return {
          doc(id: string) {
            return {
              get() {
                count.linkGets += 1;
                const row = data.links[id];
                return Promise.resolve({
                  exists: row !== undefined,
                  data: () => row,
                });
              },
            };
          },
          where(_field: string, _op: string, value: string) {
            return {
              limit(max: number) {
                return {
                  get() {
                    count.legacyQueries += 1;
                    const rows = data.legacyLinks
                      .filter((row) => row.campaignNameKey === value)
                      .slice(0, max)
                      .map((row) => ({ data: () => row }));
                    return Promise.resolve({ docs: rows });
                  },
                };
              },
            };
          },
        };
      }
      if (name === 'ekonAssignments') {
        return {
          where(_field: string, _op: string, campaignNumber: string) {
            return {
              where(_activeField: string, _activeOp: string, active: boolean) {
                return {
                  get() {
                    count.assignmentQueries += 1;
                    const rows = data.assignments
                      .filter(
                        (row) =>
                          row.campaignNumber === campaignNumber &&
                          (row.active ?? false) === active,
                      )
                      .map((row) => ({ data: () => row }));
                    return Promise.resolve({ docs: rows });
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`Colección inesperada: ${name}`);
    },
  };
  return db as unknown as Firestore;
}

function emptyDb(count: Counters = counters()): Firestore {
  return fakeDb({ links: {}, legacyLinks: [], assignments: [] }, count);
}

function screen(
  numero: string,
  calendarSupport: string,
  quividiCameraName = '',
  options: { active?: boolean; nombre?: string } = {},
): ScreenDoc {
  return {
    original: {
      'Numero de Tienda': numero,
      'Nombre de tienda': options.nombre ?? `TIENDA ${numero}`,
    },
    metadata: {
      active: options.active ?? true,
      calendarSupport,
      quividiCameraName,
    },
  };
}

function campaign(
  supports: NonNullable<CampaignDoc['supports']>,
  extra: Partial<CampaignDoc> = {},
): CampaignDoc {
  return {
    name: 'CAMPAÑA DEMO',
    fechaInicio: '2026-03-01',
    fechaFin: '2026-03-31',
    supports,
    ...extra,
  };
}

describe('normalizeStore / normalizeSupport', () => {
  it('normaliza el número de tienda quitando ceros a la izquierda', () => {
    expect(normalizeStore('007')).toBe('7');
    expect(normalizeStore(' 78 ')).toBe('78');
  });

  it('normaliza soportes sin acentos, sin apóstrofes y en mayúsculas', () => {
    expect(normalizeSupport("muppi's")).toBe('MUPPIS');
    expect(normalizeSupport('  banner   digital ')).toBe('BANNER DIGITAL');
    expect(normalizeSupport('MEGAMUPI DIGITAL')).toBe('MEGA MUPI DIGITAL');
  });
});

describe('buildEffectiveSupportPairs · precedencia del alcance', () => {
  it('usa las tiendas explícitas del Calendario (calendar-selected)', async () => {
    const screens = [
      screen('7', 'BANNER DIGITAL', 'CAM-7'),
      screen('78', 'BANNER DIGITAL', 'CAM-78'),
      screen('99', 'BANNER DIGITAL', 'CAM-99'),
    ];
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        {
          support: 'BANNER DIGITAL',
          stores: [{ numero: '007' }, { numero: '78' }],
          scope: 'selected',
        },
      ]),
      screens,
    );

    expect(result.pairs.map((pair) => pair.storeNumber).sort()).toEqual([
      '7',
      '78',
    ]);
    expect(
      result.pairs.every((pair) => pair.source === 'calendar-selected'),
    ).toBe(true);
    expect(
      result.pairs
        .map((pair) => pair.cameraNames)
        .flat()
        .sort(),
    ).toEqual(['CAM-7', 'CAM-78']);
    expect(result.origins).toEqual([
      {
        support: 'BANNER DIGITAL',
        source: 'calendar-selected',
        pairCount: 2,
        ekonNumber: null,
      },
    ]);
  });

  it('conserva el par aunque la tienda no exista en el catálogo (sin cámaras)', async () => {
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        {
          support: 'BANNER DIGITAL',
          stores: [{ numero: '404', nombre: 'TIENDA FANTASMA' }],
          scope: 'selected',
        },
      ]),
      [screen('7', 'BANNER DIGITAL', 'CAM-7')],
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]?.cameraNames).toEqual([]);
    expect(result.pairs[0]?.storeName).toBe('TIENDA FANTASMA');
  });

  it('expande a circuito completo con "todas" explícito (calendar-all)', async () => {
    const screens = [
      screen('7', 'BANNER DIGITAL', 'CAM-7'),
      screen('78', 'BANNER DIGITAL', 'CAM-78'),
      screen('12', 'MEGA MUPI DIGITAL', 'CAM-12'),
    ];
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        {
          support: 'BANNER DIGITAL',
          stores: [],
          scopeSource: 'comment-explicit-all',
        },
      ]),
      screens,
    );

    expect(result.pairs.map((pair) => pair.storeNumber).sort()).toEqual([
      '7',
      '78',
    ]);
    expect(result.origins[0]?.source).toBe('calendar-all');
  });

  it('usa circuito completo sin comentario solo para CRIUS y Poster LED', async () => {
    const screens = [
      screen('7', 'VIDEO WALL CRIUS', 'CAM-CRIUS-7'),
      screen('78', 'VIDEO WALL CRIUS', 'CAM-CRIUS-78'),
    ];
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([{ support: 'VIDEO WALL CRIUS', stores: [] }]),
      screens,
    );

    expect(result.origins[0]?.source).toBe('calendar-full-circuit');
    expect(result.pairs).toHaveLength(2);
  });

  it('deja el alcance sin resolver cuando no hay comentario, excepción ni Ekon', async () => {
    const count = counters();
    const result = await buildEffectiveSupportPairs(
      emptyDb(count),
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [] }]),
      [screen('7', 'BANNER DIGITAL', 'CAM-7')],
    );

    expect(result.pairs).toEqual([]);
    expect(result.origins).toEqual([
      {
        support: 'BANNER DIGITAL',
        source: 'unresolved',
        pairCount: 0,
        ekonNumber: null,
      },
    ]);
    // El alcance no resuelto no inventa tiendas: se consultó Ekon y no había.
    expect(count.linkGets).toBe(1);
  });

  it('marca como unresolved un soporte con scope invalid sin consultar Ekon', async () => {
    const count = counters();
    const result = await buildEffectiveSupportPairs(
      emptyDb(count),
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [], scope: 'invalid' }]),
      [screen('7', 'BANNER DIGITAL', 'CAM-7')],
    );

    expect(result.pairs).toEqual([]);
    expect(result.origins[0]?.source).toBe('unresolved');
    expect(count.linkGets).toBe(0);
  });

  it('ignora pantallas inactivas en el circuito completo y en las cámaras', async () => {
    const screens = [
      screen('7', 'VIDEO WALL CRIUS', 'CAM-7'),
      screen('78', 'VIDEO WALL CRIUS', 'CAM-78', { active: false }),
    ];
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([{ support: 'VIDEO WALL CRIUS', stores: [] }]),
      screens,
    );

    expect(result.pairs.map((pair) => pair.storeNumber)).toEqual(['7']);
  });

  it('deduplica el mismo Tienda + Soporte declarado dos veces', async () => {
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        {
          support: 'BANNER DIGITAL',
          stores: [{ numero: '7' }],
          scope: 'selected',
        },
        {
          support: 'BANNER DIGITAL',
          stores: [{ numero: '007' }],
          scope: 'selected',
        },
      ]),
      [screen('7', 'BANNER DIGITAL', 'CAM-7')],
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.origins).toHaveLength(2);
  });
});

describe('buildEffectiveSupportPairs · alias de soporte', () => {
  it("traduce MUPPI'S a MEGA MUPI DIGITAL y PENDON a BANNER DIGITAL", async () => {
    const screens = [
      screen('7', 'MEGA MUPI DIGITAL', 'CAM-MUPI'),
      screen('7', 'BANNER DIGITAL', 'CAM-BANNER'),
    ];
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        { support: "MUPPI'S", stores: [{ numero: '7' }], scope: 'selected' },
        { support: 'PENDON', stores: [{ numero: '7' }], scope: 'selected' },
      ]),
      screens,
    );

    expect(result.pairs.map((pair) => pair.support).sort()).toEqual([
      'BANNER DIGITAL',
      'MEGA MUPI DIGITAL',
    ]);
    expect(
      result.pairs
        .map((pair) => pair.cameraNames)
        .flat()
        .sort(),
    ).toEqual(['CAM-BANNER', 'CAM-MUPI']);
  });

  it('tolera el alias MEGAMUPI DIGITAL del catálogo', async () => {
    const result = await buildEffectiveSupportPairs(
      emptyDb(),
      'camp-1',
      campaign([
        {
          support: 'MEGAMUPI DIGITAL',
          stores: [{ numero: '7' }],
          scope: 'selected',
        },
      ]),
      [screen('7', 'MEGA MUPI DIGITAL', 'CAM-MUPI')],
    );

    expect(result.pairs[0]?.support).toBe('MEGA MUPI DIGITAL');
    expect(result.pairs[0]?.cameraNames).toEqual(['CAM-MUPI']);
  });
});

describe('buildEffectiveSupportPairs · fallback Ekon (cocomercialización)', () => {
  const screens = [
    screen('7', 'BANNER DIGITAL', 'CAM-7'),
    screen('78', 'BANNER DIGITAL', 'CAM-78'),
    screen('99', 'BANNER DIGITAL', 'CAM-99'),
  ];

  function assignment(over: Partial<AssignmentRow> = {}): AssignmentRow {
    return {
      campaignNumber: '900',
      active: true,
      conflict: null,
      determinanteKey: '7',
      tienda: 'LIVERPOOL SANTA FE',
      circuito: 'ESPECTACULAR IN STORE',
      inicioPeriodo: '2026-03-05',
      finPeriodo: '2026-03-20',
      centroAdministrativo: false,
      ...over,
    };
  }

  it('deriva tiendas de las asignaciones vigentes y compatibles', async () => {
    const count = counters();
    const db = fakeDb(
      {
        links: { 'camp-1': { ekonCampaignNumber: 900 } },
        legacyLinks: [],
        assignments: [
          assignment(),
          assignment({ determinanteKey: '78', tienda: 'LIVERPOOL PERISUR' }),
        ],
      },
      count,
    );
    const result = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [] }]),
      screens,
    );

    expect(result.pairs.map((pair) => pair.storeNumber).sort()).toEqual([
      '7',
      '78',
    ]);
    expect(result.origins).toEqual([
      {
        support: 'BANNER DIGITAL',
        source: 'ekon',
        pairCount: 2,
        ekonNumber: 900,
      },
    ]);
    expect(count.assignmentQueries).toBe(1);
  });

  it('excluye centro administrativo, periodo sin solape y circuito incompatible', async () => {
    const db = fakeDb(
      {
        links: { 'camp-1': { ekonCampaignNumber: 900 } },
        legacyLinks: [],
        assignments: [
          assignment({ determinanteKey: '7', centroAdministrativo: true }),
          assignment({
            determinanteKey: '78',
            inicioPeriodo: '2026-01-01',
            finPeriodo: '2026-02-01',
          }),
          assignment({ determinanteKey: '99', circuito: 'MEGA MUPI' }),
        ],
      },
      counters(),
    );
    const result = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [] }]),
      screens,
    );

    expect(result.pairs).toEqual([]);
    expect(result.origins[0]).toEqual({
      support: 'BANNER DIGITAL',
      source: 'unresolved',
      pairCount: 0,
      ekonNumber: 900,
    });
  });

  it('descarta asignaciones con conflicto declarado', async () => {
    const db = fakeDb(
      {
        links: { 'camp-1': { ekonCampaignNumber: 900 } },
        legacyLinks: [],
        assignments: [assignment({ conflict: 'duplicada' })],
      },
      counters(),
    );
    const result = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [] }]),
      screens,
    );

    expect(result.pairs).toEqual([]);
  });

  it('acepta el artículo MEGA MUPI DIGITAL como circuito MEGA MUPI', async () => {
    const db = fakeDb(
      {
        links: { 'camp-1': { ekonCampaignNumber: 900 } },
        legacyLinks: [],
        assignments: [
          assignment({
            circuito: undefined,
            articulo: 'MEGA MUPI DIGITAL',
            determinanteKey: '7',
          }),
        ],
      },
      counters(),
    );
    const result = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([{ support: 'MEGA MUPI DIGITAL', stores: [] }]),
      [screen('7', 'MEGA MUPI DIGITAL', 'CAM-MUPI-7')],
    );

    expect(result.pairs.map((pair) => pair.storeNumber)).toEqual(['7']);
    expect(result.pairs[0]?.source).toBe('ekon');
  });

  it('resuelve el vínculo legacy por campaignNameKey cuando no hay doc exacto', async () => {
    const count = counters();
    const db = fakeDb(
      {
        links: {},
        legacyLinks: [
          { campaignNameKey: 'clave-legacy', ekonCampaignNumber: 900 },
        ],
        assignments: [assignment()],
      },
      count,
    );
    const result = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([{ support: 'BANNER DIGITAL', stores: [] }], {
        nameKey: 'clave-legacy',
      }),
      screens,
    );

    expect(result.pairs.map((pair) => pair.storeNumber)).toEqual(['7']);
    expect(count.linkGets).toBe(1);
    expect(count.legacyQueries).toBe(1);
  });

  it('memoiza el número Ekon dentro de una misma campaña', async () => {
    const count = counters();
    const db = fakeDb(
      {
        links: { 'camp-1': { ekonCampaignNumber: 900 } },
        legacyLinks: [],
        assignments: [
          assignment({ determinanteKey: '7' }),
          assignment({
            determinanteKey: '7',
            circuito: 'VIDEOWALL',
            campaignNumber: '900',
          }),
        ],
      },
      count,
    );
    await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign([
        { support: 'BANNER DIGITAL', stores: [] },
        { support: 'PANTALLAS CUADRADAS', stores: [] },
      ]),
      [...screens, screen('7', 'PANTALLAS CUADRADAS', 'CAM-CUAD-7')],
    );

    expect(count.linkGets).toBe(1);
    expect(count.assignmentQueries).toBe(1);
  });
});

describe('buildEffectiveSupportPairs · caché de asignaciones entre campañas', () => {
  const screens = [screen('7', 'BANNER DIGITAL', 'CAM-7')];
  const data: FakeData = {
    links: {
      'camp-1': { ekonCampaignNumber: 900 },
      'camp-2': { ekonCampaignNumber: 900 },
    },
    legacyLinks: [],
    assignments: [
      {
        campaignNumber: '900',
        active: true,
        conflict: null,
        determinanteKey: '7',
        tienda: 'LIVERPOOL SANTA FE',
        circuito: 'ESPECTACULAR IN STORE',
        inicioPeriodo: '2026-03-05',
        finPeriodo: '2026-03-20',
        centroAdministrativo: false,
      },
    ],
  };
  const supports = [{ support: 'BANNER DIGITAL', stores: [] }];

  it('sin caché compartida repite la consulta a ekonAssignments', async () => {
    const count = counters();
    const db = fakeDb(data, count);
    await buildEffectiveSupportPairs(db, 'camp-1', campaign(supports), screens);
    await buildEffectiveSupportPairs(db, 'camp-2', campaign(supports), screens);

    expect(count.assignmentQueries).toBe(2);
  });

  it('con caché compartida consulta ekonAssignments una sola vez y da el mismo resultado', async () => {
    const count = counters();
    const db = fakeDb(data, count);
    const cache = new Map<number, EkonAssignmentDoc[]>();
    const first = await buildEffectiveSupportPairs(
      db,
      'camp-1',
      campaign(supports),
      screens,
      cache,
    );
    const second = await buildEffectiveSupportPairs(
      db,
      'camp-2',
      campaign(supports),
      screens,
      cache,
    );

    expect(count.assignmentQueries).toBe(1);
    expect(second.pairs).toEqual(first.pairs);
    expect(second.origins).toEqual(first.origins);
  });
});
