import type { Firestore } from 'firebase-admin/firestore';
import type {
  CameraHealthRefreshStage,
  CameraHealthRefreshStatus,
  CameraHealthRefreshTrigger,
} from './cameraHealthRefresh';
import {
  daysInclusive,
  type CameraHealthAlertDoc,
  type CameraHealthAlertStateDoc,
} from './cameraAlerts';

export interface CameraHealthOverviewRow {
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  monitored: boolean;
  currentStatus: 'normal' | 'no_measurement' | 'partial_measurement' | 'no_ots';
  severity: 'none' | 'medium' | 'high' | 'critical';
  latestDate: string;
  activeAlertId: string | null;
  startedDate: string | null;
  consecutiveDays: number;
  expectedCoreHours: number;
  coreMeasuredHours: number;
  coreOtsHours: number;
  coreOts: number;
  firstMeasuredHour: number | null;
  lastMeasuredHour: number | null;
  firstOtsHour: number | null;
  lastOtsHour: number | null;
  lastEvaluatedAt: number;
  measurementPointId: string | null;
  measurementPointCode: string | null;
  ticketAction: 'none' | 'automatic' | 'manual';
  ticketStatus:
    | 'not_configured'
    | 'not_needed'
    | 'pending_decision'
    | 'auto_pending'
    | 'creating'
    | 'created'
    | 'recovery_notified'
    | 'error';
  ticketId: number | null;
  ticketError: string | null;
  canCreateTicket: boolean;
}

export interface CameraHealthRefreshOverview {
  status: CameraHealthRefreshStatus;
  stage: CameraHealthRefreshStage | null;
  trigger: CameraHealthRefreshTrigger | null;
  startedAt: number | null;
  startedByEmail: string | null;
  completedAt: number | null;
  cooldownUntil: number | null;
  lastManualCompletedAt: number | null;
  lastManualCompletedByEmail: string | null;
  lastAutomaticCompletedAt: number | null;
  lastError: string | null;
  canRefresh: boolean;
}

export interface CameraHealthOverviewResponse {
  generatedAt: number;
  latestDate: string | null;
  summary: {
    monitored: number;
    normal: number;
    activeAlerts: number;
    outOfScope: number;
  };
  cameras: CameraHealthOverviewRow[];
  refresh: CameraHealthRefreshOverview;
  recentRecoveries: Array<{
    alertId: string;
    locationId: number;
    locationName: string;
    storeNumber: string;
    storeName: string;
    support: string;
    startedDate: string;
    lastAnomalousDate: string;
    recoveredDate: string;
  }>;
}

function operationalHealth(
  value: unknown,
): CameraHealthOverviewRow['currentStatus'] {
  return value === 'no_measurement' ||
    value === 'partial_measurement' ||
    value === 'no_ots'
    ? value
    : 'normal';
}

