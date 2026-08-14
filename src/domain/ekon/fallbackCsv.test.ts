import { describe, expect, it } from 'vitest';
import {
  collectOperativeStores,
  fallbackSupportForCircuit,
  planFallbackSupports,
} from './fallbackCsv';
import { assignmentsFromSpecs } from './fixtures';

const P32 = {
  'ID Periodo': '32',
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
};

const base = {
  hasCompletedBatch: true,
  hasEkonLink: true,
  operativeStores: ['10', '20'],
};

describe('fallback Ekon para CSV', () => {
  it('mapea circuitos solo a los dos soportes autorizados', () => {
    expect(fallbackSupportForCircuit('MEGA MUPI DIGITAL')).toBe(
      'MEGA MUPI DIGITAL',
    );
    expect(fallbackSupportForCircuit('MEGA MUPI')).toBe('MEGA MUPI DIGITAL');
    expect(fallbackSupportForCircuit('ESPECTACULAR IN STORE')).toBe(
      'BANNER DIGITAL',
    );
    expect(fallbackSupportForCircuit('VIDEOWALL')).toBeNull();
    expect(fallbackSupportForCircuit('ESPECTACULAR OUT LIV')).toBeNull();
  });

  it('si Liverpool marca el soporte, NO usa fallback (sin duplicar)', () => {
    const plan = planFallbackSupports({
      ...base,
      markedSupports: ['MEGA MUPI DIGITAL'],
      assignments: assignmentsFromSpecs([
        { ...P32, Artículo: 'MEGA MUPI DIGITAL' },
      ]),
    });
    expect(plan.syntheticSupports).toHaveLength(0);
  });

  it('si Liverpool NO marca Banner y Ekon tiene ESPECTACULAR IN STORE → genera solo Banner Digital', () => {
    const plan = planFallbackSupports({
      ...base,
      markedSupports: [],
      assignments: assignmentsFromSpecs([
        { ...P32, Artículo: 'ESPECTACULAR IN STORE' },
      ]),
    });
    expect(plan.syntheticSupports).toHaveLength(1);
    expect(plan.syntheticSupports[0]!.support).toBe('BANNER DIGITAL');
  });

  it('no genera LED Altabrisa/Vallarta ni Columna Digital desde el fallback Banner', () => {
    const plan = planFallbackSupports({
      ...base,
      markedSupports: [],
      assignments: assignmentsFromSpecs([
        { ...P32, Artículo: 'ESPECTACULAR IN STORE' },
      ]),
    });
    const supports = plan.syntheticSupports.map((s) => s.support);
    expect(supports).not.toContain('LED ALTABRISA');
    expect(supports).not.toContain('LED VALLARTA');
    expect(supports).not.toContain('COLUMNA DIGITAL');
  });

  it('MEGA MUPI DIGITAL Ekon se normaliza y resuelve solo Mega Mupi Digital', () => {
    const plan = planFallbackSupports({
      ...base,
      markedSupports: [],
      assignments: assignmentsFromSpecs([
        { ...P32, Artículo: 'MEGA MUPI DIGITAL' },
      ]),
    });
    expect(plan.syntheticSupports.map((s) => s.support)).toEqual([
      'MEGA MUPI DIGITAL',
    ]);
  });

  it('no habilita otros soportes InStore Media', () => {
    const plan = planFallbackSupports({
      ...base,
      markedSupports: [],
      assignments: assignmentsFromSpecs([{ ...P32, Artículo: 'VIDEOWALL' }]),
    });
    expect(plan.syntheticSupports).toHaveLength(0);
  });

  it('sin vínculo Ekon o sin lote completado: no sintetiza', () => {
    const assignments = assignmentsFromSpecs([
      { ...P32, Artículo: 'MEGA MUPI DIGITAL' },
    ]);
    expect(
      planFallbackSupports({
        ...base,
        hasEkonLink: false,
        markedSupports: [],
        assignments,
      }).syntheticSupports,
    ).toHaveLength(0);
    expect(
      planFallbackSupports({
        ...base,
        hasCompletedBatch: false,
        markedSupports: [],
        assignments,
      }).syntheticSupports,
    ).toHaveLength(0);
  });

  it('sin tiendas operativas utilizables: bloquea y no expande cobertura', () => {
    const plan = planFallbackSupports({
      ...base,
      operativeStores: [],
      markedSupports: [],
      assignments: assignmentsFromSpecs([
        { ...P32, Artículo: 'MEGA MUPI DIGITAL' },
      ]),
    });
    expect(plan.syntheticSupports).toHaveLength(0);
    expect(plan.issues[0]!.code).toBe('sin-tiendas-operativas');
  });

  it('collectOperativeStores reúne tiendas sin expandir a todas', () => {
    const stores = collectOperativeStores([
      { stores: [{ numero: '0010' }, { numero: '20' }] },
      { stores: [{ numero: '20' }] },
    ]);
    expect(stores).toEqual(['10', '20']);
  });
});
