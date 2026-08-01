import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  buildCampaignPptPlan,
  buildCampaignPpt,
  pptFileName,
  vigenciaText,
  INSTORE_ARTICULOS_FALLBACK,
  type PptCampaignInput,
} from './pptExport';
import {
  classifySupport,
  type AdmiraScreen,
  type SupportOwner,
} from '@/domain';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';

// --- Fixtures ---------------------------------------------------------------

function screen(over: {
  id: string;
  numero: string;
  nombre?: string;
  calendarSupport?: string;
  articulos?: string;
  modelo?: string;
  active?: boolean;
}): AdmiraScreen {
  return {
    id: over.id,
    original: {
      'TIPO DE pantallas': '',
      CENTROS: '',
      CIRCUITO: '',
      RESOLUCION: '',
      FORMATO: '',
      'Nombre en plataforma': '',
      'TIPO DE PASES': '',
      'Numero de Tienda': over.numero,
      'Nombre de tienda': over.nombre ?? 'Tienda Oficial',
      Modelo: over.modelo ?? '',
      ARTICULOS: over.articulos ?? 'ART-DEFAULT',
      BRANDS: '',
    },
    metadata: {
      active: over.active ?? true,
      createdAt: 0,
      updatedAt: 0,
      createdBy: '',
      updatedBy: '',
      source: '',
      sourceSheet: '',
      sourceRow: 0,
      deactivationReason: null,
      version: 1,
      calendarSupport: over.calendarSupport ?? '',
    },
  };
}

function support(over: {
  support: string;
  owner?: SupportOwner;
  stores?: { numero: string; nombre?: string }[];
}): CampaignSupport {
  return {
    support: over.support,
    owner: over.owner ?? classifySupport(over.support),
    stores: (over.stores ?? []).map((s) => ({
      numero: s.numero,
      nombre: s.nombre ?? '',
    })),
  };
}

function campaign(over: Partial<PptCampaignInput>): PptCampaignInput {
  return {
    name: over.name ?? 'LOREAL',
    fechaInicio: over.fechaInicio ?? '2026-05-26',
    fechaFin: over.fechaFin ?? '2026-06-15',
    supports: over.supports ?? [],
  };
}

const CRIUS = 'VIDEO WALL CRIUS';

// --- Plan: pantallas físicas y deduplicación --------------------------------

describe('buildCampaignPptPlan — pantallas físicas', () => {
  it('1) una diapositiva por pantalla física', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
      }),
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(plan.slides).toHaveLength(1);
  });

  it('2) dos pantallas distintas con misma tienda y soporte → dos diapositivas', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
      }),
      [
        screen({ id: 'a', numero: '5', calendarSupport: CRIUS }),
        screen({ id: 'b', numero: '5', calendarSupport: CRIUS }),
      ],
    );
    expect(plan.slides.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('3) el mismo screen.id encontrado dos veces se deduplica', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({
            support: CRIUS,
            stores: [{ numero: '5' }, { numero: '5' }],
          }),
        ],
      }),
      [screen({ id: 'a', numero: '5', calendarSupport: CRIUS })],
    );
    expect(plan.slides).toHaveLength(1);
  });

  it('4) 0078 y 78 cruzan correctamente', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [support({ support: CRIUS, stores: [{ numero: '0078' }] })],
      }),
      [screen({ id: 'a', numero: '78', calendarSupport: CRIUS })],
    );
    expect(plan.slides).toHaveLength(1);
    expect(plan.slides[0]!.storeNumber).toBe('78');
  });

  it('5-8) usa nombre oficial, soporte solicitado, calendarSupport y ARTICULOS', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({
            support: 'PANTALLA LOBBY',
            stores: [{ numero: '5', nombre: 'NOMBRE DEL COMENTARIO' }],
          }),
        ],
      }),
      [
        screen({
          id: 'a',
          numero: '5',
          nombre: 'Polanco 03',
          calendarSupport: 'PANTALLA LOBBY',
          articulos: 'VW 914x908',
        }),
      ],
    );
    const s = plan.slides[0]!;
    expect(s.storeName).toBe('Polanco 03'); // catálogo, no el comentario
    expect(s.requestedSupport).toBe('PANTALLA LOBBY');
    expect(s.calendarSupport).toBe('PANTALLA LOBBY');
    expect(s.articulos).toBe('VW 914x908');
  });
});

// --- Asignada sin comentario / inactivas ------------------------------------