function healthSeverity(value: unknown): CameraHealthOverviewRow['severity'] {
  return value === 'medium' || value === 'high' || value === 'critical'
    ? value
    : 'none';
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableHour(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export async function buildCameraHealthOverview(
  db: Firestore,
  stateCollection: string,
  alertCollection: string,
): Promise<CameraHealthOverviewResponse> {
  const statesSnap = await db.collection(stateCollection).get();
  const stateRows = statesSnap.docs.map((doc) => {
    const data = doc.data() as Partial<CameraHealthAlertStateDoc>;
    return { docId: doc.id, data };
  });

  const activeIds = Array.from(
    new Set(
      stateRows
        .map(({ data }) =>
          typeof data.activeAlertId === 'string' ? data.activeAlertId : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const alertRefs = activeIds.map((id) =>
    db.collection(alertCollection).doc(id),
  );
  const alertSnaps = alertRefs.length > 0 ? await db.getAll(...alertRefs) : [];
  const alerts = new Map<string, Partial<CameraHealthAlertDoc>>();
  for (const snap of alertSnaps) {
    if (snap.exists) {
      alerts.set(snap.id, snap.data() as Partial<CameraHealthAlertDoc>);
    }
  }

  const cameras: CameraHealthOverviewRow[] = stateRows.map(({ docId, data }) => {
    const activeAlertId =
      typeof data.activeAlertId === 'string' ? data.activeAlertId : null;
    const activeAlert = activeAlertId ? alerts.get(activeAlertId) : undefined;
    const latestDate =
      typeof data.latestDate === 'string' ? data.latestDate : '';
    const startedDate =
      typeof data.startedDate === 'string' ? data.startedDate : null;

    return {
      locationId:
        typeof data.locationId === 'number'
          ? data.locationId
          : Number(docId) || 0,
      locationName:
        typeof data.locationName === 'string' ? data.locationName : '',
      storeNumber:
        typeof data.storeNumber === 'string' ? data.storeNumber : '',
      storeName: typeof data.storeName === 'string' ? data.storeName : '',
      support: typeof data.support === 'string' ? data.support : '',
      monitored: data.monitored !== false,
      currentStatus: operationalHealth(data.currentStatus),
      severity: healthSeverity(data.severity),
      latestDate,
      activeAlertId,
      startedDate,
      consecutiveDays:
        typeof activeAlert?.consecutiveDays === 'number'
          ? activeAlert.consecutiveDays
          : startedDate && latestDate
            ? daysInclusive(startedDate, latestDate)
            : 0,
      expectedCoreHours: finiteNumber(data.expectedCoreHours, 11),
      coreMeasuredHours: finiteNumber(data.coreMeasuredHours),
      coreOtsHours: finiteNumber(data.coreOtsHours),
      coreOts: finiteNumber(data.coreOts),
      firstMeasuredHour: nullableHour(data.firstMeasuredHour),
      lastMeasuredHour: nullableHour(data.lastMeasuredHour),
      firstOtsHour: nullableHour(data.firstOtsHour),
      lastOtsHour: nullableHour(data.lastOtsHour),
      lastEvaluatedAt: finiteNumber(data.lastEvaluatedAt),
      measurementPointId: null,
      measurementPointCode: null,
      ticketAction: 'none',
      ticketStatus: 'not_configured',
      ticketId: null,
      ticketError: null,
      canCreateTicket: false,
    };
  });

  cameras.sort((a, b) => {
    const aRank = !a.monitored ? 2 : a.activeAlertId ? 0 : 1;
    const bRank = !b.monitored ? 2 : b.activeAlertId ? 0 : 1;
    if (aRank !== bRank) return aRank - bRank;
    return (
      a.storeNumber +
      '|' +
      a.support +
      '|' +
      a.locationName
    ).localeCompare(
      b.storeNumber + '|' + b.support + '|' + b.locationName,
      'es',
    );
  });

  const recoveredSnap = await db
    .collection(alertCollection)
    .where('state', '==', 'recovered')
    .limit(100)
    .get();

  const recentRecoveries = recoveredSnap.docs
    .map((doc) => {
      const data = doc.data() as Partial<CameraHealthAlertDoc>;
      return {
        alertId: doc.id,
        locationId: finiteNumber(data.locationId),
        locationName:
          typeof data.locationName === 'string' ? data.locationName : '',
        storeNumber:
          typeof data.storeNumber === 'string' ? data.storeNumber : '',
        storeName: typeof data.storeName === 'string' ? data.storeName : '',
        support: typeof data.support === 'string' ? data.support : '',
        startedDate:
          typeof data.startedDate === 'string' ? data.startedDate : '',
        lastAnomalousDate:
          typeof data.lastAnomalousDate === 'string'
            ? data.lastAnomalousDate
            : '',
        recoveredDate:
          typeof data.recoveredDate === 'string' ? data.recoveredDate : '',
      };
    })
    .filter((row) => row.recoveredDate)
    .sort((a, b) => b.recoveredDate.localeCompare(a.recoveredDate))
    .slice(0, 20);

  const monitored = cameras.filter((camera) => camera.monitored);
  const latestDates = monitored
    .map((camera) => camera.latestDate)
    .filter(Boolean)
    .sort();
  const latestDate =
    latestDates.length > 0 ? latestDates[latestDates.length - 1]! : null;

  return {
    generatedAt: Date.now(),
    latestDate,
    summary: {
      monitored: monitored.length,
      normal: monitored.filter(
        (camera) =>
          camera.currentStatus === 'normal' && !camera.activeAlertId,
      ).length,
      activeAlerts: monitored.filter((camera) => Boolean(camera.activeAlertId))
        .length,
      outOfScope: cameras.filter((camera) => !camera.monitored).length,
    },
    cameras,
    refresh: {
      status: 'idle',
      stage: null,
      trigger: null,
      startedAt: null,
      startedByEmail: null,
      completedAt: null,
      cooldownUntil: null,
      lastManualCompletedAt: null,
      lastManualCompletedByEmail: null,
      lastAutomaticCompletedAt: null,
      lastError: null,
      canRefresh: false,
    },
    recentRecoveries,
  };
}
