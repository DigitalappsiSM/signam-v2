import { describe, expect, it } from 'vitest';
import { evaluate } from './check-docs-freshness.mjs';

describe('guardia de deriva entre código y documentación', () => {
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

  it('no molesta cuando sólo cambian pruebas', () => {
    expect(
      evaluate(['src/domain/csv.test.ts']).failures,
    ).toHaveLength(0);
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
