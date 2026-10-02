import {
  combineCameraValues,
  isZoneSplitPair,
  publishedValue,
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
 * el par es de zona partida (Insurgentes, Banner Digital), la más alta si la
 * brecha entre cámaras supera el umbral, promediadas en cualquier otro caso.
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
    for (const period of pairPeriods(pair, ots)) {
      const measured = pair.cameras
        .map((camera) => {
          const key = `${camera.id}|${period}`;
          const otsRow = ots.get(key);
          if (!otsRow || otsRow.duration <= 0) return null;
          return {
            ots: otsRow,
            viewers: viewers.get(key),
          };
        })
        .filter(
          (
            item,
          ): item is {
            ots: OtsAggregate;
            viewers: ViewerAggregate | undefined;
          } => item != null,
        );

      if (measured.length === 0) continue;

      const watchersTotal = measured.reduce(
        (sum, item) => sum + (item.viewers?.watchers ?? 0),
        0,
      );
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
        ots: hourOts,
        effectiveOts: hourEffectiveOts,
        watchers: hourWatchers,
        publishedOts: publishedValue(hourOts, pair.cameras.length, zoneSplit),
        publishedEffectiveOts: publishedValue(
          hourEffectiveOts,
          pair.cameras.length,
          zoneSplit,
        ),
        publishedWatchers: publishedValue(
          hourWatchers,
          pair.cameras.length,
          zoneSplit,
        ),
        attentionSeconds:
          watchersTotal > 0
            ? measured.reduce(
                (sum, item) => sum + (item.viewers?.attentionTenths ?? 0),
                0,
              ) /
              watchersTotal /
              10
            : 0,
        dwellSeconds:
          watchersTotal > 0
            ? measured.reduce(
                (sum, item) => sum + (item.viewers?.dwellTenths ?? 0),
                0,
              ) /
              watchersTotal /
              10
            : 0,
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
