import { describe, it, expect } from 'vitest';
import { buildCampaignReport } from './campaignReport';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

// --- Fixtures ---------------------------------------------------------------

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
  over: Partial<StoredCampaign> & { name: string },
): StoredCampaign {
  const base: ParsedCampaign = {
    row: 2,
    name: over.name,
    tipo: over.tipo ?? '',
    vendidoPor: over.vendidoPor ?? 'LIVERPOOL',
    fechaInicio: over.fechaInicio ?? '2026-05-01',
    fechaFin: over.fechaFin ?? '2026-05-31',
    mes: over.mes ?? '',
    link: over.link ?? '',
    supports: over.supports ?? [],
  };
  return {
    ...base,
    id: over.id ?? `c-${over.name}`,
    nameKey: over.nameKey ?? over.name.toLowerCase(),
    signature: over.signature ?? '',
  };
}

const CRIUS = 'VIDEO WALL CRIUS';

function ekon(entries: [string, number][]): ReadonlyMap<string, number> {
  return new Map(entries);
}

// --- Ekon en las filas ------------------------------------------------------

describe('buildCampaignReport — Ekon', () => {
  it('repite el número Ekon en todas las filas de la campaña', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '10', RESOLUCION: 'R1' },
        'VIDEO WALL',
      ),
      screen(
        's2',
        { 'Numero de Tienda': '20', RESOLUCION: 'R2' },
        'VIDEO WALL',
      ),
    ];
    const c = campaign({
      name: 'Campaña A',
      nameKey: 'campaña a',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [
            { numero: '10', nombre: 'T10' },
            { numero: '20', nombre: 'T20' },
          ],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([[c.id, 12345]]));
    expect(report.rows).toHaveLength(2);
    expect(report.rows.every((r) => r.ekonNumber === 12345)).toBe(true);
  });

  it('deja Ekon en null cuando la campaña no tiene asociación (no inventa 0)', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '10', RESOLUCION: 'R' }, 'VIDEO WALL'),
    ];
    const c = campaign({
      name: 'Sin Ekon',
      nameKey: 'sin ekon',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [{ numero: '10', nombre: 'T10' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.ekonNumber).toBeNull();
  });
});

// --- Contenido y configuración ----------------------------------------------

describe('buildCampaignReport — contenido', () => {
  it('incluye número/nombre de tienda y la configuración completa', () => {
    const screens = [
      screen(
        's1',
        {
          'Numero de Tienda': '0078',
          'Nombre de tienda': 'L GUADALAJARA',
          'TIPO DE pantallas': 'LED',
          Modelo: 'CUADRADA',
          CIRCUITO: 'C1',
          RESOLUCION: '900x900',
          FORMATO: 'MP4',
          'Nombre en plataforma': 'GDL-CRIUS',
        },
        CRIUS,
      ),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: CRIUS,
          owner: 'liverpool',
          stores: [{ numero: '78', nombre: 'L GUADALAJARA' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    const row = report.rows[0]!;
    expect(row.storeNumber).toBe('78');
    expect(row.storeName).toBe('L GUADALAJARA');
    expect(row.liverpoolSupport).toBe(CRIUS);
    expect(row.screenType).toBe('LED');
    expect(row.model).toBe('CUADRADA');
    expect(row.circuit).toBe('C1');
    expect(row.resolution).toBe('900x900');
    expect(row.format).toBe('MP4');
    expect(row.platformName).toBe('GDL-CRIUS');
  });

  it('deduplica configuraciones idénticas (no una fila por pantalla física)', () => {
    const common = {
      'Numero de Tienda': '5',
      'Nombre de tienda': 'T5',
      'TIPO DE pantallas': 'LED',
      Modelo: 'M',
      CIRCUITO: 'C',
      RESOLUCION: 'R',
      FORMATO: 'F',
      'Nombre en plataforma': 'P',
    };
    const screens = [
      screen('s1', common, 'SOPORTE'),
      screen('s2', common, 'SOPORTE'),
      screen('s3', common, 'SOPORTE'),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOPORTE',
          owner: 'liverpool',
          stores: [{ numero: '5', nombre: 'T5' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.rows).toHaveLength(1);
  });

  it('separa filas al cambiar tienda, soporte, modelo o resolución', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R1', Modelo: 'A' },
        'SOP',
      ),
      // misma tienda/soporte, distinta resolución → otra fila
      screen(
        's2',
        { 'Numero de Tienda': '1', RESOLUCION: 'R2', Modelo: 'A' },
        'SOP',
      ),
      // misma tienda/soporte/resolución, distinto modelo → otra fila
      screen(
        's3',
        { 'Numero de Tienda': '1', RESOLUCION: 'R1', Modelo: 'B' },
        'SOP',
      ),
      // distinta tienda → otra fila
      screen(
        's4',
        { 'Numero de Tienda': '2', RESOLUCION: 'R1', Modelo: 'A' },
        'SOP',
      ),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '2', nombre: '' },
          ],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.rows).toHaveLength(4);
  });

  it('no expone ningún campo "Cantidad" ni metadatos SIGNAM', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '1', RESOLUCION: 'R' }, 'SOP'),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    const keys = Object.keys(report.rows[0]!);
    expect(keys).not.toContain('Cantidad');
    expect(keys).not.toContain('cantidad');
    expect(keys).not.toContain('active');
    expect(keys).not.toContain('version');
    expect(keys).not.toContain('createdAt');
  });
});

