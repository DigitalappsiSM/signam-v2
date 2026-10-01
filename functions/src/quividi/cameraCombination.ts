import { normalizeStore, normalizeSupport } from './effectiveScope';

/**
 * Regla de combinación de OTS entre cámaras del mismo par tienda+soporte.
 *
 * Compartida por la agregación diaria (`measurement.ts`) y la horaria
 * (`hourly.ts`) para que el PDF comercial (horario) y el Excel técnico
 * (diario) salgan consistentes — ambos parten de la misma clasificación y el
 * mismo umbral, no de una corrección posterior en el frontend.
 */

/**
 * Brecha de OTS (valor absoluto) entre las cámaras de un par a partir de la
 * cual se desconfía del promedio y se usa la lectura más alta. Es el mismo
 * número que usa la alerta de salud de cámaras (`healthOverview.ts`), para
 * que la regla de negocio y la señal operativa hablen del mismo umbral.
 */
export const CAMERA_PAIR_GAP_THRESHOLD = 1000;

/**
 * Factor de duplicación para circuitos de una sola cámara configurada.
 *
 * Directriz de negocio: la mayoría de las tiendas con 1 sola cámara en
 * realidad tienen 2 pantallas en el mismo sitio (la cámara mide una, pero la
 * oportunidad de ver es la de las dos) — excepto Insurgentes, que ya queda
 * fuera de esta regla porque tiene 2 cámaras configuradas. Se basa en
 * cuántas cámaras tiene **asignadas** el circuito en el catálogo
 * (`configuredCameras`), no en cuántas reportaron ese día/hora: un circuito
 * de 2 cámaras donde una falló momentáneamente no es "de una sola cámara",
 * es una medición parcial de una instalación de 2 — ese caso ya lo resuelve
 * `combineCameraValues`.
 */
export const SINGLE_CAMERA_DUPLICATION_FACTOR = 2;

/**
 * Cifra de cara a marca a partir del dato medido: lo duplica
 * (`SINGLE_CAMERA_DUPLICATION_FACTOR`) cuando el circuito tiene una sola
 * cámara configurada; lo deja igual en cualquier otro caso (0 cámaras, o 2+
 * ya resueltas por `combineCameraValues`).
 */
export function publishedValue(
  measuredValue: number,
  configuredCameras: number,
): number {
  return configuredCameras === 1
    ? measuredValue * SINGLE_CAMERA_DUPLICATION_FACTOR
    : measuredValue;
}

/**
 * Pares cuyas 2 cámaras miden zonas físicas distintas del mismo circuito, así
 * que su oportunidad de ver es genuinamente el doble — no una redundancia
 * técnica de la misma pantalla (ver el comentario de `quividiLocationId2` en
 * `src/domain/models.ts`: la razón original de una segunda cámara es un mismo
 * PC con 2 flujos de video del MISMO circuito, p. ej. Toreo, Satélite,
 * Mitikah, Delta).
 *
 * - Insurgentes: sus 2 cámaras están en pisos distintos.
 * - Cualquier soporte `BANNER DIGITAL`: sus 2 caras dan a lados distintos del
 *   hueco central del centro comercial.
 *
 * Estos pares siempre se SUMAN, nunca se promedian ni se comparan contra el
 * umbral de brecha — sumarlos no es tolerar una brecha, es reconocer 2
 * audiencias.
 */
export function isZoneSplitPair(pair: {
  storeName: string;
  support: string;
}): boolean {
  return (
    normalizeStore(pair.storeName).includes('insurgentes') ||
    normalizeSupport(pair.support) === 'BANNER DIGITAL'
  );
}

/**
 * Combina las lecturas válidas (OTS o métrica equivalente) de las cámaras de
 * un mismo par tienda+soporte para un día/hora dado.
 *
 * - Zona partida (`isZoneSplit`): suma siempre.
 * - Si no, y la brecha entre la lectura más alta y la más baja supera
 *   `threshold`: se usa la más alta. Una brecha así de grande entre 2
 *   cámaras de la MISMA pantalla apunta a que la cámara baja está mal
 *   ubicada u obstruida, no a que haya menos público; promediar penalizaría
 *   el dato real que sí se captó.
 * - En cualquier otro caso: promedio (comportamiento histórico, para ruido
 *   normal entre 2 cámaras sanas).
 */
export function combineCameraValues(
  values: readonly number[],
  isZoneSplit: boolean,
  threshold: number = CAMERA_PAIR_GAP_THRESHOLD,
): number {
  if (values.length === 0) return 0;
  if (isZoneSplit) {
    return values.reduce((sum, value) => sum + value, 0);
  }
  if (values.length > 1) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    if (max - min > threshold) return max;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Entrada de salud de una cámara, lo mínimo que hace falta para agruparla
 * con sus hermanas de par y comparar su OTS. */
export interface CameraPairGapInput {
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  ots: number;
  monitored: boolean;
}

export interface CameraPairGap {
  storeNumber: string;
  storeName: string;
  support: string;
  gap: number;
  cameras: Array<{ locationId: number; locationName: string; ots: number }>;
}

/**
 * Pares con 2+ cámaras cuya brecha de OTS supera el umbral — señal operativa
 * para revisar la instalación física (ángulo, obstrucción, ubicación), no una
 * alerta de cámara caída (eso ya lo cubre el estado `no_measurement` /
 * `partial_measurement` / `no_ots` de cada cámara individual).
 *
 * Excluye los pares de zona partida (Insurgentes, Banner Digital): ahí una
 * brecha grande entre cámaras es el comportamiento esperado (zonas
 * distintas), no una incidencia que alertar.
 */
export function detectCameraPairGaps(
  cameras: readonly CameraPairGapInput[],
  threshold: number = CAMERA_PAIR_GAP_THRESHOLD,
): CameraPairGap[] {
  const groups = new Map<string, CameraPairGapInput[]>();
  for (const camera of cameras) {
    if (!camera.monitored) continue;
    if (isZoneSplitPair(camera)) continue;
    const key = `${camera.storeNumber}|${camera.support}`;
    const group = groups.get(key) ?? [];
    group.push(camera);
    groups.set(key, group);
  }

  const gaps: CameraPairGap[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const max = Math.max(...group.map((camera) => camera.ots));
    const min = Math.min(...group.map((camera) => camera.ots));
    const gap = max - min;
    if (gap <= threshold) continue;
    const first = group[0]!;
    gaps.push({
      storeNumber: first.storeNumber,
      storeName: first.storeName,
      support: first.support,
      gap,
      cameras: group
        .map((camera) => ({
          locationId: camera.locationId,
          locationName: camera.locationName,
          ots: camera.ots,
        }))
        .sort((a, b) => b.ots - a.ots),
    });
  }

  return gaps.sort((a, b) => b.gap - a.gap);
}
