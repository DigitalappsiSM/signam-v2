import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  EXPORT_SHEET_NAME,
  FIELD_GUIDE,
  MAPPING_EXPORT_HEADER,
  buildCatalogWorkbook,
  buildTemplateWorkbook,
  catalogExportFileName,
} from './masterExport';
import { analyzeMaster, type SheetData } from './masterImport';
import { emptyOriginal } from './screenFactory';

function original(over: Partial<AdmiraScreenOriginal>): AdmiraScreenOriginal {
  return { ...emptyOriginal(), ...over };
}

function screen(over: {
  original: Partial<AdmiraScreenOriginal>;
  active?: boolean;
  calendarSupport?: string;
  id?: string;
}): AdmiraScreen {
  return {
    id: over.id ?? 'id-1',
    original: original(over.original),
    metadata: {
      active: over.active ?? true,
      createdAt: 0,
      updatedAt: 0,
      createdBy: 'a@b.com',
      updatedBy: 'a@b.com',
      source: 'manual',
      sourceSheet: '',
      sourceRow: 0,
      deactivationReason: null,
      version: 1,
      calendarSupport: over.calendarSupport ?? '',
    },
  };
}

const sample = screen({
  id: 's1',
  original: {
    'TIPO DE pantallas': 'VIDEOWALL',
    CENTROS: 'L GUADALAJARA GALERIAS',
    CIRCUITO: 'VIDEOWALL',
    RESOLUCION: '914 x 908',
    FORMATO: 'HORIZONTAL',
    'Nombre en plataforma': 'GDL VW',
    'TIPO DE PASES': 'PASES FULL',
    'Numero de Tienda': '78',
    'Nombre de tienda': 'L GUADALAJARA GALERIAS',
    Modelo: 'CRIUS',
    ARTICULOS: 'VW 914x908',
    BRANDS: 'LIVERPOOL',
  },
  calendarSupport: 'VIDEO WALL CRIUS',
});

/** Convierte un worksheet de exceljs en la representación neutral SheetData. */
function toSheetData(sheet: ExcelJS.Worksheet): SheetData {
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= sheet.columnCount; c += 1) {
      const v = row.getCell(c).value;
      cells.push(v == null ? '' : String(v));
    }
    rows.push(cells);
  });
  return { name: sheet.name, rows };
}

async function reload(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buffer = await wb.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer as ArrayBuffer);
  return reopened;
}