describe('buildCampaignPptPlan — expansión e inactivas', () => {
  it('9) "asignada" sin comentario expande todas las pantallas activas del soporte', () => {
    const plan = buildCampaignPptPlan(
      campaign({ supports: [support({ support: 'PANTALLA', stores: [] })] }),
      [
        screen({ id: 'a', numero: '1', calendarSupport: 'PANTALLA' }),
        screen({ id: 'b', numero: '2', calendarSupport: 'PANTALLA' }),
        screen({ id: 'c', numero: '3', calendarSupport: 'OTRO' }),
      ],
    );
    expect(plan.slides.map((s) => s.key)).toEqual(['a', 'b']);
  });

  it('9b) "asignada" sin pantallas activas genera incidencia', () => {
    const plan = buildCampaignPptPlan(
      campaign({ supports: [support({ support: 'PANTALLA', stores: [] })] }),
      [],
    );
    expect(plan.slides).toHaveLength(0);
    expect(
      plan.issues.some((i) => i.kind === 'assigned-no-active-screens'),
    ).toBe(true);
  });

  it('10-11) solo pantalla inactiva: no genera diapositiva y sí incidencia', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [support({ support: 'PANTALLA', stores: [{ numero: '5' }] })],
      }),
      [
        screen({
          id: 'a',
          numero: '5',
          calendarSupport: 'PANTALLA',
          active: false,
        }),
      ],
    );
    expect(plan.slides).toHaveLength(0);
    expect(plan.issues.some((i) => i.kind === 'only-inactive')).toBe(true);
  });

  it('distingue tienda inexistente de soporte sin correspondencia', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({
            support: 'PANTALLA',
            stores: [{ numero: '5' }, { numero: '999' }],
          }),
        ],
      }),
      [screen({ id: 'a', numero: '5', calendarSupport: 'OTRO' })],
    );
    const kinds = plan.issues.map((i) => i.kind);
    expect(kinds).toContain('store-support-mismatch'); // 5 existe, otro soporte
    expect(kinds).toContain('store-not-in-catalog'); // 999 no existe
  });
});

// --- InStore Media ----------------------------------------------------------

describe('buildCampaignPptPlan — InStore Media', () => {
  it('12) ISM con tiendas genera una diapositiva por tienda-soporte', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({
            support: "MUPPI'S",
            stores: [{ numero: '7' }, { numero: '8' }],
          }),
        ],
      }),
      [
        screen({ id: 'x', numero: '7', nombre: 'Tienda 7' }),
        screen({ id: 'y', numero: '8', nombre: 'Tienda 8' }),
      ],
    );
    expect(plan.slides).toHaveLength(2);
    expect(plan.slides[0]!.owner).toBe('instore-media');
    expect(plan.slides[0]!.articulos).toBe(INSTORE_ARTICULOS_FALLBACK);
    expect(plan.slides[0]!.storeName).toBe('Tienda 7');
  });

  it('13) ISM sin comentario genera incidencia', () => {
    const plan = buildCampaignPptPlan(
      campaign({ supports: [support({ support: "MUPPI'S", stores: [] })] }),
      [],
    );
    expect(plan.slides).toHaveLength(0);
    expect(
      plan.issues.some((i) => i.kind === 'instore-assigned-no-comment'),
    ).toBe(true);
  });

  it('14) tienda ISM sin nombre en catálogo genera incidencia y no diapositiva', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({ support: "MUPPI'S", stores: [{ numero: '999' }] }),
        ],
      }),
      [screen({ id: 'x', numero: '7', nombre: 'Tienda 7' })],
    );
    expect(plan.slides).toHaveLength(0);
    expect(plan.issues.some((i) => i.kind === 'instore-store-no-name')).toBe(
      true,
    );
  });
});

// --- Guadalajara ------------------------------------------------------------

describe('buildCampaignPptPlan — Guadalajara Galerías', () => {
  it('15) tienda 78 + VIDEO WALL CRIUS genera CRIUS y CUADRADA', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [support({ support: CRIUS, stores: [{ numero: '78' }] })],
      }),
      [
        screen({
          id: 'crius',
          numero: '78',
          calendarSupport: CRIUS,
          modelo: 'CRIUS',
        }),
        screen({
          id: 'cuadrada',
          numero: '78',
          calendarSupport: 'VIDEO WALL CUADRADA',
          modelo: 'CUADRADA',
        }),
      ],
    );
    expect(plan.slides.map((s) => s.key).sort()).toEqual(
      ['cuadrada', 'crius'].sort(),
    );
  });
});

// --- Nombre de archivo y vigencia -------------------------------------------

