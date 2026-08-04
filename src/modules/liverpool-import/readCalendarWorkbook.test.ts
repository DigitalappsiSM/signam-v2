import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { readCalendarWorkbook } from './readCalendarWorkbook';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';

/** Construye un .xlsx en memoria a partir de una matriz (con fechas reales).
 *  Se expone como un `Blob` mínimo con `arrayBuffer()` (jsdom no lo implementa). */
function workbookBlob(aoa: unknown[][]): Blob {
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  const buf = XLSX.write(wb, {
    type: 'array',
    bookType: 'xlsx',
    cellDates: true,
  }) as ArrayLike<number>;
  const u8 = new Uint8Array(buf);
  return { arrayBuffer: async () => u8.buffer } as unknown as Blob;
}

describe('readCalendarWorkbook — fechas reales de Excel', () => {
  it('lee una fecha real como ISO (sin confundir día/mes)', async () => {
    // 5 de octubre de 2026 (mes index 9). Con formato mes-primero se vería
    // "10/5/26"; el lector debe emitir ISO inequívoco, no el texto ambiguo.
    const oct5 = new Date(2026, 9, 5);
    const data = await readCalendarWorkbook(workbookBlob([['Vigencia', oct5]]));
    const cell = data.sheets[0]!.rows[0]![1]!;
    expect(cell).toBe('2026-10-05');
    // Y al parsear da 5 de octubre (no 10 de mayo).
    const d = parseCampaignDate(cell)!;
    expect(d.getUTCDate()).toBe(5);
    expect(d.getUTCMonth()).toBe(9); // octubre
  });

  it('conserva el texto tal cual para valores no-fecha', async () => {
    const data = await readCalendarWorkbook(
      workbookBlob([['HIPER X', 'ISM/PROVEEDOR']]),
    );
    expect(data.sheets[0]!.rows[0]).toEqual(['HIPER X', 'ISM/PROVEEDOR']);
  });

  it('preserva etiquetas de fecha (mes) y ceros a la izquierda (no las convierte a ISO)', async () => {
    // A1: fecha formateada como NOMBRE DE MES (columna "MES"); debe conservarse.
    // B1: número con ceros a la izquierda (formato 000000); debe conservarse.
    const ws = XLSX.utils.aoa_to_sheet([[new Date(2026, 9, 5), 123]], {
      cellDates: true,
    });
    ws['A1']!.z = 'mmmm';
    ws['B1']!.z = '000000';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buf = XLSX.write(wb, {
      type: 'array',
      bookType: 'xlsx',
      cellDates: true,
    }) as ArrayLike<number>;
    const u8 = new Uint8Array(buf);
    const blob = { arrayBuffer: async () => u8.buffer } as unknown as Blob;

    const data = await readCalendarWorkbook(blob);
    const [mesLabel, leadingZeros] = data.sheets[0]!.rows[0]!;
    // El MES conserva su etiqueta (texto con letras), no un ISO.
    expect(mesLabel).toMatch(/[A-Za-z]/);
    expect(mesLabel).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // El identificador conserva los ceros a la izquierda.
    expect(leadingZeros).toBe('000123');
  });
});
