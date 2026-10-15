import {
  combineCameraValues,
  combineCameraAverageSeconds,
  isSingleScreenPair,
  isZoneSplitPair,
  publishedFactor,
} from './cameraCombination';

type MeasurementStatus = 'complete' | 'partial' | 'missing';

interface CameraRef {
  id: number;
}

export interface HourlyPair {
  storeNumber: string;
  storeName: string;
  support: string;
  cameras: CameraRef[];
}

export interface HourlyOtsExportRow {
  location_id?: number;
  period_start?: string;
  duration?: number;
  ots_count?: number;
  effective_ots_count?: number;
}

export interface HourlyViewerExportRow {
  location_id?: number;
  period_start?: string;
  watcher_count?: number;
  attention_time_in_tenths_of_sec?: number;
  dwell_time_in_tenths_of_sec?: number;
}

export interface SupportHour {
  date: string;
  hour: number;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  status: MeasurementStatus;
  ots: number;
  effectiveOts: number;
  watchers: number;
  /** Ver `SupportDay.publishedOts` en `measurement.ts`. */
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  /** Zona partida (Mupi de Insurgentes, BANNER DIGITAL): suma sus cámaras. */
  zoneSplit: boolean;
  /** Factor aplicado a la cifra publicada (1 o 2, `publishedFactor`; v10). */
  publishedFactor: number;
  /**
   * Lectura de cada cámara que reportó esa hora, en todo par con 2+ cámaras
   * (v10; en v9 sólo zona partida). El informe comercial la usa para
   * rellenar, cámara por cámara y hora por hora, la cámara que no reportó con
   * su propio promedio dentro de la franja operativa: en zona partida se
   * suman las caras; en el resto se toma la más alta y se aplica
   * `publishedFactor`. En pares de 1 cámara no se envía (la fila es la
   * cámara), para no inflar el snapshot.
   */
  cameraReadings?: CameraHourReading[];
}

export interface CameraHourReading {
  locationId: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
}

interface OtsAggregate {
  duration: number;
  ots: number;
  effectiveOts: number;
}

