import { describe, it, expect } from 'vitest';
import type { AdmiraScreen } from '@/domain';
import type { EkonAssignment } from '@/domain/ekon';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import {
  applySupportOverrides,
  buildEkonSupports,
  calendarFingerprint,
  detectSupportDiscrepancies,
  ekonFingerprint,
  supportChoiceKey,
  supportReviewState,
  type CampaignSupportOverride,
} from './supportOverride';

const STORES = [
  ['4', 'SATELITE'],
  ['81', 'PARQUE DELTA'],
  ['176', 'MITIKAH'],
  ['199', 'TOREO'],
] as const;

function assignment(over: Partial<EkonAssignment>): EkonAssignment {
  return {
    articulo: 'ESPECTACULAR IN STORE',
    circuito: 'ESPECTACULAR IN STORE',
    determinante: '4',
    determinanteKey: '4',
    tienda: 'SATELITE',
    centroAdministrativo: false,
    conflict: null,
    inicioPeriodo: '2026-10-05',
    finPeriodo: '2026-10-11',
    ...over,
  } as EkonAssignment;
}

const ekonBanner = STORES.map(([n, name]) =>
  assignment({ determinante: n, determinanteKey: n, tienda: name }),
);

function screen(numero: string, calendarSupport: string, active = true) {
  return {
    original: { 'Numero de Tienda': numero },
    metadata: { calendarSupport, active },
  } as unknown as Pick<AdmiraScreen, 'original' | 'metadata'>;
}

const catalog = STORES.flatMap(([n]) => [
  screen(n, 'BANNER DIGITAL'),
  screen(n, 'MEGA MUPI DIGITAL'),
]);

const mupis: CampaignSupport = {
  support: "MUPPI'S",
  owner: 'instore-media',
  stores: STORES.map(([numero, nombre]) => ({ numero, nombre })),
  scope: 'selected',
  scopeSource: 'comment-selected',
};

const apple = {
  id: 'apple',
  name: 'APPLE',
  fechaInicio: '2026-10-05',
  fechaFin: '2026-10-10',
  supports: [mupis],
};

function override(
  over: Partial<CampaignSupportOverride> = {},
): CampaignSupportOverride {
  return {
    id: 'apple',
    campaignId: 'apple',
    campaignName: 'APPLE',
    decision: 'ekon',
    supports: [],
    reason: 'Calendario con soporte equivocado',
    ekonNumber: 26658,
    calendarFingerprint: calendarFingerprint(apple),
    ekonFingerprint: ekonFingerprint(apple, ekonBanner),
    createdAt: 1,
    createdBy: 'a',
    updatedAt: 1,
    updatedBy: 'a',
    history: [],
    ...over,
  };
}

describe('detectSupportDiscrepancies', () => {
  it('APPLE: calendario Mupi vs Ekon Banner difiere en las 4 tiendas', () => {
    const diffs = detectSupportDiscrepancies(apple, ekonBanner);
    expect(diffs.map((d) => d.storeNumber)).toEqual(['4', '81', '176', '199']);
    expect(diffs.every((d) => d.status === 'support-mismatch')).toBe(true);
  });

  it('calendario y Ekon iguales: sin diferencias', () => {
    const ekonMupi = ekonBanner.map((a) => ({
      ...a,
      circuito: 'MEGA MUPI',
      articulo: 'MEGA MUPI',
    }));
    expect(detectSupportDiscrepancies(apple, ekonMupi)).toEqual([]);
  });

  it('detecta una tienda que solo está en Ekon', () => {
    const extra = assignment({
      determinante: '50',
      determinanteKey: '50',
      tienda: 'OTRA',
      circuito: 'MEGA MUPI',
      articulo: 'MEGA MUPI',
    });
    const ekonMupi = [
      ...ekonBanner.map((a) => ({ ...a, circuito: 'MEGA MUPI' })),
      extra,
    ];
    const diffs = detectSupportDiscrepancies(apple, ekonMupi);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ storeNumber: '50', status: 'ekon-only' });
  });

  it('ignora asignaciones de otros periodos (no compara fechas)', () => {
    const otherFlight = ekonBanner.map((a) => ({
      ...a,
      inicioPeriodo: '2026-11-01',
      finPeriodo: '2026-11-15',
    }));
    expect(detectSupportDiscrepancies(apple, otherFlight)).toEqual([]);
  });

  it('Mupi sin detalle se resuelve con Ekon: no es diferencia', () => {
    const noDetail = {
      ...apple,
      supports: [
        {
          ...mupis,
          stores: [],
          scope: 'all' as const,
          scopeSource: 'no-comment' as const,
        },
      ],
    };
    const ekonMupi = ekonBanner.map((a) => ({ ...a, circuito: 'MEGA MUPI' }));
    expect(detectSupportDiscrepancies(noDetail, ekonMupi)).toEqual([]);
  });

  it('un soporte sin lista de tiendas no se compara tienda por tienda', () => {
    const fullCircuit = {
      ...apple,
      supports: [
        {
          support: 'BANNER DIGITAL',
          owner: 'liverpool' as const,
          stores: [],
          scope: 'all' as const,
          scopeSource: 'comment-explicit-all' as const,
        },
      ],
    };
    expect(detectSupportDiscrepancies(fullCircuit, ekonBanner)).toEqual([]);
  });
});

