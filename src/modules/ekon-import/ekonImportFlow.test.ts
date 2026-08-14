import { describe, expect, it } from 'vitest';
import { analyzeEkonGrid, previewDiff } from './ekonImportFlow';
import {
  buildGrid,
  storedFrom,
  assignmentsFromSpecs,
} from '@/domain/ekon/fixtures';

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

describe('flujo de importación Ekon', () => {
  it('analiza la matriz: métricas, periodos y hash estable', () => {
    const grid = buildGrid([{ ...P32 }, { ...P32, Determinante: '20' }]);
    const a = analyzeEkonGrid(grid);
    expect(a.metrics.validRows).toBe(2);
    expect(a.metrics.distinctDeterminantes).toBe(2);
    expect(a.metrics.periods).toBe(1);
    // Reanalizar la misma matriz da el mismo hash (idempotencia de reimportación).
    expect(analyzeEkonGrid(grid).contentHash).toBe(a.contentHash);
  });

  it('el orden de filas no cambia el hash de contenido', () => {
    const g1 = buildGrid([
      { ...P32, Determinante: '10' },
      { ...P32, Determinante: '20' },
    ]);
    const g2 = buildGrid([
      { ...P32, Determinante: '20' },
      { ...P32, Determinante: '10' },
    ]);
    expect(analyzeEkonGrid(g1).contentHash).toBe(
      analyzeEkonGrid(g2).contentHash,
    );
  });

  it('previewDiff no escribe y solo cuenta ausencias dentro del alcance confirmado', () => {
    const previous = assignmentsFromSpecs([{ ...P33, Determinante: '30' }]).map(
      (x) => storedFrom(x),
    );
    const incoming = assignmentsFromSpecs([{ ...P32, Determinante: '10' }]);
    const periods = analyzeEkonGrid(
      buildGrid([{ ...P32, Determinante: '10' }]),
    ).periods;
    // Alcance = solo periodo 32: la asignación previa del periodo 33 queda intacta.
    const preview = previewDiff(incoming, previous, ['32'], periods);
    expect(preview.counts.nueva).toBe(1);
    expect(preview.counts['no-incluida']).toBe(0);
  });
});
