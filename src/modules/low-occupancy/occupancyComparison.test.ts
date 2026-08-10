import { describe, it, expect } from 'vitest';
import { serializeAdmiraCsv } from '@/domain';
import type {
  AdmiraCsvRow,
  AdmiraScreen,
  AdmiraScreenOriginal,
} from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import { analyzeLowOccupancy } from './occupancyAnalysis';
import {
  COMPARISON_LABELS,
  compareOccupancy,
  formatIsoDdMmYyyy,
  pluralizeCentros,
  previousCivilDate,
} from './occupancyComparison';
import type {
  OccupancyAnalysis,
  OccupancyExportGroup,
  OccupancyUnit,
} from './types';

// --- Fixtures puros (control total de cada sección) ---------------------------

function row(articulos: string, centros = 'C'): AdmiraCsvRow {
  return {
    ARTICULOS: articulos,
    BRANDS: '',
    CENTROS: centros,
    CIRCUITO: '',
    RESOLUCION: 'R',
    RETAILERS: 'LIVERPOOL',
    'TIPO DE PASES': '',
  };
}

function unit(key: string, over: Partial<OccupancyUnit> = {}): OccupancyUnit {
  return {
    key,
    storeNumber: key,
    storeName: '',
    centros: '',
    normalization: 'LED',
    resolution: 'R',
    contents: [],
    providerCount: 0,
    level: 'sin-ocupacion',
    recommendedRatio: 3,
    screenIds: [],
    rows: [],
    ...over,
  };
}

function group(over: Partial<OccupancyExportGroup> = {}): OccupancyExportGroup {
  return {
    key: 'LED|R',
    normalization: 'LED',
    resolution: 'R',
    ratio1Units: [],
    ratio3Units: [],
    zeroUnits: [],
    ratio1Rows: [],
    ratio3Rows: [],
    ...over,
  };
}

function analysis(
  groups: OccupancyExportGroup[],
  date = '2026-08-15',
): OccupancyAnalysis {
  return {
    analysisDate: date,
    units: [],
    groups,
    issues: [],
    excludedInstore: [],
    ismExcludedCount: 0,
    summary: {
      totalUnits: 0,
      zero: 0,
      one: 0,
      two: 0,
      threePlus: 0,
      exportableGroups: 0,
      issues: 0,
    },
  };
}

function compareGroup(
  current: OccupancyExportGroup[],
  previous: OccupancyExportGroup[],
) {
  return compareOccupancy(analysis(current), analysis(previous)).groups.get(
    'LED|R',
  )!;
}

describe('previousCivilDate — resta un día civil sin desfase de zona horaria', () => {
  it('resta un día dentro del mismo mes', () => {
    expect(previousCivilDate('2026-08-15')).toBe('2026-08-14');
  });
  it('cruza el cambio de mes', () => {
    expect(previousCivilDate('2026-03-01')).toBe('2026-02-28');
  });
  it('respeta el año bisiesto', () => {
    expect(previousCivilDate('2024-03-01')).toBe('2024-02-29');
  });
  it('cruza el cambio de año', () => {
    expect(previousCivilDate('2026-01-01')).toBe('2025-12-31');
  });
  it('fecha no interpretable se devuelve tal cual', () => {
    expect(previousCivilDate('no-es-fecha')).toBe('no-es-fecha');
  });
});

describe('helpers de presentación — singular/plural y fecha dd/mm/aaaa', () => {
  it('singular con 1, plural en el resto', () => {
    expect(pluralizeCentros(1)).toBe('1 centro');
    expect(pluralizeCentros(0)).toBe('0 centros');
    expect(pluralizeCentros(2)).toBe('2 centros');
  });
  it('formatea AAAA-MM-DD a dd/mm/aaaa', () => {
    expect(formatIsoDdMmYyyy('2026-08-09')).toBe('09/08/2026');
    expect(formatIsoDdMmYyyy('2025-12-31')).toBe('31/12/2025');
  });
  it('las etiquetas cubren los cuatro estados', () => {
    expect(COMPARISON_LABELS['sin-cambios']).toBe('Sin cambios');
    expect(COMPARISON_LABELS.cambio).toBe('Cambió');
    expect(COMPARISON_LABELS.nuevo).toBe('Nuevo');
    expect(COMPARISON_LABELS.vacio).toBe('Ya no tiene contenido');
  });
});