describe('buildEkonSupports', () => {
  it('APPLE: ESPECTACULAR IN STORE se traduce a BANNER DIGITAL por catálogo', () => {
    const result = buildEkonSupports(apple, ekonBanner, catalog);
    expect(result.pending).toEqual([]);
    expect(result.supports).toHaveLength(1);
    expect(result.supports[0]).toMatchObject({
      support: 'BANNER DIGITAL',
      scope: 'selected',
    });
    expect(result.supports[0]!.stores.map((s) => s.numero)).toEqual([
      '4',
      '81',
      '176',
      '199',
    ]);
  });

  it('con varios candidatos en catálogo pide elegir y respeta la elección', () => {
    const many = [...catalog, screen('4', 'COLUMNA DIGITAL')];
    const first = buildEkonSupports(apple, ekonBanner, many);
    expect(first.pending).toHaveLength(1);
    expect(first.pending[0]).toMatchObject({
      storeNumber: '4',
      candidates: ['COLUMNA DIGITAL', 'BANNER DIGITAL'],
    });
    const chosen = buildEkonSupports(apple, ekonBanner, many, {
      [supportChoiceKey('4', 'ESPECTACULAR IN STORE')]: 'BANNER DIGITAL',
    });
    expect(chosen.pending).toEqual([]);
    expect(chosen.supports[0]!.stores).toHaveLength(4);
  });

  it('pantallas inactivas no cuentan como candidato', () => {
    const inactive = [...catalog, screen('4', 'COLUMNA DIGITAL', false)];
    expect(buildEkonSupports(apple, ekonBanner, inactive).pending).toEqual([]);
  });

  it('conserva soportes sin tiendas que Ekon no cubre', () => {
    const crius: CampaignSupport = {
      support: 'VIDEO WALL CRIUS',
      owner: 'liverpool',
      stores: [],
      scope: 'all',
      scopeSource: 'comment-explicit-all',
    };
    const result = buildEkonSupports(
      { ...apple, supports: [mupis, crius] },
      ekonBanner,
      catalog,
    );
    expect(result.supports.map((s) => s.support)).toEqual([
      'BANNER DIGITAL',
      'VIDEO WALL CRIUS',
    ]);
  });
});

describe('supportReviewState', () => {
  it('pendiente cuando difieren y no hay confirmación', () => {
    expect(supportReviewState(apple, ekonBanner, undefined)).toBe('pending');
  });

  it('confirmado mientras nada cambie', () => {
    expect(supportReviewState(apple, ekonBanner, override())).toBe('confirmed');
  });

  it('vuelve a revisión si el calendario cambia tras confirmar', () => {
    const changed = {
      ...apple,
      supports: [{ ...mupis, stores: mupis.stores.slice(0, 3) }],
    };
    expect(supportReviewState(changed, ekonBanner, override())).toBe('stale');
  });

  it('vuelve a revisión si Ekon cambia tras confirmar', () => {
    expect(supportReviewState(apple, ekonBanner.slice(0, 3), override())).toBe(
      'stale',
    );
  });

  it('vuelve a revisión si se desvincula o cambia el número Ekon', () => {
    expect(supportReviewState(apple, undefined, override(), null)).toBe(
      'stale',
    );
    expect(supportReviewState(apple, ekonBanner, override(), 99999)).toBe(
      'stale',
    );
    expect(supportReviewState(apple, ekonBanner, override(), 26658)).toBe(
      'confirmed',
    );
  });

  it('sin vínculos cargados no marca revisión por el número', () => {
    expect(supportReviewState(apple, undefined, override(), undefined)).toBe(
      'confirmed',
    );
  });

  it('sin Ekon cargado no inventa avisos', () => {
    expect(supportReviewState(apple, undefined, undefined)).toBe('none');
  });
});

describe('applySupportOverrides', () => {
  it('reemplaza soportes solo con decisión ekon', () => {
    const banner = buildEkonSupports(apple, ekonBanner, catalog).supports;
    const map = new Map([['apple', override({ supports: banner })]]);
    const [out] = applySupportOverrides([apple], map);
    expect(out!.supports).toBe(banner);
    const keep = new Map([['apple', override({ decision: 'calendar' })]]);
    expect(applySupportOverrides([apple], keep)[0]).toBe(apple);
  });
});
