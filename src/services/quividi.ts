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

export async function getQuividiCameraHealthOverview(): Promise<QuividiCameraHealthOverview> {
  const callable = httpsCallable<
    Record<string, never>,
    QuividiCameraHealthOverview
  >(functions(), 'quividi-cameraHealthOverview');
  const result = await callable({});
  return result.data;
}
