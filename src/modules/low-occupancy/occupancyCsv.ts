import { serializeAdmiraCsv } from '@/domain';
import type { AdmiraCsvRow } from '@/domain';
import { occupancyCsvFileName } from './occupancyFileName';
import type { OccupancyExportGroup } from './types';

/**
 * CSV auxiliares Ratio 1 / Ratio 3.
 *
 * Reutilizan íntegramente el formato de Admira (`serializeAdmiraCsv`,
 * encabezados, columna guarda, BOM, CRLF, `RETAILERS=LIVERPOOL`). Los valores
 * internos de las filas son exactamente los del CSV normal de campañas; los
 * textos `RATIO 1` / `RATIO 3` viven únicamente en el nombre del archivo, nunca
 * en las columnas.
 */

/** Filas del ratio pedido de un grupo. */
export function ratioRows(
  group: OccupancyExportGroup,
  ratio: 1 | 3,
): AdmiraCsvRow[] {
  return ratio === 1 ? group.ratio1Rows : group.ratio3Rows;
}

/** ¿Hay filas para descargar en ese ratio? */
export function hasRatioRows(
  group: OccupancyExportGroup,
  ratio: 1 | 3,
): boolean {
  return ratioRows(group, ratio).length > 0;
}

export interface RatioCsv {
  fileName: string;
  content: string;
}

/**
 * Genera el CSV Ratio 1 / Ratio 3 de un grupo. Devuelve `null` si no hay filas
 * (no se descargan archivos vacíos).
 */
export function buildRatioCsv(
  group: OccupancyExportGroup,
  ratio: 1 | 3,
  dates: { analysisDate: string; generatedDate: string },
): RatioCsv | null {
  const rows = ratioRows(group, ratio);
  if (rows.length === 0) return null;
  return {
    fileName: occupancyCsvFileName({
      normalization: group.normalization,
      resolution: group.resolution,
      ratio,
      analysisDate: dates.analysisDate,
      generatedDate: dates.generatedDate,
    }),
    content: serializeAdmiraCsv(rows),
  };
}