interface ViewerAggregate {
  watchers: number;
  attentionTenths: number;
  dwellTenths: number;
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function periodKey(periodStart: unknown): string | null {
  if (typeof periodStart !== 'string') return null;
  const match = periodStart.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):/);
  if (!match) return null;
  const hour = Number(match[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${match[1]}|${String(hour).padStart(2, '0')}`;
}

function locationPeriodKey(
  locationId: number,
  periodStart: unknown,
): string | null {
  const period = periodKey(periodStart);
  return locationId > 0 && period ? `${locationId}|${period}` : null;
}

function buildOtsIndex(
  rows: readonly HourlyOtsExportRow[],
): Map<string, OtsAggregate> {
  const result = new Map<string, OtsAggregate>();
  for (const row of rows) {
    const locationId = numeric(row.location_id);
    const key = locationPeriodKey(locationId, row.period_start);
    if (!key) continue;
    const current = result.get(key) ?? {
      duration: 0,
      ots: 0,
      effectiveOts: 0,
    };
    current.duration += numeric(row.duration);
    current.ots += numeric(row.ots_count);
    current.effectiveOts += numeric(row.effective_ots_count);
    result.set(key, current);
  }
  return result;
}

function buildViewerIndex(
  rows: readonly HourlyViewerExportRow[],
): Map<string, ViewerAggregate> {
  const result = new Map<string, ViewerAggregate>();
  for (const row of rows) {
    const locationId = numeric(row.location_id);
    const key = locationPeriodKey(locationId, row.period_start);
    if (!key) continue;
    const current = result.get(key) ?? {
      watchers: 0,
      attentionTenths: 0,
      dwellTenths: 0,
    };
    current.watchers += numeric(row.watcher_count);
    current.attentionTenths += numeric(row.attention_time_in_tenths_of_sec);
    current.dwellTenths += numeric(row.dwell_time_in_tenths_of_sec);
    result.set(key, current);
  }
  return result;
}

function pairPeriods(
  pair: HourlyPair,
  ots: ReadonlyMap<string, OtsAggregate>,
): string[] {
  const periods = new Set<string>();
  for (const camera of pair.cameras) {
    const prefix = `${camera.id}|`;
    for (const key of ots.keys()) {
      if (key.startsWith(prefix)) periods.add(key.slice(prefix.length));
    }
  }
  return Array.from(periods).sort();
}

/**
 * Construye la capa horaria usada por el reporte comercial.
 *
 * La regla de múltiples cámaras replica la metodología diaria
 * (`combineCameraValues`, compartida con `measurement.ts`): por cada hora se
 * combinan únicamente las cámaras que realmente entregaron OTS — sumadas si
 * el par es de zona partida (Mupi de Insurgentes, Banner Digital), la más
 * alta en cualquier otro caso.
 * Si sólo una de varias cámaras reporta, se conserva la medición y el estado
 * queda parcial.
 */
export function buildSupportHours(
  pairs: readonly HourlyPair[],
  otsRows: readonly HourlyOtsExportRow[],
  viewerRows: readonly HourlyViewerExportRow[],
): SupportHour[] {
  const ots = buildOtsIndex(otsRows);
  const viewers = buildViewerIndex(viewerRows);
  const result: SupportHour[] = [];

  for (const pair of pairs) {
    if (pair.cameras.length === 0) continue;
    const zoneSplit = isZoneSplitPair(pair);
    const factor = publishedFactor(
      pair.cameras.length,
      zoneSplit,
      isSingleScreenPair(pair),
    );
    for (const period of pairPeriods(pair, ots)) {
      const measured = pair.cameras
        .map((camera) => {
          const key = `${camera.id}|${period}`;
          const otsRow = ots.get(key);
          if (!otsRow || otsRow.duration <= 0) return null;
          return {
            locationId: camera.id,
            ots: otsRow,
            viewers: viewers.get(key),
          };
        })
        .filter(
          (
            item,
          ): item is {
            locationId: number;
            ots: OtsAggregate;
            viewers: ViewerAggregate | undefined;
          } => item != null,
        );

      if (measured.length === 0) continue;

      const [date, hourText] = period.split('|');
      const hourOts = combineCameraValues(
        measured.map((item) => item.ots.ots),
        zoneSplit,
      );
      const hourEffectiveOts = combineCameraValues(
        measured.map((item) => item.ots.effectiveOts),
        zoneSplit,
      );
      // Misma regla que OTS: suma en zona partida, la más alta si no.
      const hourWatchers = combineCameraValues(
        measured.map((item) => item.viewers?.watchers ?? 0),
        zoneSplit,
      );
      result.push({
        date: date ?? '',
        hour: Number(hourText),
        storeNumber: pair.storeNumber,
        storeName: pair.storeName,
        support: pair.support,
        configuredCameras: pair.cameras.length,
        measuredCameras: measured.length,
        status:
          measured.length === pair.cameras.length ? 'complete' : 'partial',
        zoneSplit,
        publishedFactor: factor,
        ots: hourOts,
        effectiveOts: hourEffectiveOts,
        watchers: hourWatchers,
        publishedOts: hourOts * factor,
        publishedEffectiveOts: hourEffectiveOts * factor,
        publishedWatchers: hourWatchers * factor,
        attentionSeconds: combineCameraAverageSeconds(
          measured.map((item) => ({
            watchers: item.viewers?.watchers ?? 0,
            tenths: item.viewers?.attentionTenths ?? 0,
          })),
          zoneSplit,
        ),
        dwellSeconds: combineCameraAverageSeconds(
          measured.map((item) => ({
            watchers: item.viewers?.watchers ?? 0,
            tenths: item.viewers?.dwellTenths ?? 0,
          })),
          zoneSplit,
        ),
        ...(pair.cameras.length >= 2
          ? {
              cameraReadings: measured.map((item) => ({
                locationId: item.locationId,
                ots: item.ots.ots,
                effectiveOts: item.ots.effectiveOts,
                watchers: item.viewers?.watchers ?? 0,
              })),
            }
          : {}),
      });
    }
  }

  return result.sort((a, b) =>
    `${a.date}|${String(a.hour).padStart(2, '0')}|${a.storeNumber}|${a.support}`.localeCompare(
      `${b.date}|${String(b.hour).padStart(2, '0')}|${b.storeNumber}|${b.support}`,
      'es',
    ),
  );
}
