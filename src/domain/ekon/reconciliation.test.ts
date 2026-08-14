import { describe, expect, it } from 'vitest';
import { reconcileCampaign, type ReconCampaignInput } from './reconciliation';
import { assignmentsFromSpecs } from './fixtures';

const P32 = {
  'ID Periodo': '32',
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
};
const P33 = {
  'ID Periodo': '33',
  'Inicio periodo': 46238,
  'Fin periodo': 46244,
};

const campaign = (
  over: Partial<ReconCampaignInput> = {},
): ReconCampaignInput => ({
  name: 'Campaña Demo',
  fechaInicio: '2026-07-28',
  fechaFin: '2026-08-10',
  supports: [{ support: 'MEGA MUPI DIGITAL', stores: [{ numero: '10' }] }],
  ...over,
});

describe('conciliación Ekon ↔ Liverpool', () => {
  it('sin campaña Ekon vigente → estado sin-campana-ekon', () => {
    const res = reconcileCampaign(campaign(), '30001', []);
    expect(res.status).toBe('sin-campana-ekon');
    expect(res.ekonExists).toBe(false);
  });

  it('periodos Ekon cubren fechas Liverpool sin exigir igualdad exacta', () => {
    // Dos asignaciones (líneas distintas) cubriendo periodos 32 y 33.
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'MEGA MUPI DIGITAL', 'Línea campaña': '10' },
      { ...P33, Artículo: 'MEGA MUPI DIGITAL', 'Línea campaña': '11' },
    ]);
    const res = reconcileCampaign(campaign(), '30001', assignments);
    expect(res.coverage).toBe('covered');
    expect(res.pendingConflicts).toBe(0);
  });

  it('periodo no cubierto → estado periodo-no-cubierto', () => {
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'MEGA MUPI DIGITAL' },
    ]);
    const res = reconcileCampaign(
      campaign({ fechaInicio: '2026-09-01', fechaFin: '2026-09-07' }),
      '30001',
      assignments,
    );
    expect(res.coverage).toBe('uncovered');
    expect(res.status).toBe('periodo-no-cubierto');
  });

  it('circuito Ekon compatible con soporte Liverpool vía mapeo', () => {
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'ESPECTACULAR IN STORE', Determinante: '10' },
    ]);
    const res = reconcileCampaign(
      campaign({
        supports: [{ support: 'BANNER DIGITAL', stores: [{ numero: '10' }] }],
      }),
      '30001',
      assignments,
    );
    expect(res.circuitMatches[0]!.compatible).toBe(true);
  });

  it('tiendas se cruzan por número, no por nombre', () => {
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '0078',
        Tienda: 'NOMBRE A',
      },
    ]);
    const res = reconcileCampaign(
      campaign({
        supports: [
          { support: 'MEGA MUPI DIGITAL', stores: [{ numero: '78' }] },
        ],
      }),
      '30001',
      assignments,
    );
    expect(res.stores.common).toContain('78');
    expect(res.stores.ekonOnly).toHaveLength(0);
    expect(res.stores.liverpoolOnly).toHaveLength(0);
  });

  it('determinante 0 → alcance administrativo, tiendas no aplican', () => {
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '0',
        'Tipo Campaña': 'Campaña Institucionales',
      },
    ]);
    const res = reconcileCampaign(campaign(), '30001', assignments);
    expect(res.administrativeScope).toBe(true);
    expect(res.stores.applies).toBe(false);
    expect(res.ratio).toBe('ratio3');
  });

  it('institucional histórica con determinantes físicos SÍ concilia tiendas', () => {
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '10',
        'Tipo Campaña': 'Campaña Institucionales',
      },
    ]);
    const res = reconcileCampaign(campaign(), '30001', assignments);
    expect(res.administrativeScope).toBe(false);
    expect(res.stores.applies).toBe(true);
    expect(res.stores.common).toContain('10');
  });
});
