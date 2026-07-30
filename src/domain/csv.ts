import {
  ADMIRA_CSV_COLUMNS,
  ADMIRA_CSV_HEADER_LABELS,
  ADMIRA_CSV_TITLE,
} from './constants';
import type { AdmiraCsvRow } from './models';

/**
 * Serialización del CSV de Admira.
 *
 * Estructura del archivo (Admira ignora la **primera columna**, así que se usa
 * como columna "guarda"):
 * - **Columna A**: vacía en las filas de datos; su encabezado en `A1` es
 *   `LIVERPOOL` (ver `ADMIRA_CSV_TITLE`).
 * - **Columnas B en adelante**: el CSV real. Fila 1 = encabezado de columnas;
 *   filas siguientes = datos.
 *
 * Es decir, la fila 1 es
 * `LIVERPOOL,ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,Tipo de Pases`
 * y cada fila de datos comienza con una celda vacía:
 * `,VW 914x908,LIVERPOOL,L CULIACAN - 46,VIDEOWALL,914 x 908,LIVERPOOL,PASES MEDIUM`.
 *
 * Orden de columnas reales (autoritativo, columnas B–H):
 * `ARTICULOS,BRANDS,CENTROS,CIRCUITO,RESOLUCION,RETAILERS,TIPO DE PASES`.
 *
 * El encabezado ESCRITO rotula la última columna como `Tipo de Pases` (ver
 * `ADMIRA_CSV_HEADER_LABELS`); la llave interna con la que se leen las filas
 * (`AdmiraCsvRow`) y el encabezado del maestro permanecen `TIPO DE PASES`.
 *
 * Reglas: escapar correctamente comas, comillas y saltos de línea; opción de
 * UTF-8 con BOM si Admira lo requiere. `RETAILERS` es constante (`LIVERPOOL`,
 * ver `RETAILERS_VALUE`) y lo fija la consolidación; este módulo solo serializa
 * las filas que recibe.
 */

const DELIMITER = ',';
const RECORD_SEPARATOR = '\r\n';
const BOM = '\uFEFF';

/**
 * Escapa un campo según RFC 4180: si contiene el delimitador, comillas o
 * saltos de línea, se envuelve en comillas dobles y las comillas internas se
 * duplican.
 */
export function escapeCsvField(value: string): string {
  const needsQuoting = /[",\r\n]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** Serializa una fila de valores en una línea CSV. */
export function serializeCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvField).join(DELIMITER);
}

export interface CsvSerializeOptions {
  /** Antepone el BOM UTF-8 (útil para Excel/Admira). Por defecto `true`. */
  withBom?: boolean;
}

/**
 * Serializa las filas de Admira en un documento CSV completo, con el
 * encabezado en el orden autoritativo.
 */
export function serializeAdmiraCsv(
  rows: readonly AdmiraCsvRow[],
  options: CsvSerializeOptions = {},
): string {
  const { withBom = true } = options;
  // Columna A "guarda" (Admira la ignora): `LIVERPOOL` en A1, vacía en datos.
  const header = serializeCsvLine([
    ADMIRA_CSV_TITLE,
    ...ADMIRA_CSV_HEADER_LABELS,
  ]);
  const body = rows.map((row) =>
    serializeCsvLine([
      '',
      ...ADMIRA_CSV_COLUMNS.map((column) => row[column] ?? ''),
    ]),
  );
  const content = [header, ...body].join(RECORD_SEPARATOR);
  return withBom ? BOM + content : content;
}
