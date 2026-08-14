import type { EkonRawRow } from './models';

/**
 * Hash del contenido normalizado de un lote Ekon, para detectar reimportaciones
 * idénticas (idempotencia). No es criptográfico: FNV-1a de 32 bits sobre una
 * serialización estable de los campos que definen el contenido operativo.
 */

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Serializa cada fila de forma estable (campos ordenados) y calcula el hash del
 * conjunto ordenado. Reordenar las filas del archivo no cambia el hash: dos
 * exportaciones equivalentes producen el mismo valor.
 */
export function contentHash(rows: readonly EkonRawRow[]): string {
  const lines = rows
    .map((r) =>
      [
        r.año,
        r.campaña,
        r.lineaCampaña,
        r.determinante,
        r.articulo,
        r.idPeriodo,
        r.inicioPeriodo ?? '',
        r.finPeriodo ?? '',
        r.producto,
        r.tipoCampañaOriginal,
        r.tienda,
        r.codigoCentro,
        r.familia,
        r.importeNeto ?? '',
        r.caras ?? '',
        r.noFactura,
      ].join(''),
    )
    .sort();
  return fnv1a(`${lines.length}${lines.join('')}`);
}
