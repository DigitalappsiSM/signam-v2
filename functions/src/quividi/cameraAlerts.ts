import type { CameraHealthRecord } from './cameraHealth';

export const CAMERA_HEALTH_ALERT_SCHEMA_VERSION = 1;
export const CAMERA_HEALTH_CORE_MIN_COVERAGE_RATIO = 0.8;

export type CameraOperationalHealth =
  | 'normal'
  | 'no_measurement'
  | 'partial_measurement'
  | 'no_ots';

export type CameraHealthSeverity = 'none' | 'medium' | 'high' | 'critical';

export interface CameraHealthEvaluation {
  locationId: number;
  latestDate: string;
  historyStartDate: string;
  currentStatus: CameraOperationalHealth;
  severity: CameraHealthSeverity;
  incidentStartDate: string | null;
  consecutiveDays: number;
  latestRecord: CameraHealthRecord;
}

export interface CameraHealthAlertStateDoc {
  schemaVersion: 1;
  source: 'quividi';
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  currentStatus: CameraOperationalHealth;
  severity: CameraHealthSeverity;
  latestDate: string;
  activeAlertId: string | null;
  startedDate: string | null;
  lastEvaluatedAt: number;
}

export interface CameraHealthAlertDoc {
  schemaVersion: 1;
  source: 'quividi';
  alertId: string;
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  state: 'active' | 'recovered';
  initialType: Exclude<CameraOperationalHealth, 'normal'>;
  currentType: Exclude<CameraOperationalHealth, 'normal'>;
  severity: Exclude<CameraHealthSeverity, 'none'>;
  startedDate: string;
  lastAnomalousDate: string;
  recoveredDate: string | null;
  consecutiveDays: number;
  latestDate: string;
  expectedCoreHours: number;
  coreMeasuredHours: number;
  coreOtsHours: number;
  coreOts: number;
  firstMeasuredHour: number | null;
  lastMeasuredHour: number | null;
  firstOtsHour: number | null;
  lastOtsHour: number | null;
  createdAt: number;
  updatedAt: number;
}

function severityFor(status: CameraOperationalHealth): CameraHealthSeverity {
  switch (status) {
    case 'no_measurement':
      return 'critical';
    case 'no_ots':
      return 'high';
    case 'partial_measurement':
      return 'medium';
    default:
      return 'none';
  }
}

/**
 * Evalúa únicamente la ventana núcleo 11:00–22:00.
 *
 * La franja 10:00–11:00 queda fuera del criterio de alerta porque algunas
 * tiendas encienden sus cámaras hasta las 11:00 por operación local.
 */
export function classifyCameraHealth(
  record: CameraHealthRecord,
): CameraOperationalHealth {
  const expected = Math.max(1, record.expectedCoreHours);
  const minimumMeasuredHours = Math.ceil(
    expected * CAMERA_HEALTH_CORE_MIN_COVERAGE_RATIO,
  );

  if (record.coreMeasuredHours === 0) return 'no_measurement';
  if (record.coreMeasuredHours < minimumMeasuredHours) {
    return 'partial_measurement';
  }
  if (record.coreOts <= 0) return 'no_ots';
  return 'normal';
}

export function cameraHealthAlertId(
  locationId: number,
  startedDate: string,
): string {
  return `${locationId}__${startedDate}`;
}

function sortByDate(
  rows: readonly CameraHealthRecord[],
): CameraHealthRecord[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * El histórico solo aporta contexto. Una cámara genera alerta únicamente si
 * el último día completo sigue anómalo. Incidencias antiguas que ya se
 * recuperaron no producen alertas retroactivas.
 */
export function buildCurrentCameraHealthEvaluations(
  records: readonly CameraHealthRecord[],
  latestDate: string,
): CameraHealthEvaluation[] {
  const byCamera = new Map<number, CameraHealthRecord[]>();
  for (const record of records) {
    const current = byCamera.get(record.locationId) ?? [];
    current.push(record);
    byCamera.set(record.locationId, current);
  }

  const evaluations: CameraHealthEvaluation[] = [];
  for (const rows of byCamera.values()) {
    const ordered = sortByDate(rows);
    const latestIndex = ordered.findIndex((row) => row.date === latestDate);
    if (latestIndex < 0) continue;

    const latestRecord = ordered[latestIndex]!;
    const currentStatus = classifyCameraHealth(latestRecord);
    let incidentStartDate: string | null = null;
    let consecutiveDays = 0;

    if (currentStatus !== 'normal') {
      let startIndex = latestIndex;
      while (
        startIndex > 0 &&
        classifyCameraHealth(ordered[startIndex - 1]!) !== 'normal'
      ) {
        startIndex -= 1;
      }
      incidentStartDate = ordered[startIndex]!.date;
      consecutiveDays = latestIndex - startIndex + 1;
    }

    evaluations.push({
      locationId: latestRecord.locationId,
      latestDate,
      historyStartDate: ordered[0]!.date,
      currentStatus,
      severity: severityFor(currentStatus),
      incidentStartDate,
      consecutiveDays,
      latestRecord,
    });
  }

  return evaluations.sort((a, b) => a.locationId - b.locationId);
}

export function daysInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0;
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function previousCivilDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}
