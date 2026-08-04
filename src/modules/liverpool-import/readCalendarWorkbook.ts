import type { CellComment, SheetData, WorkbookData } from './calendarImport';

/**
 * Lee un calendario de Liverpool a la representación neutral `WorkbookData`,
 * incluyendo los comentarios de celda (asignaciones de tienda).
 *
 * Usa SheetJS (`xlsx`), tolerante a formatos reales de sistemas operativos:
 * `.xlsx`, `.xls` (antiguo), `.xlsm`, etc. Se importa de forma dinámica para no
 * engrosar el bundle principal.
 */

/**
 * Fecha de Excel → ISO `AAAA-MM-DD` **sin ambigüedad**. Se toman los componentes
 * de la fecha real (no el texto formateado de la celda, que puede venir
 * mes-primero y confundir día/mes). SheetJS con `cellDates` construye la fecha a
 * medianoche local, por eso se usan los componentes locales.
 */
function isoFromExcelDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Fechas reales de Excel → ISO (evita el swap día/mes del formato visual).
  if (value instanceof Date) return isoFromExcelDate(value);
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

    // Filas como matriz. `raw:true` conserva los valores nativos: las fechas
    // llegan como `Date` (por `cellDates`) y se normalizan a ISO sin ambigüedad
    // día/mes; el resto se convierte a texto. Antes se usaba `raw:false`, que
    // formateaba las fechas con el formato de la celda (posible mes-primero) y
    // provocaba el intercambio día/mes.
    const raw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
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
