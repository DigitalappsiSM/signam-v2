import { httpsCallable } from 'firebase/functions';
import type {
  QuividiCameraHealthOverview,
  QuividiCampaignReport,
  QuividiScopeOrigin,
} from '@/domain';
import { getFirebase } from './firebase';

interface CampaignReportResponse {
  report: QuividiCampaignReport;
  cached: boolean;
}

function functions() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.functions;
}

export async function getQuividiCampaignReport(
  campaignId: string,
  forceRefresh = false,
): Promise<CampaignReportResponse> {
  const callable = httpsCallable<
    { campaignId: string; forceRefresh: boolean },
    CampaignReportResponse
  >(functions(), 'quividi-campaignReport');
  const result = await callable({ campaignId, forceRefresh });
  return result.data;
}

export interface QuividiCampaignAvailability {
  campaignId: string;
  available: boolean;
  totalPairs: number;
  mappedPairs: number;
  scopeOrigins: QuividiScopeOrigin[];
}

export async function getQuividiCampaignAvailability(
  campaignIds: readonly string[],
): Promise<QuividiCampaignAvailability[]> {
  const callable = httpsCallable<
    { campaignIds: string[] },
    { items: QuividiCampaignAvailability[] }
  >(functions(), 'quividi-campaignAvailability');
  const items: QuividiCampaignAvailability[] = [];
  for (let index = 0; index < campaignIds.length; index += 200) {
    const batch = campaignIds.slice(index, index + 200);
    const result = await callable({ campaignIds: [...batch] });
    items.push(...result.data.items);
  }
  return items;
}

export interface QuividiLocationLookup {
  id: number;
  name: string;
  active: boolean;
  lastSeen: string | null;
}

export async function validateQuividiLocation(
  locationId: number,
): Promise<QuividiLocationLookup> {
  const callable = httpsCallable<
    { locationId: number },
    { location: QuividiLocationLookup }
  >(functions(), 'quividi-locationLookup');
  const result = await callable({ locationId });
  return result.data.location;
}

export interface QuividiHistoryOverview {
  networkId: number;
  started: boolean;
  queued: number;
  completed: number;
  inferred: number;
  needsReview: number;
  unsupported: number;
  retrying: number;
  stores: Array<{
    storeId: string;
    number: string;
    name: string;
    supports: string[];
  }>;
  locations: Array<{
    id: number;
    label: string;
    active: boolean;
    storeId: string | null;
    storeName: string;
    support: string;
    pointId: string | null;
    validFrom: string | null;
    firstMeasuredDate: string | null;
    hasPendingData: boolean;
  }>;
}

export async function getQuividiHistoryOverview(): Promise<QuividiHistoryOverview> {
  const callable = httpsCallable<Record<string, never>, QuividiHistoryOverview>(
    functions(),
    'quividi-historyOverview',
  );
  return (await callable({})).data;
}

export interface QuividiHistoryExplorerResult {
  startDate: string;
  endDate: string;
  summary: {
    partitions: number;
    complete: number;
    retrying: number;
    unsupported: number;
    empty: number;
    sourceRows: number;
    locations: number;
    truncatedPartitions: boolean;
  };
  partitions: Array<{
    id: string;
    date: string;
    locationId: number;
    type: string;
    resolution: string;
    status: string;
    rowCount: number;
    storeId: string | null;
    support: string | null;
    mappingStatus: string | null;
    currentHash: string | null;
    updatedAt: number | null;
  }>;
  rows: Array<Record<string, unknown>>;
  columns: string[];
  truncatedRows: boolean;
  filters: {
    types: string[];
    resolutions: string[];
    stores: Array<{ storeId: string; storeName: string }>;
    supports: string[];
  };
}

export async function exploreQuividiHistory(input: {
  startDate: string;
  endDate: string;
  locationId?: number;
  type?: string;
  resolution?: string;
  storeId?: string;
  support?: string;
  status?: string;
}): Promise<QuividiHistoryExplorerResult> {
  const callable = httpsCallable<typeof input, QuividiHistoryExplorerResult>(
    functions(),
    'quividi-historyExplore',
    { timeout: 540_000 },
  );
  return (await callable(input)).data;
}

export async function startQuividiHistory(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, unknown>(
    functions(),
    'quividi-historyStart',
    { timeout: 540_000 },
  );
  await callable({});
}

export async function assignQuividiHistoryBinding(input: {
  locationId: number;
  storeId: string;
  storeName: string;
  support: string;
  pointId: string | null;
  validFrom: string;
  validTo: string | null;
}): Promise<void> {
  const callable = httpsCallable<typeof input, unknown>(
    functions(),
    'quividi-historyAssignBinding',
  );
  await callable(input);
}

export async function getQuividiCameraHealthOverview(): Promise<QuividiCameraHealthOverview> {
  const callable = httpsCallable<
    Record<string, never>,
    QuividiCameraHealthOverview
  >(functions(), 'quividi-cameraHealthOverview');
  const result = await callable({});
  return result.data;
}

export async function createQuividiCameraHealthTicket(
  locationId: number,
): Promise<{ ticketId: number }> {
  const callable = httpsCallable<{ locationId: number }, { ticketId: number }>(
    functions(),
    'quividi-createCameraHealthTicket',
  );
  const result = await callable({ locationId });
  return result.data;
}

export interface QuividiCameraHealthRefreshResult {
  endDate: string;
  written: number;
  alerts: {
    evaluated: number;
    normal: number;
    active: number;
    created: number;
    updated: number;
    recovered: number;
    retired: number;
  };
  ticketSync: {
    created: number;
    recovered: number;
    errors: number;
  };
  completedAt: number;
}

export async function refreshQuividiCameraHealth(): Promise<QuividiCameraHealthRefreshResult> {
  const callable = httpsCallable<
    Record<string, never>,
    QuividiCameraHealthRefreshResult
  >(functions(), 'quividi-cameraHealthRefresh', { timeout: 540_000 });
  const result = await callable({});
  return result.data;
}
