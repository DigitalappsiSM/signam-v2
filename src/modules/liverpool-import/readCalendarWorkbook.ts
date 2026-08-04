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

/** Texto formateado de una celda (equivalente a `raw:false`). */
function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoFromExcelDate(value);
  return String(value).trim();
}

/** Fecha **numérica** (posible mes-primero): `d/m/aaaa`, `m-d-aa`, etc. */
const NUMERIC_DATE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/;

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

    // Dos lecturas alineadas por [fila][col]:
    // - `formatted` (raw:false) conserva el valor mostrado (nombre de mes del
    //   MES, ceros a la izquierda, etc.) — es lo que se usa por defecto.
    // - `native` (raw:true) trae el valor nativo; las fechas llegan como `Date`.
    // Solo se normaliza a ISO una celda cuyo valor nativo es `Date` **y** cuyo
    // texto formateado es una **fecha numérica** (posible mes-primero, que causa
    // el swap día/mes). Así se corrigen las vigencias sin alterar el resto.
    const formatted = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
    }) as unknown[][];
    const native = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: true,
    }) as unknown[][];
    const rows: string[][] = formatted.map((r, ri) =>
      r.map((cell, ci) => {
        const text = toText(cell);
        const value = native[ri]?.[ci];
        if (value instanceof Date && NUMERIC_DATE.test(text)) {
          return isoFromExcelDate(value);
        }
        return text;
      }),
    );
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
