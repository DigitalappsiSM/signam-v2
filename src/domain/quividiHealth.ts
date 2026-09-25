export type QuividiCameraOperationalHealth =
  'normal' | 'no_measurement' | 'partial_measurement' | 'no_ots';

export type QuividiCameraHealthSeverity =
  'none' | 'medium' | 'high' | 'critical';

export interface QuividiCameraHealthRow {
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  monitored: boolean;
  currentStatus: QuividiCameraOperationalHealth;
  severity: QuividiCameraHealthSeverity;
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

export interface QuividiCameraRecovery {
  alertId: string;
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  startedDate: string;
  lastAnomalousDate: string;
  recoveredDate: string;
}

export type QuividiCameraHealthRefreshStage =
  | 'connecting'
  | 'syncing_catalog'
  | 'analyzing'
  | 'reconciling_alerts'
  | 'syncing_odoo'
  | 'completed'
  | 'error';

export interface QuividiCameraHealthRefresh {
  status: 'idle' | 'running' | 'success' | 'error';
  stage: QuividiCameraHealthRefreshStage | null;
  trigger: 'manual' | 'automatic' | null;
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

export interface QuividiCameraHealthOverview {
  generatedAt: number;
  latestDate: string | null;
  summary: {
    monitored: number;
    normal: number;
    activeAlerts: number;
    outOfScope: number;
  };
  cameras: QuividiCameraHealthRow[];
  refresh: QuividiCameraHealthRefresh;
  recentRecoveries: QuividiCameraRecovery[];
}
