export const DIGITAL_SOURCE_SCHEMA = 'ekon-campaign-tracking-v1' as const;
export const DIGITAL_SCHEMA_VERSION = 1;

export type PlacementMode = 'fixation' | 'continuous';
export type DigitalImportStatus =
  | 'analyzing'
  | 'pending-scope'
  | 'pending-resolutions'
  | 'processing'
  | 'completed'
  | 'failed';
export type DigitalDiffState =
  | 'nueva'
  | 'sin-cambios'
  | 'modificada'
  | 'no-incluida'
  | 'restaurada'
  | 'conflicto';
export type DigitalCheckKey =
  'downloadLink' | 'retailerValidation' | 'cmsProgramming';

export interface DigitalSupportProfile {
  id: string;
  retailerCode: string;
  retailerLabel: string;
  retailerAliases: string[];
  supportCode: string;
  supportLabel: string;
  articleAliases: string[];
  sourceSchema: typeof DIGITAL_SOURCE_SCHEMA;
  periodicity: 'fortnight';
  cmsName: string | null;
  trackingTemplate: 'external-cms-basic';
  fixationTypeMap: Record<string, PlacementMode>;
  active: boolean;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}

export interface DigitalPlacementRow {
  id: string;
  recordKey: string;
  logicalFlightKey: string;
  batchId: string;
  sourceRow: number;
  year: string;
  retailerCode: string;
  supportCode: string;
  profileId: string;
  campaignNumber: string;
  lineNumber: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  fixationStart: string;
  fixationEnd: string;
  placementMode: PlacementMode;
  client: string;
  advertiser: string;
  product: string;
  creativityId: string;
  creativityTitle: string;
  creativityStatus: string;
  centers: number | null;
  supports: number | null;
  sourceFields: Record<string, string | number | boolean | null>;
  sourceHeaders: string[];
  fingerprint: string;
  active: boolean;
  firstBatchId: string;
  lastBatchId: string;
  missingSinceBatchId: string | null;
  revision: number;
  updatedAt: number;
}

export interface DigitalOperationalItem {
  id: string;
  operationalKey: string;
  logicalFlightKey: string;
  source: 'ekon-campaign-tracking';
  retailerCode: string;
  retailerLabel: string;
  supportCode: string;
  supportLabel: string;
  cmsName: string | null;
  campaignNumber: string;
  periodId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  fixationStart: string;
  fixationEnd: string;
  placementMode: PlacementMode;
  client: string;
  advertiser: string;
  product: string;
  creativityId: string;
  creativityTitle: string;
  creativityStatus: string;
  centers: number;
  supports: number;
  placementRowIds: string[];
  active: boolean;
  firstBatchId: string;
  lastBatchId: string;
  updatedAt: number;
}

export interface DigitalCheck {
  completed: boolean;
  source: 'automatic' | 'manual';
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}
export interface DigitalOperationalTracking {
  id: string;
  operationalItemId: string;
  lifecycleStatus: 'active' | 'cancelled';
  cancellationReason: string | null;
  checks: Record<DigitalCheckKey, DigitalCheck>;
  comments: Array<{
    id: string;
    text: string;
    createdAt: number;
    createdByUid: string;
    createdByEmail: string;
  }>;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}

export interface DigitalImportBatch {
  id: string;
  sourceSchema: typeof DIGITAL_SOURCE_SCHEMA;
  fileName: string;
  fileSize: number;
  storagePath: string;
  contentHash: string;
  resolutionHash: string;
  status: DigitalImportStatus;
  detectedPeriods: Array<{
    periodId: string;
    startDate: string;
    endDate: string;
  }>;
  confirmedPeriodIds: string[];
  catalogProfileIds: string[];
  totals: {
    sourceRows: number;
    inScopeRows: number;
    ignoredByCatalog: number;
    validRows: number;
    rejectedRows: number;
    exactDuplicateGroups: number;
    logicalConflictGroups: number;
    operationalItems: number;
  };
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  completedAt: number | null;
  schemaVersion: number;
}

export interface DigitalIssue {
  sourceRow: number;
  code: string;
  message: string;
  blocking: boolean;
}
export type DuplicateAction =
  'keep-one' | 'keep-all' | 'exclude-all' | 'cancel';
export type ConflictAction =
  'choose-primary' | 'keep-selected' | 'exclude-selected' | 'cancel';
export interface DigitalConflictGroup {
  id: string;
  kind: 'exact-duplicate' | 'logical-conflict';
  rowIndexes: number[];
  differentFields: string[];
  confirmed: boolean;
  action?: DuplicateAction | ConflictAction;
  acceptedRowIndexes?: number[];
}
export interface DigitalImportResolution extends DigitalConflictGroup {
  batchId: string;
  excludedRowIndexes: number[];
  comparedValues: Record<string, unknown[]>;
  resolvedAt: number;
  resolvedByUid: string;
  resolvedByEmail: string;
}

export interface Actor {
  uid: string;
  email: string;
}
