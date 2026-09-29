import { describe, it, expect } from 'vitest';
import {
  hasStoreDetail,
  isMupiPendonSupport,
  resolveCampaignsWithEkon,
  resolveNoDetailSupports,
  type EkonStoreContext,
} from './instoreEkon';
import type {
  CampaignSupport,
  ParsedCampaign,
} from '@/modules/liverpool-import/campaignParse';
import type { EkonAssignment } from '@/domain/ekon';

const noDetail = (support: string): CampaignSupport => ({
  support,
  owner: 'instore-media',
  stores: [],
  scope: 'all',
  scopeSource: 'no-comment',
});

function campaign(supports: CampaignSupport[]): ParsedCampaign {
  return {
    row: 1,
    name: 'TOKI',
    tipo: 'Sampling',
    vendidoPor: '',
    fechaInicio: '2026-09-29',
    fechaFin: '2026-10-05',
    mes: 'SEPTIEMBRE',
    link: '',
    supports,
  };
}

function assignment(over: Partial<EkonAssignment>): EkonAssignment {
  return {
    articulo: 'MEGA MUPI',
    circuito: 'MEGA MUPI',
    determinante: '12',
    determinanteKey: '12',
    tienda: 'Tienda 12',
    centroAdministrativo: false,
    conflict: null,
    inicioPeriodo: '2026-09-01',
    finPeriodo: '2026-10-31',
    ...over,
  } as EkonAssignment;
}

const ctx = (over: Partial<EkonStoreContext> = {}): EkonStoreContext => ({
  hasEkonLink: true,
  hasCompletedBatch: true,
  assignments: [assignment({})],
  ...over,
});

describe('detección', () => {
  it('reconoce los cuatro nombres de Mupi/Pendón', () => {
    for (const s of [
      "MUPPI'S",
      'muppis',
      'PENDON',
      'MEGA MUPI DIGITAL',
      'BANNER DIGITAL',
    ]) {
      expect(isMupiPendonSupport(s)).toBe(true);
    }
    expect(isMupiPendonSupport('VIDEO WALL CRIUS')).toBe(false);
  });

  it('«sin detalle» = sin tiendas y sin «todas» explícito', () => {
    expect(hasStoreDetail(noDetail("MUPPI'S"))).toBe(false);
    expect(
      hasStoreDetail({ ...noDetail("MUPPI'S"), scopeSource: undefined }),
    ).toBe(false);
    expect(
      hasStoreDetail({
        ...noDetail("MUPPI'S"),
        scopeSource: 'comment-explicit-all',
      }),
    ).toBe(true);
    expect(
      hasStoreDetail({
        ...noDetail("MUPPI'S"),
        stores: [{ numero: '1', nombre: '' }],
      }),
    ).toBe(true);
  });
});

describe('resolveNoDetailSupports', () => {
  it('toma las tiendas de la campaña Ekon vinculada', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail("MUPPI'S")]),
      ctx({
        assignments: [
          assignment({ determinanteKey: '12' }),
          assignment({ determinanteKey: '0034', tienda: 'T34' }),
          assignment({ determinanteKey: '12' }), // repetida
        ],
      }),
    );
    expect(r.issues).toEqual([]);
    const s = r.campaign.supports[0]!;
    expect(s.scope).toBe('selected');
    expect(s.stores.map((x) => x.numero)).toEqual(['12', '34']);
  });

  it('PENDON usa el circuito ESPECTACULAR IN STORE', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail('PENDON')]),
      ctx({
        assignments: [
          assignment({
            articulo: 'ESPECTACULAR IN STORE',
            circuito: 'ESPECTACULAR IN STORE',
            determinanteKey: '7',
          }),
          assignment({ determinanteKey: '99' }), // mupi: no aplica a pendón
        ],
      }),
    );
    expect(r.campaign.supports[0]!.stores.map((x) => x.numero)).toEqual(['7']);
  });

  it('ignora centro administrativo, conflictos y periodos ajenos', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail("MUPPI'S")]),
      ctx({
        assignments: [
          assignment({ determinanteKey: '1', centroAdministrativo: true }),
          assignment({ determinanteKey: '2', conflict: 'x' }),
          assignment({
            determinanteKey: '3',
            inicioPeriodo: '2025-01-01',
            finPeriodo: '2025-01-31',
          }),
        ],
      }),
    );
    expect(r.campaign.supports).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(['ekon-sin-tiendas']);
  });

  it('sin número Ekon bloquea y NO expande a todas las tiendas', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail("MUPPI'S")]),
      ctx({ hasEkonLink: false }),
    );
    expect(r.campaign.supports).toEqual([]);
    expect(r.issues.map((i) => i.code)).toEqual(['ekon-sin-vinculo']);
  });

  it('sin acceso a Ekon (rol comercial) retira el soporte sin incidencia', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail("MUPPI'S")]),
      ctx({ available: false }),
    );
    expect(r.campaign.supports).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('sin lote completado bloquea', () => {
    const r = resolveNoDetailSupports(
      campaign([noDetail("MUPPI'S")]),
      ctx({ hasCompletedBatch: false }),
    );
    expect(r.issues.map((i) => i.code)).toEqual(['ekon-sin-lote']);
  });

  it('un soporte con detalle o de otra familia no se toca', () => {
    const detailed: CampaignSupport = {
      ...noDetail("MUPPI'S"),
      stores: [{ numero: '5', nombre: '' }],
      scope: 'selected',
    };
    const other: CampaignSupport = {
      support: 'VIDEO WALL CRIUS',
      owner: 'liverpool',
      stores: [],
      scope: 'all',
      scopeSource: 'no-comment',
    };
    const c = campaign([detailed, other]);
    const r = resolveNoDetailSupports(c, ctx({ hasEkonLink: false }));
    expect(r.campaign).toBe(c);
    expect(r.issues).toEqual([]);
  });

  it('conserva el resto de la campaña al resolver un conjunto', () => {
    const c = { ...campaign([noDetail("MUPPI'S")]), id: 'abc' };
    const out = resolveCampaignsWithEkon([c], () => ctx());
    expect(out.campaigns[0]!.id).toBe('abc');
    expect(out.campaigns[0]!.supports[0]!.stores).toHaveLength(1);
  });
});
