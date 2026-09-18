import { httpsCallable } from 'firebase/functions';
import { getFirebase } from './firebase';
import type {
  QuividiDailyCameraMetrics,
  QuividiSupportMapping,
} from '@/modules/quividi/audience';

export interface QuividiCampaignSnapshot {
  campaignId: string;
  campaignName: string;
  startDate: string;
  endDate: string;
  mappings: QuividiSupportMapping[];
  uncovered: Array<{
    storeNumber: string;
    storeName: string;
    support: string;
  }>;
  cameraDays: QuividiDailyCameraMetrics[];
  generatedAt: number;
  schemaVersion?: number;
}

export async function getQuividiCampaignAudience(
  campaignId: string,
): Promise<QuividiCampaignSnapshot> {
  const firebase = getFirebase();
  if (!firebase) throw new Error('Firebase no está configurado.');
  const call = httpsCallable<
    { campaignId: string },
    QuividiCampaignSnapshot
  >(firebase.functions, 'quividi-getCampaignAudience');
  const response = await call({ campaignId });
  return response.data;
}
