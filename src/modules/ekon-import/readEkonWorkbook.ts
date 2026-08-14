import type { EkonCell } from '@/domain/ekon';

/**
 * Lee un archivo Ekon (`.xlsx`) a una matriz neutral `EkonCell[][]` (la primera
 * fila es el encabezado). Usa SheetJS con importación dinámica para no engrosar
 * el bundle principal, siguiendo el patrón del importador de calendario.
 *
 * Se lee en modo `raw` para conservar los seriales de fecha como números (el
 * dominio los convierte a fecha civil sin desfase). No se usa `cellDates` para
 * evitar que la zona horaria del navegador altere la fecha.
 */
export async function readEkonWorkbook(file: Blob): Promise<EkonCell[][]> {
  const XLSX = await import('xlsx');
  const data = new Uint8Array(await file.arrayBuffer());
  const workbook = XLSX.read(data, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];
  const grid = XLSX.utils.sheet_to_json<EkonCell[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  return grid;
}