describe('pptFileName', () => {
  it('16) incluye inicio y fin en dd-mm-aaaa', () => {
    expect(pptFileName('LOREAL', '2026-05-26', '2026-06-15')).toBe(
      'Evidencias_LOREAL_26-05-2026_al_15-06-2026.pptx',
    );
  });

  it('17) sanitiza caracteres inválidos y espacios', () => {
    const name = pptFileName('A/B:C*?"<>| D', '2026-05-26', '2026-06-15');
    expect(name).toBe('Evidencias_ABC_D_26-05-2026_al_15-06-2026.pptx');
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });

  it('18) fecha faltante produce sin-fecha', () => {
    expect(pptFileName('X', '', '2026-06-15')).toBe(
      'Evidencias_X_sin-fecha_al_15-06-2026.pptx',
    );
  });
});

describe('vigenciaText', () => {
  it('muestra vigencia dd/mm/aaaa cuando hay ambas fechas', () => {
    const plan = buildCampaignPptPlan(campaign({}), []);
    expect(vigenciaText(plan)).toBe('Vigencia: 26/05/2026 al 15/06/2026');
  });

  it('muestra "Fecha no disponible" si falta una fecha', () => {
    const plan = buildCampaignPptPlan(campaign({ fechaFin: '' }), []);
    expect(vigenciaText(plan)).toBe('Fecha no disponible');
  });
});

describe('buildCampaignPptPlan — incidencias de fecha', () => {
  it('19) fecha de inicio faltante produce incidencia', () => {
    const plan = buildCampaignPptPlan(campaign({ fechaInicio: '' }), []);
    expect(plan.issues.some((i) => i.kind === 'missing-start-date')).toBe(true);
  });
});

// --- Orden estable ----------------------------------------------------------

describe('buildCampaignPptPlan — orden', () => {
  it('25) conserva orden de soportes, tiendas y pantallas del catálogo', () => {
    const plan = buildCampaignPptPlan(
      campaign({
        supports: [
          support({ support: CRIUS, stores: [{ numero: '5' }] }),
          support({
            support: 'PANTALLA',
            stores: [{ numero: '3' }, { numero: '4' }],
          }),
        ],
      }),
      [
        screen({ id: 'a', numero: '5', calendarSupport: CRIUS }),
        screen({ id: 'b1', numero: '3', calendarSupport: 'PANTALLA' }),
        screen({ id: 'b2', numero: '3', calendarSupport: 'PANTALLA' }),
        screen({ id: 'c', numero: '4', calendarSupport: 'PANTALLA' }),
      ],
    );
    expect(plan.slides.map((s) => s.key)).toEqual(['a', 'b1', 'b2', 'c']);
  });
});

// --- Serialización real (estructura del PPTX) -------------------------------

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
}

async function readPptx(blob: Blob) {
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(blob));
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort();
  const xml: Record<string, string> = {};
  for (const n of slideNames) xml[n] = await zip.files[n]!.async('string');
  return { slideNames, xml, allText: Object.values(xml).join('\n') };
}

describe('buildCampaignPpt — estructura del PPTX', () => {
  const screens = [
    screen({
      id: 'a',
      numero: '5',
      nombre: 'Polanco 03',
      calendarSupport: CRIUS,
    }),
    screen({
      id: 'b',
      numero: '6',
      nombre: 'Satélite 01',
      calendarSupport: 'PANTALLA',
    }),
  ];
  const withIssues = campaign({
    supports: [
      support({ support: CRIUS, stores: [{ numero: '5' }] }),
      support({ support: 'PANTALLA', stores: [{ numero: '6' }] }),
      support({ support: 'PANTALLA', stores: [{ numero: '999' }] }), // incidencia
    ],
  });

  it('20-22) genera un Blob con portada + 1 diapositiva por evidencia + incidencias', async () => {
    const plan = buildCampaignPptPlan(withIssues, screens);
    const blob = await buildCampaignPpt(plan);
    expect(blob.size).toBeGreaterThan(0);
    const { slideNames, allText } = await readPptx(blob);
    // 1 portada + 2 evidencias + 1 incidencias = 4.
    expect(slideNames).toHaveLength(1 + plan.slides.length + 1);
    expect(plan.slides).toHaveLength(2);
    expect(allText).toContain('LOREAL');
    expect(allText).toContain('COLOCAR EVIDENCIA');
    expect(allText).toContain('INCIDENCIAS DE COBERTURA');
  });

  it('23-24) sin incidencias no incluye la diapositiva de incidencias', async () => {
    const clean = campaign({
      supports: [support({ support: CRIUS, stores: [{ numero: '5' }] })],
    });
    const plan = buildCampaignPptPlan(clean, screens);
    expect(plan.issues).toHaveLength(0);
    const { slideNames, allText } = await readPptx(
      await buildCampaignPpt(plan),
    );
    // 1 portada + 1 evidencia, sin incidencias.
    expect(slideNames).toHaveLength(2);
    expect(allText).not.toContain('INCIDENCIAS DE COBERTURA');
  });
});
