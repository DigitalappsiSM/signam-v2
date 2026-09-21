export type QuividiCameraOperationalHealth =
  | 'normal'
  | 'no_measurement'
  | 'partial_measurement'
  | 'no_ots';

export type QuividiCameraHealthSeverity =
  | 'none'
  | 'medium'
  | 'high'
  | 'critical';

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
  recentRecoveries: QuividiCameraRecovery[];
}
