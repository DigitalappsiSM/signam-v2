import { parseAdmiraPassesGrid } from './admiraPasses';
import type { AdmiraPassParseResult } from './admiraPasses';

export interface AdmiraPassWorkbookResult extends AdmiraPassParseResult {
  sheetName: string | null;
}

/** Lee el detalle de ocupación de Admira sin persistir el archivo. */
export async function readAdmiraPassesWorkbook(
  file: Blob,
): Promise<AdmiraPassWorkbookResult> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  let fallback: AdmiraPassWorkbookResult | null = null;

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    const parsed = parseAdmiraPassesGrid(grid);
    const result = { ...parsed, sheetName };
    if (parsed.headerRow !== null) return result;
    fallback ??= result;
  }

  return (
    fallback ?? {
      rows: [],
      issues: [
        {
          row: null,
          code: 'empty-workbook',
          message: 'El archivo no contiene hojas que puedan analizarse.',
        },
      ],
      headerRow: null,
      dates: [],
      players: [],
      sheetName: null,
    }
  );
}
