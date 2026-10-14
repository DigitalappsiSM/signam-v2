import { describe, it, expect } from 'vitest';
import { supportStoreSource } from './supportStores';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import type { ConsolidationIssue } from '@/modules/consolidation/consolidate';

const noDetail = (support: string): CampaignSupport => ({
  support,
  owner: 'instore-media',
  stores: [],
  scope: 'all',
  scopeSource: 'no-comment',
});

const fromEkon = (support: string): CampaignSupport => ({
  support,
  owner: 'instore-media',
  stores: [
    { numero: '4', nombre: 'L SATELITE' },
    { numero: '81', nombre: 'L PARQUE DELTA' },
  ],
  scope: 'selected',
  scopeSource: 'resolution-selected',
});

describe('supportStoreSource', () => {
  it('un soporte con detalle de calendario se muestra tal cual', () => {
    const support: CampaignSupport = {
      support: "MUPPI'S",
      owner: 'instore-media',
      stores: [{ numero: '4', nombre: 'L SATELITE' }],
      scope: 'selected',
      scopeSource: 'comment-selected',
    };
    expect(supportStoreSource(support, undefined, [])).toEqual({
      kind: 'calendar',
    });
  });

  it('un soporte Liverpool nunca depende de Ekon', () => {
    const support = { ...noDetail('VIDEO WALL CRIUS'), owner: 'liverpool' };
    expect(
      supportStoreSource(support as CampaignSupport, undefined, []),
    ).toEqual({ kind: 'calendar' });
  });

  it('Mupi sin detalle muestra las tiendas resueltas desde Ekon', () => {
    const result = supportStoreSource(
      noDetail("MUPPI'S"),
      { supports: [fromEkon("MUPPI'S")] },
      [],
    );
    expect(result).toEqual({
      kind: 'ekon',
      stores: fromEkon("MUPPI'S").stores,
    });
  });

  it('Pendón sin detalle bloqueado muestra su incidencia', () => {
    const issue: ConsolidationIssue = {
      code: 'ekon-sin-vinculo',
      campaign: 'APPLE',
      support: 'PENDON',
      message: 'sin vínculo',
    };
    expect(
      supportStoreSource(noDetail('PENDON'), { supports: [] }, [issue]),
    ).toEqual({ kind: 'blocked', issue });
  });

  it('sin resolución ni incidencia queda pendiente', () => {
    expect(supportStoreSource(noDetail("MUPPI'S"), undefined, [])).toEqual({
      kind: 'pending',
    });
  });

  it('no confunde Mupi con Pendón al buscar la resolución', () => {
    expect(
      supportStoreSource(
        noDetail('PENDON'),
        { supports: [fromEkon("MUPPI'S")] },
        [],
      ),
    ).toEqual({ kind: 'pending' });
  });
});
