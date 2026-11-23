import { classifyCameraHealth } from './cameraAlerts';
import {
  buildHourlyOperationalIndex,
  CAMERA_HEALTH_EXPECTED_CORE_HOURS,
} from './cameraHealth';
import { historyRowCivilDate } from './historyModel';

export function summarizeChedrauiMeasurement(
  data: Record<string, unknown>[],
  locations: number[],
  date: string,
) {
  const requested = new Set(locations);
  if (
    data.some(
      (row) =>
        !requested.has(Number(row.location_id)) ||
        historyRowCivilDate(row) !== date ||
        typeof row.period_start !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}[T ](?:[01]\d|2[0-3]):/.test(row.period_start),
    )
  ) {
    throw new Error(
      'La exportación Chedraui contiene fechas o cámaras inesperadas.',
    );
  }

  const index = buildHourlyOperationalIndex(
    data.map((row) => ({
      location_id: Number(row.location_id),
      period_start: String(row.period_start),
      duration: Number(row.duration ?? 0),
      ots_count: Number(row.ots_count ?? 0),
    })),
  );
  return Object.fromEntries(
    locations.map((locationId) => {
      const hours = index.get(`${locationId}|${date}`);
      const measurement = {
        expectedCoreHours: CAMERA_HEALTH_EXPECTED_CORE_HOURS,
        coreMeasuredHours: hours?.coreMeasuredHours.size ?? 0,
        coreOtsHours: hours?.coreOtsHours.size ?? 0,
        coreOts: hours?.coreOts ?? 0,
      };
      return [
        locationId,
        { ...measurement, status: classifyCameraHealth(measurement) },
      ];
    }),
  );
}