describe('compareOccupancy — estados por sección', () => {
  it('sin cambios aunque cambie el orden de las filas', () => {
    const cmp = compareGroup(
      [group({ ratio1Rows: [row('A'), row('B')] })],
      [group({ ratio1Rows: [row('B'), row('A')] })],
    );
    expect(cmp.ratio1.status).toBe('sin-cambios');
    expect(cmp.overall).toBe('sin-cambios');
    expect(cmp.hasChanges).toBe(false);
  });

  it('cambio en Ratio 1 solamente', () => {
    const cmp = compareGroup(
      [group({ ratio1Rows: [row('A'), row('B')], ratio3Rows: [row('X')] })],
      [group({ ratio1Rows: [row('A')], ratio3Rows: [row('X')] })],
    );
    expect(cmp.ratio1.status).toBe('cambio');
    expect(cmp.ratio3.status).toBe('sin-cambios');
    expect(cmp.overall).toBe('cambio');
  });

  it('cambio en Ratio 3 solamente', () => {
    const cmp = compareGroup(
      [group({ ratio1Rows: [row('A')], ratio3Rows: [row('X'), row('Y')] })],
      [group({ ratio1Rows: [row('A')], ratio3Rows: [row('X')] })],
    );
    expect(cmp.ratio1.status).toBe('sin-cambios');
    expect(cmp.ratio3.status).toBe('cambio');
    expect(cmp.overall).toBe('cambio');
  });

  it('cambio en Sin proveedores (por unidades tienda + norm + resolución)', () => {
    const cmp = compareGroup(
      [group({ zeroUnits: [unit('1'), unit('2')] })],
      [group({ zeroUnits: [unit('1')] })],
    );
    expect(cmp.zero.status).toBe('cambio');
    expect(cmp.zero.entered.map((c) => c.key)).toEqual(['2']);
    expect(cmp.zero.exited).toHaveLength(0);
    // Aunque las filas de ratio no cambien, hay cambio real que reportar.
    expect(cmp.hasChanges).toBe(true);
  });

  it('grupo/ratio nuevo (no existía el día anterior)', () => {
    const cmp = compareGroup([group({ ratio1Rows: [row('A')] })], []);
    expect(cmp.overall).toBe('nuevo');
    expect(cmp.ratio1.status).toBe('nuevo');
  });

  it('grupo/ratio que queda vacío (existía ayer, hoy no)', () => {
    const cmp = compareGroup(
      [],
      [
        group({
          ratio3Rows: [row('X')],
          ratio3Units: [unit('2', { providerCount: 3, recommendedRatio: 3 })],
        }),
      ],
    );
    expect(cmp.overall).toBe('vacio');
    expect(cmp.ratio3.status).toBe('vacio');
    expect(cmp.ratio3.exited.map((c) => c.key)).toEqual(['2']);
  });

  it('detalla los centros que entraron y salieron', () => {
    const cmp = compareGroup(
      [
        group({
          ratio3Rows: [row('X', 'C1')],
          ratio3Units: [unit('1', { centros: 'C1' })],
        }),
      ],
      [
        group({
          ratio3Rows: [row('Y', 'C2')],
          ratio3Units: [unit('2', { centros: 'C2' })],
        }),
      ],
    );
    expect(cmp.ratio3.entered.map((c) => c.key)).toEqual(['1']);
    expect(cmp.ratio3.exited.map((c) => c.key)).toEqual(['2']);
  });

  it('conserva las fechas seleccionada y anterior (consulta histórica)', () => {
    const cmp = compareOccupancy(
      analysis([group()], '2026-01-01'),
      analysis([group()], '2025-12-31'),
    );
    expect(cmp.selectedDate).toBe('2026-01-01');
    expect(cmp.previousDate).toBe('2025-12-31');
  });
});

// --- Integración con analyzeLowOccupancy -------------------------------------

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

describe('compareOccupancy — integración y estabilidad del CSV', () => {
  const screens = [
    screen(
      't2a',
      {
        'Numero de Tienda': '2',
        RESOLUCION: 'R',
        ARTICULOS: 'X',
        CENTROS: 'C2',
      },
      'LED',
    ),
    screen(
      't2b',
      {
        'Numero de Tienda': '2',
        RESOLUCION: 'R',
        ARTICULOS: 'Y',
        CENTROS: 'C2',
      },
      'LED',
    ),
    screen(
      't2c',
      {
        'Numero de Tienda': '2',
        RESOLUCION: 'R',
        ARTICULOS: 'Z',
        CENTROS: 'C2',
      },
      'LED',
    ),
  ];
  const campaigns = [
    campaign('Camp X', 'LED', '2'),
    campaign('Camp Y', 'LED', '2'),
    campaign('Camp Z', 'LED', '2'),
  ];

  it('el orden de las pantallas no marca cambio (mismas filas deduplicadas)', () => {
    const a = analyzeLowOccupancy({
      campaigns,
      screens,
      analysisDate: '2026-08-15',
    });
    const b = analyzeLowOccupancy({
      campaigns,
      screens: [...screens].reverse(),
      analysisDate: '2026-08-14',
    });
    const cmp = compareOccupancy(a, b).groups.get('LED|R')!;
    expect(cmp.ratio3.status).toBe('sin-cambios');
    expect(cmp.overall).toBe('sin-cambios');
  });

  it('comparar no muta los análisis: el CSV sigue idéntico', () => {
    const a = analyzeLowOccupancy({
      campaigns,
      screens,
      analysisDate: '2026-08-15',
    });
    const b = analyzeLowOccupancy({
      campaigns,
      screens,
      analysisDate: '2026-08-14',
    });
    const before = serializeAdmiraCsv(a.groups[0]!.ratio3Rows);
    compareOccupancy(a, b);
    const after = serializeAdmiraCsv(a.groups[0]!.ratio3Rows);
    expect(after).toBe(before);
  });

  it('un cambio real de vigencia sí se detecta', () => {
    // La campaña solo está vigente el 2026-08-31; el día anterior no.
    const cmpCampaigns = [
      { ...campaign('Camp X', 'LED', '2'), fechaInicio: '2026-08-31' },
    ];
    const singleScreen = [
      screen(
        't2a',
        {
          'Numero de Tienda': '2',
          RESOLUCION: 'R',
          ARTICULOS: 'X',
          CENTROS: 'C2',
        },
        'LED',
      ),
    ];
    const today = analyzeLowOccupancy({
      campaigns: cmpCampaigns,
      screens: singleScreen,
      analysisDate: '2026-08-31',
    });
    const yesterday = analyzeLowOccupancy({
      campaigns: cmpCampaigns,
      screens: singleScreen,
      analysisDate: '2026-08-30',
    });
    const cmp = compareOccupancy(today, yesterday).groups.get('LED|R')!;
    // Hoy: 1 proveedor → Ratio 1. Ayer: 0 proveedores → Ratio 3.
    expect(cmp.ratio1.status).toBe('nuevo');
    expect(cmp.ratio3.status).toBe('vacio');
    expect(cmp.overall).toBe('cambio');
    expect(cmp.hasChanges).toBe(true);
  });
});
