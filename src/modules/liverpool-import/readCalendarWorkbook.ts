import type { CellComment, SheetData, WorkbookData } from './calendarImport';

/**
 * Lee un calendario de Liverpool a la representación neutral `WorkbookData`,
 * incluyendo los comentarios de celda (asignaciones de tienda).
 *
 * Usa SheetJS (`xlsx`), tolerante a formatos reales de sistemas operativos:
 * `.xlsx`, `.xls` (antiguo), `.xlsm`, etc. Se importa de forma dinámica para no
 * engrosar el bundle principal.
 */

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/** Lee un archivo de calendario (File/Blob) en hojas de texto + comentarios. */
export async function readCalendarWorkbook(file: Blob): Promise<WorkbookData> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array', cellDates: true });

  const sheets: SheetData[] = [];
  const comments: CellComment[] = [];

  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;

    // Filas como matriz de texto (raw:false formatea fechas/números).
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }) as unknown[][];
    const rows: string[][] = raw.map((r) => r.map(toText));
    sheets.push({ name, rows });

    // Comentarios de celda.
    const ref = ws['!ref'];
    if (!ref) continue;
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const address = XLSX.utils.encode_cell({ r, c });
        const cell = ws[address] as { c?: { t?: string }[] } | undefined;
        if (!cell?.c) continue;
        const text = cell.c
          .map((part) => part.t ?? '')
          .join('')
          .trim();
        if (text !== '') {
          comments.push({ sheet: name, row: r + 1, col: c + 1, address, text });
        }
      }
    }
  }

  return { sheets, comments };
}
