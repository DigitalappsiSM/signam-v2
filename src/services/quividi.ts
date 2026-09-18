import { httpsCallable } from 'firebase/functions';
import type { QuividiCampaignReport } from '@/domain';
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
