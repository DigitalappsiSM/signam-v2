import { describe, it, expect } from 'vitest';
import { analyzeMaster, type SheetData } from './masterImport';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';

const OFFICIAL = [...ADMIRA_CATALOG_HEADERS];

function rowFrom(values: Record<string, string>): string[] {
  return OFFICIAL.map((h) => values[h] ?? '');
}

function consolidado(
  dataRows: string[][],
  headers: string[] = OFFICIAL,
): SheetData {
  return { name: 'Consolidado', rows: [headers, ...dataRows] };
}

const sampleRow = rowFrom({
  'TIPO DE pantallas': 'LED',
  CENTROS: 'GDL',
  CIRCUITO: 'VIDEOWALL',
  RESOLUCION: '914 x 908',
  FORMATO: 'H',
  'Nombre en plataforma': 'GDL VW',
  'TIPO DE PASES': 'PASES FULL',
  'Numero de Tienda': '78',
  'Nombre de tienda': 'L GUADALAJARA GALERIAS',
  Modelo: 'CRIUS',
  ARTICULOS: 'VW 914x908',
  BRANDS: 'Nike',
});

describe('analyzeMaster — caso feliz', () => {
  it('detecta la hoja Consolidado, encabezados y filas', () => {
    const result = analyzeMaster([consolidado([sampleRow])]);
    expect(result.detectedSheet).toBe('Consolidado');
    expect(result.headerRow).toBe(1);
    expect(result.missing).toEqual([]);
    expect(result.extra).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.original.Modelo).toBe('CRIUS');
    expect(result.rows[0]?.sourceRow).toBe(2);
  });

  it('ignora filas totalmente vacías', () => {
    const empty = OFFICIAL.map(() => '');
    const result = analyzeMaster([consolidado([sampleRow, empty])]);
    expect(result.rows).toHaveLength(1);
  });

  it('elige la hoja operativa aunque haya otras hojas', () => {
    const other: SheetData = { name: 'Hoja4', rows: [['algo', 'irrelevante']] };
    const result = analyzeMaster([other, consolidado([sampleRow])]);
    expect(result.detectedSheet).toBe('Consolidado');
  });

  it('detecta encabezados aunque no estén en la primera fila', () => {
    const sheet: SheetData = {
      name: 'Consolidado',
      rows: [['Reporte maestro'], [''], OFFICIAL, sampleRow],
    };
    const result = analyzeMaster([sheet]);
    expect(result.headerRow).toBe(3);
    expect(result.rows[0]?.sourceRow).toBe(4);
    expect(result.ok).toBe(true);
  });
});

describe('analyzeMaster — incidencias', () => {
  it('reporta el caso heredado Pases → TIPO DE PASES sin corregirlo', () => {
    const headers = OFFICIAL.map((h) => (h === 'TIPO DE PASES' ? 'Pases' : h));
    const result = analyzeMaster([consolidado([sampleRow], headers)]);
    expect(result.legacyPases).toBe(true);
    expect(result.missing).toContain('TIPO DE PASES');
    expect(result.extra).toContain('Pases');
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) => i.severity === 'blocking' && i.message.includes('TIPO DE PASES'),
      ),
    ).toBe(true);
  });

  it('reporta columnas faltantes como bloqueantes', () => {
    const headers = OFFICIAL.filter((h) => h !== 'RESOLUCION');
    const result = analyzeMaster([consolidado([sampleRow], headers)]);
    expect(result.missing).toContain('RESOLUCION');
    expect(result.ok).toBe(false);
  });

  it('captura la columna de mapeo SOPORTE LIVERPOOL sin marcarla como adicional', () => {
    const headers = [...OFFICIAL, 'SOPORTE LIVERPOOL'];
    const rows = [[...sampleRow, 'VIDEO WALL CRIUS']];
    const result = analyzeMaster([
      { name: 'Consolidado', rows: [headers, ...rows] },
    ]);
    expect(result.mappingColumn).toBe('SOPORTE LIVERPOOL');
    expect(result.extra).not.toContain('SOPORTE LIVERPOOL');
    expect(result.rows[0]?.calendarSupport).toBe('VIDEO WALL CRIUS');
    expect(result.ok).toBe(true);
  });

  it('deja calendarSupport vacío si no hay columna de mapeo', () => {
    const result = analyzeMaster([consolidado([sampleRow])]);
    expect(result.mappingColumn).toBeNull();
    expect(result.rows[0]?.calendarSupport).toBe('');
  });

  it('reporta columnas adicionales como advertencia (no bloquean)', () => {
    const headers = [...OFFICIAL, 'COLUMNA EXTRA'];
    const rows = [[...sampleRow, 'valor extra']];
    const result = analyzeMaster([
      { name: 'Consolidado', rows: [headers, ...rows] },
    ]);
    expect(result.extra).toContain('COLUMNA EXTRA');
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  it('tolera acentos y mayúsculas en los encabezados', () => {
    const headers = OFFICIAL.map((h) =>
      h === 'RESOLUCION' ? 'resolución' : h,
    );
    const result = analyzeMaster([consolidado([sampleRow], headers)]);
    expect(result.missing).not.toContain('RESOLUCION');
    expect(result.ok).toBe(true);
  });

  it('bloquea si no identifica la hoja operativa', () => {
    const result = analyzeMaster([{ name: 'X', rows: [['a', 'b', 'c']] }]);
    expect(result.detectedSheet).toBeNull();
    expect(result.ok).toBe(false);
  });

  it('bloquea si no hay filas de datos', () => {
    const result = analyzeMaster([consolidado([])]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'no-rows')).toBe(true);
  });
});
