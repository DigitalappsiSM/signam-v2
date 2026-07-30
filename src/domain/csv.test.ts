import { describe, it, expect } from 'vitest';
import { escapeCsvField, serializeAdmiraCsv, serializeCsvLine } from './csv';
import { ADMIRA_CSV_HEADER_LABELS } from './constants';
import type { AdmiraCsvRow } from './models';

// Fila 1 completa: columna A = "LIVERPOOL", columnas B–H = encabezado real.
const EXACT_HEADER =
  'LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases';

describe('escapeCsvField', () => {
  it('deja intactos los valores simples', () => {
    expect(escapeCsvField('VW 914x908')).toBe('VW 914x908');
  });

  it('entrecomilla valores con coma', () => {
    expect(escapeCsvField('Nike, Verano')).toBe('"Nike, Verano"');
  });

  it('duplica comillas internas', () => {
    expect(escapeCsvField('pantalla "grande"')).toBe('"pantalla ""grande"""');
  });

  it('entrecomilla valores con salto de línea', () => {
    expect(escapeCsvField('linea1\nlinea2')).toBe('"linea1\nlinea2"');
  });
});

describe('serializeCsvLine', () => {
  it('une valores con coma', () => {
    expect(serializeCsvLine(['a', 'b', 'c'])).toBe('a,b,c');
  });
});

function makeRow(overrides: Partial<AdmiraCsvRow> = {}): AdmiraCsvRow {
  return {
    ARTICULOS: 'VW 914x908',
    BRANDS: 'Nike',
    CENTROS: 'GDL',
    CIRCUITO: 'VIDEOWALL',
    RESOLUCION: '914 x 908',
    RETAILERS: '',
    'TIPO DE PASES': 'PASES FULL',
    ...overrides,
  };
}

describe('serializeAdmiraCsv', () => {
  it('pone LIVERPOOL en A1 y el encabezado real desde la columna B', () => {
    const csv = serializeAdmiraCsv([], { withBom: false });
    const [header] = csv.split('\r\n');
    expect(header).toBe(EXACT_HEADER);
    expect(header).toBe('LIVERPOOL,' + ADMIRA_CSV_HEADER_LABELS.join(','));
    // El encabezado escrito rotula la última columna como "Tipo de Pases",
    // no en mayúsculas.
    expect(csv.endsWith('Tipo de Pases')).toBe(true);
    expect(csv).not.toContain('TIPO DE PASES');
  });

  it('deja la columna A vacía en las filas de datos (empieza en B)', () => {
    // La fila se indexa por la llave interna en mayúsculas; el valor aparece
    // en la columna B en adelante, tras la celda vacía de la columna A.
    const csv = serializeAdmiraCsv(
      [makeRow({ 'TIPO DE PASES': 'PASES FULL' })],
      {
        withBom: false,
      },
    );
    const [, row] = csv.split('\r\n');
    // La columna A va vacía: la fila empieza con una coma.
    expect(row).toBe(',VW 914x908,Nike,GDL,VIDEOWALL,914 x 908,,PASES FULL');
  });

  it('antepone el BOM UTF-8 por defecto, seguido de LIVERPOOL en A1', () => {
    const csv = serializeAdmiraCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith('LIVERPOOL,ARTICULOS')).toBe(true);
  });

  it('serializa encabezado y filas con CRLF en orden', () => {
    const csv = serializeAdmiraCsv([makeRow()], { withBom: false });
    const [header, row] = csv.split('\r\n');
    expect(header).toBe(EXACT_HEADER);
    expect(row).toBe(',VW 914x908,Nike,GDL,VIDEOWALL,914 x 908,,PASES FULL');
  });

  it('escapa valores conflictivos en las filas', () => {
    const csv = serializeAdmiraCsv([makeRow({ ARTICULOS: 'A, B' })], {
      withBom: false,
    });
    expect(csv).toContain('"A, B"');
  });
});
