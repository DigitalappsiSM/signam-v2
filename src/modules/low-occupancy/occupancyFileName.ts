/**
 * Nombres de archivo de los CSV auxiliares Ratio 1 / Ratio 3.
 *
 * Formato:
 *   <NORMALIZACION>_<RESOLUCION>_RATIO_<1|3>_ANALISIS_<AAAA-MM-DD>_GENERADO_<AAAA-MM-DD>.csv
 *
 * Los textos `RATIO 1` / `RATIO 3` aparecen ÚNICAMENTE en el nombre del archivo,
 * nunca dentro de las columnas del CSV. El nombre incluye siempre la fecha
 * analizada y la fecha de generación (aunque sean iguales).
 */

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Sanea un segmento del nombre: elimina acentos, convierte espacios y diagonales
 * en `_`, sustituye caracteres inválidos, colapsa guiones bajos duplicados y
 * recorta los extremos. Conserva números y dimensiones (p. ej. `904x918`).
 */
export function sanitizeSegment(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // acentos
    .replace(/[\\/]+/g, '_') // diagonales
    .replace(/\s+/g, '_') // espacios
    .replace(/[^A-Za-z0-9_.-]/g, '_') // caracteres inválidos
    .replace(/_+/g, '_') // guiones bajos duplicados
    .replace(/^[_.]+|[_.]+$/g, ''); // extremos
}

export interface OccupancyFileNameInput {
  normalization: string;
  resolution: string;
  ratio: 1 | 3;
  /** Fecha analizada, `AAAA-MM-DD`. */
  analysisDate: string;
  /** Fecha de generación, `AAAA-MM-DD`. */
  generatedDate: string;
}

/** Construye el nombre del CSV Ratio 1 / Ratio 3 de un grupo. */
export function occupancyCsvFileName(input: OccupancyFileNameInput): string {
  const norm = sanitizeSegment(input.normalization) || 'SOPORTE';
  const res = sanitizeSegment(input.resolution) || 'RESOLUCION';
  return (
    `${norm}_${res}_RATIO_${input.ratio}` +
    `_ANALISIS_${input.analysisDate}_GENERADO_${input.generatedDate}.csv`
  );
}
