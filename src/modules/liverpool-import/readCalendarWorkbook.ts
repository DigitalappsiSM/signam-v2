import type { CellComment, SheetData, WorkbookData } from './calendarImport';

/**
 * Lee un calendario .xlsx (Liverpool) a la representación neutral `WorkbookData`
 * incluyendo los comentarios de celda (asignaciones de tienda).
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
    if ('result' in v) return cellToString(v.result);
    if ('richText' in v && Array.isArray(v.richText)) {
      return v.richText
        .map((r) => cellToString((r as { text?: unknown }).text))
        .join('');
    }
    if ('text' in v) return cellToString(v.text);
  }
  return String(value);
}

/** Convierte un comentario (string o {texts:[{text}]}) a texto plano. */
function noteToString(note: unknown): string {
  if (!note) return '';
  if (typeof note === 'string') return note.trim();
  if (typeof note === 'object') {
    const n = note as Record<string, unknown>;
    if (Array.isArray(n.texts)) {
      return n.texts
        .map((t) => cellToString((t as { text?: unknown }).text))
        .join('')
        .trim();
    }
    if ('text' in n) return cellToString(n.text).trim();
  }
  return '';
}

/** Lee un archivo .xlsx (File/Blob) en hojas de texto + comentarios de celda. */
export async function readCalendarWorkbook(file: Blob): Promise<WorkbookData> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheets: SheetData[] = [];
  const comments: CellComment[] = [];

  workbook.eachSheet((worksheet) => {
    const rows: string[][] = [];
    const columnCount = worksheet.columnCount;
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells: string[] = [];
      for (let c = 1; c <= columnCount; c += 1) {
        const cell = row.getCell(c);
        cells.push(cellToString(cell.value));
        const text = noteToString((cell as { note?: unknown }).note);
        if (text !== '') {
          comments.push({
            sheet: worksheet.name,
            row: rowNumber,
            col: c,
            address: cell.address,
            text,
          });
        }
      }
      rows.push(cells);
    });
    sheets.push({ name: worksheet.name, rows });
  });

  return { sheets, comments };
}
