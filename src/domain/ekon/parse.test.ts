import { describe, expect, it } from 'vitest';
import { parseEkonGrid } from './parse';
import { validateHeaders, EKON_HEADERS } from './headers';
import {
  excelSerialToCivil,
  toCivilDate,
  normalizeStoreNumber,
} from './normalization';
import {
  buildGrid,
  buildRow,
  headerRow,
  assignmentsFromSpecs,
} from './fixtures';

describe('encabezados y parser Ekon', () => {
  it('acepta los 30 encabezados reales', () => {
    const v = validateHeaders(headerRow().map(String));
    expect(v.ok).toBe(true);
    expect(v.missing).toHaveLength(0);
    expect(v.columnIndex.size).toBe(EKON_HEADERS.length);
  });

  it('reporta encabezados requeridos faltantes', () => {
    const header = headerRow()
      .map(String)
      .filter((h) => h !== 'Campaña' && h !== 'Determinante');
    const v = validateHeaders(header);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain('Campaña');
    expect(v.missing).toContain('Determinante');
  });

  it('detecta encabezados desconocidos sin romper', () => {
    const v = validateHeaders([...headerRow().map(String), 'COLUMNA EXTRA']);
    expect(v.unknown).toContain('COLUMNA EXTRA');
    expect(v.ok).toBe(true);
  });

  it('tolera acentos/mayúsculas/espacios en los encabezados', () => {
    const v = validateHeaders([
      '  ANO  ',
      'mes',
      'CADENA',
      'enseÑa',
      'articulo',
      'DETERMINANTE',
    ]);
    expect(v.columnIndex.get('Año')).toBe(0);
    expect(v.columnIndex.get('Artículo')).toBe(4);
  });
});

describe('conversión de fechas', () => {
  it('convierte seriales de Excel a fecha civil sin desfase', () => {
    expect(excelSerialToCivil(46231)).toBe('2026-07-28');
    expect(excelSerialToCivil(46237)).toBe('2026-08-03');
  });

  it('acepta seriales, texto ISO y Date', () => {
    expect(toCivilDate(46231)).toBe('2026-07-28');
    expect(toCivilDate('2026-08-03')).toBe('2026-08-03');
    expect(toCivilDate('46231')).toBe('2026-07-28');
    expect(toCivilDate('')).toBeNull();
    expect(toCivilDate('no-fecha')).toBeNull();
  });
});

describe('normalización de IDs', () => {
  it('normaliza número de tienda sin perder el original', () => {
    expect(normalizeStoreNumber('0078')).toBe('78');
    expect(normalizeStoreNumber(78)).toBe('78');
    expect(normalizeStoreNumber('ABC')).toBe('ABC');
  });
});

describe('parseEkonGrid', () => {
  it('parsea filas válidas y calcula totales', () => {
    const grid = buildGrid([{}, { Campaña: '30002', Determinante: '20' }]);
    const res = parseEkonGrid(grid);
    expect(res.validRows).toBe(2);
    expect(res.rejectedRows).toBe(0);
    expect(res.rows[0]!.inicioPeriodo).toBe('2026-07-28');
  });

  it('aísla filas sin campos mínimos con número de fila y motivo', () => {
    const grid = buildGrid([{ Campaña: '' }, {}]);
    const res = parseEkonGrid(grid);
    expect(res.validRows).toBe(1);
    expect(res.rejectedRows).toBe(1);
    expect(res.errors[0]!.sourceRow).toBe(2);
    expect(res.errors[0]!.reason).toMatch(/Campaña/);
  });

  it('devuelve cero filas cuando faltan encabezados requeridos', () => {
    const header = headerRow()
      .map(String)
      .filter((h) => h !== 'Campaña');
    const grid = [
      header,
      buildRow({}).filter((_, i) => EKON_HEADERS[i] !== 'Campaña'),
    ];
    const res = parseEkonGrid(grid);
    expect(res.validRows).toBe(0);
    expect(res.headerIssues.missing).toContain('Campaña');
  });

  it('conserva importes negativos y campos comerciales sin usarlos operativamente', () => {
    const [a] = assignmentsFromSpecs([{ 'Importe neto': -59994.8, Caras: 3 }]);
    expect(a!.commercial.importeNeto).toBeCloseTo(-59994.8);
    expect(a!.commercial.caras).toBe(3);
  });
});

describe('buildAssignments', () => {
  it('agrupa líneas comerciales de la misma identidad y NO multiplica pantallas por Caras', () => {
    // Dos filas con la misma identidad (misma campaña/línea/determinante/artículo)
    // que difieren solo en importe: una única asignación, caras sumadas.
    const assignments = assignmentsFromSpecs([
      { 'Importe neto': 4735, Caras: 1 },
      { 'Importe neto': 500, Caras: 1 },
    ]);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.sourceRows).toHaveLength(2);
    expect(assignments[0]!.commercial.caras).toBe(2);
    expect(assignments[0]!.commercial.importeNeto).toBeCloseTo(5235);
  });

  it('separa asignaciones con determinante distinto', () => {
    const assignments = assignmentsFromSpecs([
      { Determinante: '10' },
      { Determinante: '20' },
    ]);
    expect(assignments).toHaveLength(2);
  });

  it('marca conflicto cuando una identidad aparece en varios periodos en el mismo lote', () => {
    const assignments = assignmentsFromSpecs([
      { 'ID Periodo': '32', 'Inicio periodo': 46231, 'Fin periodo': 46237 },
      { 'ID Periodo': '33', 'Inicio periodo': 46238, 'Fin periodo': 46244 },
    ]);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.conflict).not.toBeNull();
  });
});