describe('buildCatalogWorkbook', () => {
  it('usa la hoja Consolidado que la importación espera', async () => {
    const wb = await reload(await buildCatalogWorkbook([sample]));
    expect(wb.getWorksheet(EXPORT_SHEET_NAME)).toBeDefined();
  });

  it('escribe los 12 encabezados oficiales en orden + la columna de mapeo', async () => {
    const wb = await reload(await buildCatalogWorkbook([sample]));
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const values = (sheet.getRow(1).values as (string | undefined)[]).slice(1);
    expect(values).toEqual([...ADMIRA_CATALOG_HEADERS, MAPPING_EXPORT_HEADER]);
  });

  it('omite la columna de mapeo cuando includeMappingColumn=false', async () => {
    const wb = await reload(
      await buildCatalogWorkbook([sample], { includeMappingColumn: false }),
    );
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const values = (sheet.getRow(1).values as (string | undefined)[]).slice(1);
    expect(values).toEqual([...ADMIRA_CATALOG_HEADERS]);
  });

  it('no escribe metadata SIGNAM (active/version/autores) en la hoja', async () => {
    const wb = await reload(await buildCatalogWorkbook([sample]));
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const header = (sheet.getRow(1).values as (string | undefined)[]).join('|');
    for (const forbidden of ['active', 'version', 'createdBy', 'updatedAt']) {
      expect(header).not.toContain(forbidden);
    }
  });

  it('exporta solo activas por defecto', async () => {
    const inactive = screen({
      id: 's2',
      original: { 'Numero de Tienda': '99' },
      active: false,
    });
    const wb = await reload(await buildCatalogWorkbook([sample, inactive]));
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    // 1 encabezado + 1 fila (solo la activa).
    expect(sheet.rowCount).toBe(2);
  });

  it('incluye inactivas cuando includeInactive=true', async () => {
    const inactive = screen({
      id: 's2',
      original: { 'Numero de Tienda': '99' },
      active: false,
    });
    const wb = await reload(
      await buildCatalogWorkbook([sample, inactive], { includeInactive: true }),
    );
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    expect(sheet.rowCount).toBe(3);
  });

  it('conserva el número de tienda como texto', async () => {
    const wb = await reload(await buildCatalogWorkbook([sample]));
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const storeCol = ADMIRA_CATALOG_HEADERS.indexOf('Numero de Tienda') + 1;
    expect(String(sheet.getCell(2, storeCol).value)).toBe('78');
  });

  it('round-trip: el archivo exportado se re-importa sin incidencias', async () => {
    const wb = await reload(await buildCatalogWorkbook([sample]));
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const analysis = analyzeMaster([toSheetData(sheet)]);
    expect(analysis.ok).toBe(true);
    expect(analysis.detectedSheet).toBe(EXPORT_SHEET_NAME);
    expect(analysis.missing).toEqual([]);
    expect(analysis.extra).toEqual([]);
    expect(analysis.rows).toHaveLength(1);
    expect(analysis.rows[0]?.original.Modelo).toBe('CRIUS');
    expect(analysis.mappingColumn).toBe(MAPPING_EXPORT_HEADER);
    expect(analysis.rows[0]?.calendarSupport).toBe('VIDEO WALL CRIUS');
  });
});

describe('buildTemplateWorkbook', () => {
  it('genera la hoja Consolidado y una hoja de instrucciones', async () => {
    const wb = await reload(await buildTemplateWorkbook());
    expect(wb.getWorksheet(EXPORT_SHEET_NAME)).toBeDefined();
    expect(wb.getWorksheet('Instrucciones')).toBeDefined();
  });

  it('la plantilla (con ejemplo) también es un maestro válido re-importable', async () => {
    const wb = await reload(await buildTemplateWorkbook());
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    const analysis = analyzeMaster([toSheetData(sheet)]);
    expect(analysis.ok).toBe(true);
    expect(analysis.missing).toEqual([]);
    expect(analysis.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('la hoja de instrucciones describe los 12 campos oficiales', async () => {
    const wb = await reload(await buildTemplateWorkbook());
    const sheet = wb.getWorksheet('Instrucciones')!;
    const described = new Set<string>();
    sheet.eachRow((row, idx) => {
      if (idx === 1) return;
      described.add(String(row.getCell(1).value));
    });
    for (const header of ADMIRA_CATALOG_HEADERS) {
      expect(described.has(header)).toBe(true);
    }
  });

  it('puede generarse sin fila de ejemplo (solo encabezados)', async () => {
    const wb = await reload(
      await buildTemplateWorkbook({ includeExample: false }),
    );
    const sheet = wb.getWorksheet(EXPORT_SHEET_NAME)!;
    expect(sheet.rowCount).toBe(1);
  });
});

describe('FIELD_GUIDE', () => {
  it('cubre los 12 campos oficiales en orden + el mapeo', () => {
    const headers = FIELD_GUIDE.map((f) => f.header);
    expect(headers).toEqual([...ADMIRA_CATALOG_HEADERS, MAPPING_EXPORT_HEADER]);
  });

  it('marca el mapeo como opcional y los oficiales como obligatorios', () => {
    for (const field of FIELD_GUIDE) {
      const isMapping = field.header === MAPPING_EXPORT_HEADER;
      expect(field.required).toBe(!isMapping);
    }
  });
});

describe('catalogExportFileName', () => {
  it('incluye la fecha civil aaaa-mm-dd', () => {
    const name = catalogExportFileName(new Date(2026, 7, 12).getTime());
    expect(name).toBe('Catálogo Admira_2026-08-12.xlsx');
  });
});
