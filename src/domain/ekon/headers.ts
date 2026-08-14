/**
 * Encabezados del archivo Ekon (extracción "Datos Tienda").
 *
 * El parser acepta estos 30 encabezados. La comparación se hace de forma
 * NORMALIZADA (recorta espacios laterales, colapsa espacios internos, elimina
 * acentos y pasa a mayúsculas) para tolerar variaciones triviales de formato,
 * pero conserva el texto original para auditoría. El orden aquí es el orden
 * autoritativo del archivo real.
 */

/** Los 30 encabezados oficiales del archivo Ekon, en orden. */
export const EKON_HEADERS = [
  'Año',
  'Mes',
  'Cadena',
  'Enseña',
  'Artículo',
  'Determinante',
  'Tienda',
  'Provincia',
  'Sociedad',
  'Comprador',
  'Cliente',
  'Cliente final',
  'Anunciante',
  'Tipo Campaña',
  'Campaña',
  'Producto',
  'ID Periodo',
  'Inicio periodo',
  'Fin periodo',
  'Sector',
  'Caras',
  'Importe neto',
  'Tipo fact.',
  'No. factura',
  'Fecha Factura',
  'Código Centro',
  'Línea campaña',
  'Familia',
  'Comercial',
  'Contrato',
] as const;

export type EkonHeader = (typeof EKON_HEADERS)[number];

/**
 * Campos mínimos para formar una asignación Ekon válida. Una fila que no traiga
 * TODOS estos campos se aísla como rechazada (no aborta la importación).
 */
export const EKON_REQUIRED_HEADERS: readonly EkonHeader[] = [
  'Año',
  'Artículo',
  'Determinante',
  'Tienda',
  'Tipo Campaña',
  'Campaña',
  'Producto',
  'ID Periodo',
  'Inicio periodo',
  'Fin periodo',
  'Código Centro',
  'Línea campaña',
] as const;

/**
 * Normaliza un encabezado SOLO para comparación: recorta, colapsa espacios,
 * elimina acentos y pasa a mayúsculas. No se usa para almacenar datos.
 */
export function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

const NORMALIZED_TO_CANONICAL = new Map<string, EkonHeader>(
  EKON_HEADERS.map((h) => [normalizeHeader(h), h]),
);

/** Resultado de validar la fila de encabezados de un archivo Ekon. */
export interface HeaderValidation {
  /** Mapa columna→encabezado canónico para las columnas reconocidas. */
  columnIndex: Map<EkonHeader, number>;
  /** Encabezados requeridos ausentes. */
  missing: EkonHeader[];
  /** Encabezados canónicos duplicados (aparecen en más de una columna). */
  duplicated: EkonHeader[];
  /** Textos de encabezado no reconocidos (posibles columnas extra). */
  unknown: string[];
  /** true si no faltan encabezados requeridos ni hay duplicados requeridos. */
  ok: boolean;
}

/**
 * Valida la fila de encabezados: mapea cada columna a su encabezado canónico,
 * detecta faltantes (de los requeridos), duplicados y desconocidos. Pura.
 */
export function validateHeaders(
  headerRow: readonly string[],
): HeaderValidation {
  const columnIndex = new Map<EkonHeader, number>();
  const seen = new Map<EkonHeader, number>();
  const unknown: string[] = [];

  headerRow.forEach((raw, col) => {
    const text = (raw ?? '').trim();
    if (text === '') return;
    const canonical = NORMALIZED_TO_CANONICAL.get(normalizeHeader(text));
    if (!canonical) {
      unknown.push(text);
      return;
    }
    seen.set(canonical, (seen.get(canonical) ?? 0) + 1);
    // La primera aparición define la columna a usar.
    if (!columnIndex.has(canonical)) columnIndex.set(canonical, col);
  });

  const missing = EKON_REQUIRED_HEADERS.filter((h) => !columnIndex.has(h));
  const duplicated = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([header]) => header);

  return {
    columnIndex,
    missing,
    duplicated,
    unknown,
    ok: missing.length === 0 && duplicated.every((h) => !isRequired(h)),
  };
}

function isRequired(header: EkonHeader): boolean {
  return EKON_REQUIRED_HEADERS.includes(header);
}
