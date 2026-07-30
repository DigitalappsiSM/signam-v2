/**
 * Objetivo de "T Arranque": testigos de al menos el 10% de las tiendas
 * realmente incluidas tras la consolidación.
 *
 * El conteo de tiendas debe provenir de **tiendas distintas** de las pantallas
 * que realmente consolidaron (no del número de pantallas, ni de filas CSV, ni de
 * las tiendas solicitadas que fueron excluidas por incidencias). El cálculo de
 * ese conteo vive en la página (usa `Consolidation.screenIds` + catálogo); aquí
 * solo se aplica el redondeo hacia arriba.
 */

/** Objetivo del 10% con redondeo hacia arriba. 0 tiendas → 0. */
export function witnessStartTarget(totalDistinctStores: number): number {
  if (!Number.isFinite(totalDistinctStores) || totalDistinctStores <= 0) {
    return 0;
  }
  return Math.ceil(totalDistinctStores * 0.1);
}
