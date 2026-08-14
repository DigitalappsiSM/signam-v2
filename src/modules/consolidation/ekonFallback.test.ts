import { describe, expect, it } from 'vitest';
import { applyCampaignFallback } from './ekonFallback';
import { consolidate } from './consolidate';
import { assignmentsFromSpecs } from '@/domain/ekon/fixtures';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import type { AdmiraScreen } from '@/domain';

const P32 = {
  'ID Periodo': '32',
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
};

function screen(
  over: Partial<AdmiraScreen['original']>,
  calendarSupport: string,
  store: string,
): AdmiraScreen {
  return {
    id: `s-${store}-${calendarSupport}`,
    original: {
      'TIPO DE pantallas': 'DIGITAL',
      CENTROS: `CENTRO ${store}`,
      CIRCUITO: 'CIRC',
      RESOLUCION: '1080x1920',
      FORMATO: 'F',
      'Nombre en plataforma': 'N',
      'TIPO DE PASES': 'PASES MEDIUM',
      'Numero de Tienda': store,
      'Nombre de tienda': `TIENDA ${store}`,
      Modelo: 'M',
      ARTICULOS: 'ART',
      BRANDS: 'B',
      ...over,
    },
    metadata: {
      active: true,
      createdAt: 0,
      updatedAt: 0,
      createdBy: 'x',
      updatedBy: 'x',
      source: 'test',
      sourceSheet: '',
      sourceRow: 0,
      deactivationReason: null,
      version: 1,
      calendarSupport,
    },
  };
}

const baseCampaign: ParsedCampaign = {
  row: 1,
  name: 'CAMPANA FALLBACK',
  tipo: 'Institucional',
  vendidoPor: '',
  fechaInicio: '2026-07-28',
  fechaFin: '2026-08-10',
  mes: 'Agosto',
  link: '',
  // Universo operativo: la campaña trae tiendas en OTRO soporte (p. ej. VIDEOWALL).
  supports: [
    {
      support: 'PANTALLAS CUADRADAS',
      owner: 'liverpool',
      stores: [{ numero: '10', nombre: 'T10' }],
    },
  ],
};

describe('fallback Ekon → consolidación', () => {
  it('sintetiza Mega Mupi Digital y genera CSV con el formato Admira normal', () => {
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'MEGA MUPI DIGITAL', Determinante: '10' },
    ]);
    const { campaign, added } = applyCampaignFallback(baseCampaign, {
      assignments,
      hasEkonLink: true,
      hasCompletedBatch: true,
    });
    expect(added.map((a) => a.support)).toEqual(['MEGA MUPI DIGITAL']);

    // El Master tiene una pantalla Mega Mupi Digital en la tienda 10.
    const screens = [
      screen({ RESOLUCION: '1080x1920' }, 'MEGA MUPI DIGITAL', '10'),
    ];
    const result = consolidate([campaign], screens);
    expect(result.consolidations).toHaveLength(1);
    const rows = result.consolidations[0]!.rows;
    expect(rows[0]!.RETAILERS).toBe('LIVERPOOL');
    expect(result.consolidations[0]!.resolution).toBe('1080x1920');
  });

  it('no sintetiza si Liverpool ya marca el soporte (sin duplicar)', () => {
    const campaignWithMarked: ParsedCampaign = {
      ...baseCampaign,
      supports: [
        ...baseCampaign.supports,
        {
          support: 'MEGA MUPI DIGITAL',
          owner: 'liverpool',
          stores: [{ numero: '10', nombre: 'T10' }],
        },
      ],
    };
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'MEGA MUPI DIGITAL', Determinante: '10' },
    ]);
    const { added } = applyCampaignFallback(campaignWithMarked, {
      assignments,
      hasEkonLink: true,
      hasCompletedBatch: true,
    });
    expect(added).toHaveLength(0);
  });

  it('determinante 0: no expande a todas las tiendas, conserva las operativas Liverpool', () => {
    // Ekon solo trae Centro Administrativo (0), pero la campaña conserva tienda 10.
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '0',
        'Tipo Campaña': 'Campaña Institucionales',
      },
    ]);
    const { campaign, added } = applyCampaignFallback(baseCampaign, {
      assignments,
      hasEkonLink: true,
      hasCompletedBatch: true,
    });
    expect(added).toHaveLength(1);
    const synthetic = campaign.supports.find(
      (s) => s.support === 'MEGA MUPI DIGITAL',
    )!;
    // Usa la tienda operativa Liverpool (10), nunca el determinante 0.
    expect(synthetic.stores.map((s) => s.numero)).toEqual(['10']);
  });
});