// --- Homónimas, inactivas, incidencias, reglas ------------------------------

describe('buildCampaignReport — reglas de cruce', () => {
  it('no mezcla campañas homónimas con datos/fechas distintas', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '1', RESOLUCION: 'R' }, 'SOP'),
      screen('s2', { 'Numero de Tienda': '2', RESOLUCION: 'R' }, 'SOP'),
    ];
    const flightA = campaign({
      name: 'COLCHONIZA',
      id: 'a',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-01-15',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    const flightB = campaign({
      name: 'COLCHONIZA',
      id: 'b',
      fechaInicio: '2026-03-01',
      fechaFin: '2026-03-15',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '2', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([flightA, flightB], screens, ekon([]));
    expect(report.rows).toHaveLength(2);
    const a = report.rows.filter((r) => r.startDate === '2026-01-01');
    const b = report.rows.filter((r) => r.startDate === '2026-03-01');
    expect(a).toHaveLength(1);
    expect(a[0]!.storeNumber).toBe('1');
    expect(b).toHaveLength(1);
    expect(b[0]!.storeNumber).toBe('2');
  });

  it('excluye pantallas inactivas y genera incidencia', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '1', RESOLUCION: 'R' },
        'SOP',
        false, // inactiva
      ),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.rows).toHaveLength(0);
    expect(report.issues.some((i) => i.code === 'screen-inactive')).toBe(true);
  });

  it('produce incidencias para cruces fallidos (tienda no en catálogo)', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '1', RESOLUCION: 'R' }, 'SOP'),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '999', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.issues.some((i) => i.code === 'store-not-in-catalog')).toBe(
      true,
    );
  });

  it('excluye InStore Media y lo reporta como incidencia', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '1', RESOLUCION: 'R' }, 'SOP'),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: "MUPPI'S",
          owner: 'instore-media',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    expect(report.rows).toHaveLength(0);
    expect(report.issues.some((i) => i.code === 'instore-excluded')).toBe(true);
  });

  it('respeta la excepción de Guadalajara (78 + VIDEO WALL CRIUS añade CUADRADA)', () => {
    const screens = [
      screen(
        's1',
        { 'Numero de Tienda': '78', RESOLUCION: 'R1', Modelo: 'HORIZONTAL' },
        CRIUS,
      ),
      screen(
        's2',
        { 'Numero de Tienda': '78', RESOLUCION: '900x900', Modelo: 'CUADRADA' },
        'OTRO SOPORTE',
      ),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: CRIUS,
          owner: 'liverpool',
          stores: [{ numero: '78', nombre: '' }],
        },
      ],
    });
    const report = buildCampaignReport([c], screens, ekon([]));
    // La CUADRADA de la tienda 78 se agrega aunque su soporte sea otro.
    expect(report.rows.some((r) => r.model === 'CUADRADA')).toBe(true);
    expect(report.rows).toHaveLength(2);
  });

  it('construye el índice una sola vez si se le pasa uno prearmado', () => {
    const screens = [
      screen('s1', { 'Numero de Tienda': '1', RESOLUCION: 'R' }, 'SOP'),
    ];
    const c = campaign({
      name: 'Camp',
      supports: [
        {
          support: 'SOP',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    // Índice vacío prearmado → sin filas (demuestra que se usa el índice dado).
    const report = buildCampaignReport([c], screens, ekon([]), {
      active: new Map(),
      inactive: new Map(),
      activeByStore: new Map(),
      activeBySupport: new Map(),
    });
    expect(report.rows).toHaveLength(0);
  });
});
