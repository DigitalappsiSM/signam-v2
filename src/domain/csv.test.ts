import { describe, it, expect } from 'vitest';
import { escapeCsvField, serializeAdmiraCsv, serializeCsvLine } from './csv';
import { ADMIRA_CSV_HEADERS } from './constants';
import type { AdmiraCsvRow } from './models';

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
  it('emite el encabezado en el orden autoritativo', () => {
    const csv = serializeAdmiraCsv([], { withBom: false });
    expect(csv).toBe(ADMIRA_CSV_HEADERS.join(','));
  });

  it('antepone el BOM UTF-8 por defecto', () => {
    const csv = serializeAdmiraCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('serializa filas respetando el orden de columnas y CRLF', () => {
    const csv = serializeAdmiraCsv([makeRow()], { withBom: false });
    const [header, row] = csv.split('\r\n');
    expect(header).toBe(
      'ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases',
    );
    expect(row).toBe('VW 914x908,Nike,GDL,VIDEOWALL,914 x 908,,PASES FULL');
  });

  it('escapa valores conflictivos en las filas', () => {
    const csv = serializeAdmiraCsv([makeRow({ ARTICULOS: 'A, B' })], {
      withBom: false,
    });
    expect(csv).toContain('"A, B"');
  });
});
