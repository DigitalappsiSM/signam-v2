import { describe, expect, it } from 'vitest';
import type { AdmiraScreen } from '@/domain';
import { quividiPairsForCampaign, hasQuividiCoverage } from './quividiCoverage';

function screen(
  id: string,
  store: string,
  support: string,
  camera = '',
  camera2 = '',
): AdmiraScreen {
  return {
    id,
    original: {
      'TIPO DE pantallas': 'x',
      CENTROS: '',
      CIRCUITO: '',
      RESOLUCION: '',
      FORMATO: '',
      'Nombre en plataforma': id,
      'TIPO DE PASES': '',
      'Numero de Tienda': store,
      'Nombre de tienda': `Tienda ${store}`,
      Modelo: '',
      ARTICULOS: '',
      BRANDS: '',
    },
    metadata: {
      active: true,
      createdAt: 1,
      updatedAt: 1,
      createdBy: 'a',
      updatedBy: 'a',
      source: 'test',
      sourceSheet: '',
      sourceRow: 1,
      deactivationReason: null,
      version: 1,
      calendarSupport: support,
      quividiCameraName: camera,
      quividiCameraName2: camera2,
    },
  };
}

describe('quividiPairsForCampaign', () => {
  it('discrimina por tienda + soporte y conserva varias cámaras', () => {
    const screens = [
      screen('a', '4', 'MEGA MUPI DIGITAL', '4 - L SATELITE- DERECHO'),
      screen('b', '4', 'BANNER DIGITAL', '4 - L SATELITE- BANNER DIGITAL P2'),
      screen('c', '4', 'VIDEO WALL CRIUS'),
      screen('d', '7', 'MEGA MUPI DIGITAL', '7 - L SANTA FE- DERECHO'),
      screen('e', '7', 'MEGA MUPI DIGITAL', '7 - L SANTA FE- IZQUIERDO'),
    ];
    const campaign = {
      supports: [
        {
          support: 'MEGA MUPI DIGITAL',
          owner: 'liverpool' as const,
          scope: 'selected' as const,
          stores: [
            { numero: '4', nombre: 'Satélite' },
            { numero: '7', nombre: 'Santa Fe' },
          ],
        },
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool' as const,
          scope: 'selected' as const,
          stores: [{ numero: '4', nombre: 'Satélite' }],
        },
      ],
    };

    const pairs = quividiPairsForCampaign(campaign, screens);
    expect(pairs).toHaveLength(3);
    expect(
      pairs.find((pair) => pair.storeNumber === '7')?.cameraNames,
    ).toHaveLength(2);
    expect(
      pairs.find((pair) => pair.support === 'VIDEO WALL CRIUS')?.cameraNames,
    ).toHaveLength(0);
    expect(hasQuividiCoverage(campaign, screens)).toBe(true);
  });

  it('suma la segunda cámara de la misma pantalla (1 PC, 2 flujos de video)', () => {
    const screens = [
      screen('a', '78', 'VIDEO WALL CRIUS', 'TOREO-1', 'TOREO-2'),
    ];
    const campaign = {
      supports: [
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool' as const,
          scope: 'selected' as const,
          stores: [{ numero: '78', nombre: 'Toreo' }],
        },
      ],
    };

    const pairs = quividiPairsForCampaign(campaign, screens);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.cameraNames.sort()).toEqual(['TOREO-1', 'TOREO-2']);
  });

  it('resuelve scope all usando el inventario del soporte', () => {
    const screens = [
      screen('a', '4', 'BANNER DIGITAL', 'cam-a'),
      screen('b', '199', 'BANNER DIGITAL', 'cam-b'),
    ];
    const campaign = {
      supports: [
        {
          support: 'BANNER DIGITAL',
          owner: 'liverpool' as const,
          scope: 'all' as const,
          stores: [],
        },
      ],
    };
    expect(quividiPairsForCampaign(campaign, screens)).toHaveLength(2);
  });
});
