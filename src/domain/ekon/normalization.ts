/**
 * Normalización de valores del archivo Ekon.
 *
 * Reglas clave:
 * - Las fechas seriales de Excel se convierten a fechas CIVILES estables
 *   (`AAAA-MM-DD`) sin desfase por zona horaria.
 * - Identificadores (Campaña, Determinante, Código Centro, Línea campaña, ID
 *   Periodo, número de factura) se tratan como texto normalizado, nunca como
 *   cantidades calculables: se recortan y se colapsan a una forma estable.
 * - Los números de tienda/determinante se comparan sin ceros a la izquierda,
 *   conservando el valor original.
 */

/** Milisegundos por día. */
const MS_PER_DAY = 86400000;
/**
 * Epoch de Excel para el sistema 1900 con el bug histórico del 29/02/1900:
 * el día serial 1 es 1900-01-01, por lo que la base es 1899-12-30 en UTC.
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Convierte un serial de fecha de Excel a fecha civil `AAAA-MM-DD`.
 *
 * Se calcula en UTC y se formatea con los componentes UTC, de modo que el
 * resultado no depende de la zona horaria del navegador (una fecha civil no
 * tiene hora ni offset). Devuelve `null` si el valor no es un serial válido.
 */
export function excelSerialToCivil(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  // Se toma la parte entera del día (los seriales de periodo no llevan hora).
  const days = Math.round(serial);
  if (days <= 0) return null;
  const date = new Date(EXCEL_EPOCH_UTC + days * MS_PER_DAY);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `AAAA-MM-DD` ya válido (fecha civil). */
const ISO_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Interpreta un valor de celda de fecha (serial numérico, `Date` o texto ISO)
 * como fecha civil `AAAA-MM-DD`. Conserva el texto ISO tal cual cuando ya viene
 * en ese formato. Devuelve `null` cuando no puede interpretarse.
 */
export function toCivilDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return excelSerialToCivil(value);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  if (ISO_CIVIL.test(text)) return text;
  // Serial escrito como texto (p. ej. "46140").
  if (/^\d+$/.test(text)) return excelSerialToCivil(Number(text));
  return null;
}

/**
 * Normaliza un identificador de texto: recorta y colapsa espacios internos.
 * No elimina ceros a la izquierda ni cambia mayúsculas (un identificador es
 * texto, no una cantidad). Los valores numéricos se convierten a su
 * representación entera de cadena cuando no tienen parte decimal.
 */
export function normalizeId(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(value).trim();
  }
  return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Normaliza un número de tienda/determinante para COMPARACIÓN: recorta y, si es
 * numérico, elimina ceros a la izquierda (`0078` y `78` son la misma tienda).
 * Los códigos no numéricos se conservan tal cual. El valor original debe
 * guardarse por separado.
 */
export function normalizeStoreNumber(value: unknown): string {
  const t = normalizeId(value);
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
}

/** Texto plano recortado (para campos de presentación/comerciales). */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Interpreta un valor numérico (importe, caras) conservando negativos y
 * decimales. Devuelve `null` si no es numérico. No se usa para programación.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/,/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** El determinante que representa el Centro Administrativo (no es tienda). */
export const CENTRO_ADMINISTRATIVO_DETERMINANTE = '0';

/**
 * true si el determinante es `0` (Centro Administrativo): no es una tienda
 * física, no se concilia como tienda y no genera incidencias de tienda.
 */
export function isCentroAdministrativo(determinante: unknown): boolean {
  return (
    normalizeStoreNumber(determinante) === CENTRO_ADMINISTRATIVO_DETERMINANTE
  );
}
