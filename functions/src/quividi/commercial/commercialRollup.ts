import {
  combineCameraValues,
  isZoneSplitPair,
  publishedValue,
} from '../cameraCombination';
import { numeric, type OtsExportRow, type ViewerExportRow } from '../measurement';

/**
 * Rollup comercial derivado de Inteligencia Comercial (Fase 3).
 *
 * Lógica pura, sin Firebase: opera sobre las filas horarias que el histórico
 * Fase 2 ya guardó (`quividiHistoryPartitions`, exports `ots`/`1h` y
 * `viewers`/`1h`) y sobre los puntos configurados vigentes
 * (`quividiHistoryBindings`). Nunca toca esas colecciones ni recalcula el
 * crudo; solo construye la capa comercial derivada
 * (`quividiCommercialDaily`).
 *
 * Reusa **la misma** regla de combinación/duplicación multi-cámara que ya
 * aplica en Fase 1 (`../cameraCombination.ts`, `combineCameraValues` /
 * `isZoneSplitPair` / `publishedValue`) para que Inteligencia Comercial nunca
 * pueda divergir de la cifra que ya ve la marca en el reporte por campaña.
 * Ver docs/QUIVIDI_PHASE_3.md.
 */

export type CommercialRowStatus = 'measured' | 'partial' | 'missing';

export interface CommercialCameraDay {
  locationId: number;
  pointId: string | null;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionTenths: number;
  dwellTenths: number;
  measured: boolean;
}

export interface CommercialPair {
  storeNumber: string;
  storeName: string;
  support: string;
  /** Puntos distintos configurados para este par en la fecha, medidos o no. */
  configuredPointIds: readonly string[];
}

export interface CommercialDailyRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  status: CommercialRowStatus;
  /** Zona partida (Insurgentes, cualquier `BANNER DIGITAL`): sus puntos se suman. */
  zoneSplit: boolean;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  /**
   * Cifra de cara a marca: igual a `ots`/`effectiveOts`/`watchers` salvo que
   * el par tenga 1 punto configurado, o 2 sin ser zona partida, caso en el
   * que se duplica (`publishedValue` en `cameraCombination.ts`).
   */
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  pointIdsUsed: string[];
  locationIdsUsed: number[];
}

/** Suma las horas de un día para una sola cámara/punto a partir de los exports 1h ya guardados. */
export function aggregateHourlyCameraDay(
  locationId: number,
  pointId: string | null,
  otsRows: readonly OtsExportRow[],
  viewerRows: readonly ViewerExportRow[],
): CommercialCameraDay {
  return {
    locationId,
    pointId,
    ots: otsRows.reduce((sum, row) => sum + numeric(row.ots_count), 0),
    effectiveOts: otsRows.reduce(
      (sum, row) => sum + numeric(row.effective_ots_count),
      0,
    ),
    watchers: viewerRows.reduce((sum, row) => sum + numeric(row.watcher_count), 0),
    attentionTenths: viewerRows.reduce(
      (sum, row) => sum + numeric(row.attention_time_in_tenths_of_sec),
      0,
    ),
    dwellTenths: viewerRows.reduce(
      (sum, row) => sum + numeric(row.dwell_time_in_tenths_of_sec),
      0,
    ),
    measured: otsRows.length > 0 || viewerRows.length > 0,
  };
}

/**
 * Construye la fila comercial de un día para un par Tienda+Soporte,
 * combinando sus puntos con la regla de `cameraCombination.ts`: zona partida
 * (Insurgentes, `BANNER DIGITAL`) suma siempre; cualquier otro caso toma la
 * lectura más alta. La cifra publicada duplica (`publishedValue`) cuando el
 * par tiene 1 punto configurado, o 2 fuera de zona partida — nunca con 3+ o
 * en zona partida, que ya suma sus audiencias. Attention/Dwell Time son
 * promedios por watcher, no conteos, así que nunca se duplican.
 */
export function buildCommercialDailyRow(
  pair: CommercialPair,
  date: string,
  cameraDays: readonly CommercialCameraDay[],
): CommercialDailyRow | null {
  const configuredCameras = pair.configuredPointIds.length;
  if (configuredCameras === 0) return null;

  const zoneSplit = isZoneSplitPair({
    storeName: pair.storeName,
    support: pair.support,
  });
  const measured = cameraDays.filter((camera) => camera.measured);
  const status: CommercialRowStatus =
    measured.length === 0
      ? 'missing'
      : measured.length >= configuredCameras
        ? 'measured'
        : 'partial';

  const base = {
    date,
    storeNumber: pair.storeNumber,
    storeName: pair.storeName,
    support: pair.support,
    configuredCameras,
    measuredCameras: measured.length,
    status,
    zoneSplit,
  };

  if (measured.length === 0) {
    return {
      ...base,
      ots: 0,
      effectiveOts: 0,
      watchers: 0,
      attentionSeconds: 0,
      dwellSeconds: 0,
      publishedOts: 0,
      publishedEffectiveOts: 0,
      publishedWatchers: 0,
      pointIdsUsed: [],
      locationIdsUsed: [],
    };
  }

  const ots = combineCameraValues(measured.map((camera) => camera.ots), zoneSplit);
  const effectiveOts = combineCameraValues(
    measured.map((camera) => camera.effectiveOts),
    zoneSplit,
  );
  const watchers = combineCameraValues(
    measured.map((camera) => camera.watchers),
    zoneSplit,
  );
  const watchersTotal = measured.reduce((sum, camera) => sum + camera.watchers, 0);

  return {
    ...base,
    ots,
    effectiveOts,
    watchers,
    publishedOts: publishedValue(ots, configuredCameras, zoneSplit),
    publishedEffectiveOts: publishedValue(
      effectiveOts,
      configuredCameras,
      zoneSplit,
    ),
    publishedWatchers: publishedValue(watchers, configuredCameras, zoneSplit),
    attentionSeconds:
      watchersTotal > 0
        ? measured.reduce((sum, camera) => sum + camera.attentionTenths, 0) /
          watchersTotal /
          10
        : 0,
    dwellSeconds:
      watchersTotal > 0
        ? measured.reduce((sum, camera) => sum + camera.dwellTenths, 0) /
          watchersTotal /
          10
        : 0,
    pointIdsUsed: measured
      .map((camera) => camera.pointId)
      .filter((id): id is string => id != null),
    locationIdsUsed: measured.map((camera) => camera.locationId),
  };
}
