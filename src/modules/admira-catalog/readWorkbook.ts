import type { SheetData } from './masterImport';

/**
 * Lee un archivo .xlsx y lo convierte a la representación neutral `SheetData[]`
 * (texto de cada celda), que luego analiza `analyzeMaster`.
 *
 * `exceljs` se importa de forma dinámica para no engrosar el bundle principal.
 */

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // Fórmula: usar el resultado calculado.
    if ('result' in v) return cellToString(v.result);
    // Texto enriquecido.
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText
        .map((r) => cellToString((r as { text?: unknown }).text))
        .join('');
    }
    if ('text' in v) return cellToString(v.text);
    if ('hyperlink' in v && 'text' in v) return cellToString(v.text);
  }
  return String(value);
}

/** Convierte un archivo .xlsx (File/Blob) en hojas de texto. */
export async function readWorkbook(file: Blob): Promise<SheetData[]> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheets: SheetData[] = [];
  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      // row.eachCell no incluye celdas vacías intermedias de forma fiable;
      // se recorre por índice de columna hasta el máximo de la hoja.
      const columnCount = worksheet.columnCount;
      for (let c = 1; c <= columnCount; c += 1) {
        cells.push(cellToString(row.getCell(c).value));
      }
      rows.push(cells);
    });
    sheets.push({ name: worksheet.name, rows });
  });

  return sheets;
}
