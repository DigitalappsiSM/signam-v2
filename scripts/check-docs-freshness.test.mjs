import { describe, expect, it } from 'vitest';
import { evaluate } from './check-docs-freshness.mjs';

describe('guardia de deriva entre código y documentación', () => {
  it('protege la metodología del dashboard Odoo', () => {
    expect(
      evaluate(['functions/src/odoo/analysis.ts']).failures.length,
    ).toBeGreaterThan(0);
    expect(
      evaluate(['functions/src/odoo/analysis.ts', 'docs/ODOO_INCIDENTS.md'])
        .failures,
    ).toHaveLength(0);
  });
  it('bloquea un cambio de dominio sin documentación', () => {
    const { failures } = evaluate(['src/domain/csv.ts']);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.map((failure) => failure.rule.name)).toContain(
      'Serialización del CSV de Admira',
    );
  });

  it('acepta el cambio cuando se revisó el documento que le toca', () => {
    expect(evaluate(['src/domain/csv.ts', 'AGENTS.md']).failures).toHaveLength(
      0,
    );
  });

  it('exige documentación al tocar el cálculo del informe Quividi', () => {
    const { failures } = evaluate([
      'src/modules/exports/quividiBrandReport.ts',
    ]);
    expect(failures.map((failure) => failure.rule.name)).toContain(
      'Informe de audiencia Quividi',
    );
  });

  it('exige documentación al tocar el directorio de tiendas', () => {
    const { failures } = evaluate(['src/domain/stores/geography.ts']);
    expect(failures.map((failure) => failure.rule.name)).toContain(
      'Directorio de tiendas',
    );
    expect(
      evaluate(['src/domain/stores/geography.ts', 'AGENTS.md']).failures,
    ).toHaveLength(0);
  });

  it('exige documentación al tocar el rollup comercial de Inteligencia Comercial', () => {
    const { failures } = evaluate([
      'functions/src/quividi/commercial/commercialRollup.ts',
    ]);
    expect(failures.map((failure) => failure.rule.name)).toContain(
      'Inteligencia Comercial Quividi (Fase 3)',
    );
  });

  it('acepta el cambio comercial cuando se documentó en Fase 3', () => {
    expect(
      evaluate([
        'functions/src/quividi/commercial/commercialRollup.ts',
        'docs/QUIVIDI_PHASE_3.md',
      ]).failures,
    ).toHaveLength(0);
  });

  it('no molesta cuando sólo cambian pruebas', () => {
    expect(evaluate(['src/domain/csv.test.ts']).failures).toHaveLength(0);
  });

  it('no molesta con código fuera del alcance declarado', () => {
    expect(
      evaluate(['src/components/LoadingState.tsx', 'src/app/theme.ts'])
        .failures,
    ).toHaveLength(0);
  });

  it('un documento cualquiera no basta: tiene que ser el que corresponde', () => {
    const { failures } = evaluate(['src/domain/csv.ts', 'docs/SETUP.md']);
    expect(failures.length).toBeGreaterThan(0);
  });

  it('permite saltárselo de forma explícita y registrada', () => {
    const result = evaluate(['src/domain/csv.ts'], {
      skipMarker: 'Cambio de tipado interno [skip-docs]',
    });
    expect(result.skipped).toBe(true);
    expect(result.failures).toHaveLength(0);
  });
});

it('protege recuperación y ventanas de ingesta Quividi', () => {
  for (const file of ['history.ts', 'historyReadiness.ts', 'historyIngestion.ts', 'exportClient.ts', 'liveHistory.ts', 'measurement.ts']) {
    const path = `functions/src/quividi/${file}`;
    expect(evaluate([path]).failures.map((failure) => failure.rule.name))
      .toContain('Ingestión y consumo de Quividi');
    expect(evaluate([path, 'docs/QUIVIDI_INGESTION.md']).failures).toHaveLength(0);
  }
});
