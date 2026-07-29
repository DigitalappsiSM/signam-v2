/**
 * Construcción del nombre de campaña Admira.
 *
 * Formato: `<Campaña Liverpool>_ <ARTICULOS>`  (nótese el espacio tras `_`).
 *
 * Si una misma campaña y resolución agrupa varios artículos distintos, se
 * concatenan con ` + ` en el orden de aparición en el maestro, eliminando
 * únicamente duplicados exactos y conservando el texto literal.
 */

/**
 * Deduplica artículos conservando el orden de aparición. La deduplicación es
 * exacta sobre el texto ya recortado (`trim`); no altera mayúsculas ni acentos.
 * Los valores vacíos se ignoran.
 */
export function dedupeArticulos(articulos: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of articulos) {
    const value = raw.trim();
    if (value === '' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Une varios artículos en la cadena literal usada por Admira, concatenando con
 * ` + ` y eliminando duplicados en orden de aparición.
 */
export function joinArticulos(articulos: readonly string[]): string {
  return dedupeArticulos(articulos).join(' + ');
}

/**
 * Construye el nombre de campaña Admira a partir del nombre Liverpool y de uno
 * o varios artículos.
 *
 * @example
 * buildAdmiraCampaignName('Nike Verano', ['VW 914x908'])
 * // => 'Nike Verano_ VW 914x908'
 * buildAdmiraCampaignName('Nike Verano', ['ARTICULO 1', 'ARTICULO 2'])
 * // => 'Nike Verano_ ARTICULO 1 + ARTICULO 2'
 */
export function buildAdmiraCampaignName(
  liverpoolCampaign: string,
  articulos: readonly string[],
): string {
  return `${liverpoolCampaign.trim()}_ ${joinArticulos(articulos)}`;
}
