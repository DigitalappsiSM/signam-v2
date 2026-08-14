import { describe, expect, it } from 'vitest';
import { diffAssignments } from './diff';
import { assignmentsFromSpecs, storedFrom } from './fixtures';
import type { EkonRowSpec } from './fixtures';
import type { StoredEkonAssignment } from './models';

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

function prevFrom(
  specs: readonly EkonRowSpec[],
  overrides: Partial<StoredEkonAssignment> = {},
): StoredEkonAssignment[] {
  return assignmentsFromSpecs(specs).map((a) => storedFrom(a, overrides));
}

describe('diff de asignaciones Ekon', () => {
  it('primera importación: todo Nueva', () => {
    const incoming = assignmentsFromSpecs([
      { ...P32 },
      { ...P32, Determinante: '20' },
    ]);
    const res = diffAssignments(
      {
        previous: [],
        incoming,
        confirmedPeriods: new Set(['32']),
        batchId: 'b1',
      },
      1000,
    );
    expect(res.counts.nueva).toBe(2);
    // La creación se registra en la asignación (firstBatchId); no se emiten
    // revisiones "created" en la primera importación (evita miles de docs).
    expect(res.revisions).toHaveLength(0);
    expect(res.nextAssignments.every((a) => a.active)).toBe(true);
    expect(res.nextAssignments.every((a) => a.firstBatchId === 'b1')).toBe(
      true,
    );
  });

  it('reimportación idéntica: Sin cambios y sin nuevas revisiones', () => {
    const specs = [{ ...P32 }];
    const previous = prevFrom(specs);
    const incoming = assignmentsFromSpecs(specs);
    const res = diffAssignments(
      { previous, incoming, confirmedPeriods: new Set(['32']), batchId: 'b2' },
      1000,
    );
    expect(res.counts['sin-cambios']).toBe(1);
    expect(res.revisions).toHaveLength(0);
  });

  it('cambio de producto/circuito/tipo: Modificada con before/after', () => {
    const previous = prevFrom([{ ...P32, Producto: 'ANTES' }]);
    const incoming = assignmentsFromSpecs([{ ...P32, Producto: 'DESPUES' }]);
    const res = diffAssignments(
      { previous, incoming, confirmedPeriods: new Set(['32']), batchId: 'b3' },
      1000,
    );
    expect(res.counts.modificada).toBe(1);
    const entry = res.entries.find((e) => e.state === 'modificada')!;
    expect(entry.before!.producto).toBe('ANTES');
    expect(entry.after.producto).toBe('DESPUES');
    expect(entry.changedFields).toContain('producto');
  });

  it('cambio de periodo: nueva versión vigente, evento period-change', () => {
    const previous = prevFrom([{ ...P32 }]);
    const incoming = assignmentsFromSpecs([{ ...P33 }]);
    const res = diffAssignments(
      {
        previous,
        incoming,
        confirmedPeriods: new Set(['32', '33']),
        batchId: 'b4',
      },
      1000,
    );
    const entry = res.entries.find((e) => e.state === 'modificada')!;
    expect(entry.event).toBe('period-change');
    expect(entry.periodChange).toEqual({ from: '32', to: '33' });
    expect(entry.after.idPeriodo).toBe('33');
    expect(entry.after.active).toBe(true);
  });

  it('línea ausente dentro del alcance: No incluida, sin borrado', () => {
    const previous = prevFrom([{ ...P32 }]);
    const res = diffAssignments(
      {
        previous,
        incoming: [],
        confirmedPeriods: new Set(['32']),
        batchId: 'b5',
      },
      1000,
    );
    expect(res.counts['no-incluida']).toBe(1);
    const stored = res.nextAssignments[0]!;
    expect(stored.active).toBe(false);
    expect(stored.missingSinceBatchId).toBe('b5');
  });

  it('línea ausente FUERA del alcance: intacta', () => {
    const previous = prevFrom([{ ...P33 }]);
    const res = diffAssignments(
      {
        previous,
        incoming: [],
        confirmedPeriods: new Set(['32']),
        batchId: 'b6',
      },
      1000,
    );
    expect(res.counts['no-incluida']).toBe(0);
    expect(res.nextAssignments[0]!.active).toBe(true);
  });

  it('reaparición: Restaurada', () => {
    const previous = prevFrom([{ ...P32 }], {
      active: false,
      missingSinceBatchId: 'b5',
    });
    const incoming = assignmentsFromSpecs([{ ...P32 }]);
    const res = diffAssignments(
      { previous, incoming, confirmedPeriods: new Set(['32']), batchId: 'b7' },
      1000,
    );
    expect(res.counts.restaurada).toBe(1);
    const stored = res.nextAssignments[0]!;
    expect(stored.active).toBe(true);
    expect(stored.missingSinceBatchId).toBeNull();
  });

  it('cambio de número de línea: vieja No incluida + nueva Nueva + highlight', () => {
    const previous = prevFrom([{ ...P32, 'Línea campaña': '10' }]);
    const incoming = assignmentsFromSpecs([{ ...P32, 'Línea campaña': '11' }]);
    const res = diffAssignments(
      { previous, incoming, confirmedPeriods: new Set(['32']), batchId: 'b8' },
      1000,
    );
    expect(res.counts['no-incluida']).toBe(1);
    expect(res.counts.nueva).toBe(1);
    expect(res.highlights.some((h) => h.reason === 'line-change')).toBe(true);
  });

  it('cambio 0 ↔ físico: highlight de Centro Administrativo', () => {
    const previous = prevFrom([{ ...P32, Determinante: '0' }]);
    const incoming = assignmentsFromSpecs([{ ...P32, Determinante: '10' }]);
    const res = diffAssignments(
      { previous, incoming, confirmedPeriods: new Set(['32']), batchId: 'b9' },
      1000,
    );
    expect(
      res.highlights.some((h) => h.reason === 'centro-administrativo-change'),
    ).toBe(true);
  });

  it('importación con conflicto no reemplaza el vigente: se marca conflicto inactivo', () => {
    const incoming = assignmentsFromSpecs([
      { ...P32 },
      { ...P33 }, // misma identidad, distinto periodo → conflicto
    ]);
    expect(incoming[0]!.conflict).not.toBeNull();
    const res = diffAssignments(
      {
        previous: [],
        incoming,
        confirmedPeriods: new Set(['32', '33']),
        batchId: 'b10',
      },
      1000,
    );
    expect(res.counts.conflicto).toBe(1);
    expect(res.nextAssignments[0]!.active).toBe(false);
  });
});
