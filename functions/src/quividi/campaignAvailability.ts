import type { Firestore } from 'firebase-admin/firestore';
import {
  buildEffectiveScopeContext,
  buildEffectiveSupportPairs,
  type CampaignDoc,
  type EffectiveScopeOrigin,
  type EkonAssignmentDoc,
  type ScreenDoc,
} from './effectiveScope';

export interface CampaignAvailabilityItem {
  campaignId: string;
  available: boolean;
  totalPairs: number;
  mappedPairs: number;
  scopeOrigins: EffectiveScopeOrigin[];
}

/** Lecturas agrupadas e índices compartidos; máximo ocho campañas concurrentes. */
export async function loadCampaignAvailability(
  db: Firestore,
  campaignIds: readonly string[],
): Promise<CampaignAvailabilityItem[]> {
  if (campaignIds.length === 0) return [];
  const [screensSnap, campaignSnaps] = await Promise.all([
    db.collection('screens').get(),
    db.getAll(...campaignIds.map((id) => db.collection('campaigns').doc(id))),
  ]);
  const screens = screensSnap.docs.map((doc) => doc.data() as ScreenDoc);
  const campaigns = campaignSnaps.filter((snap) => snap.exists);
  const context = buildEffectiveScopeContext(screens);
  // Solo las campañas que requieren fallback pagan la lectura de enlaces.
  const needsLink = campaigns.filter((snap) => {
    const data = snap.data() as CampaignDoc;
    return data.supports?.some(
      (s) =>
        (s.stores?.length ?? 0) === 0 &&
        s.scope !== 'invalid' &&
        s.scopeSource !== 'comment-explicit-all' &&
        s.scopeSource !== 'resolution-all' &&
        !['VIDEO WALL CRIUS', 'VIDEO WALL POSTER LED'].includes(
          (s.support ?? '').trim().replace(/\s+/g, ' ').toUpperCase(),
        ),
    );
  });
  const exactLinks =
    needsLink.length > 0
      ? await db.getAll(
          ...needsLink.map((snap) =>
            db.collection('campaignEkonLinks').doc(snap.id),
          ),
        )
      : [];
  const exactNumbers = new Map<string, number>();
  for (const snap of exactLinks) {
    const number = snap.data()?.ekonCampaignNumber;
    if (typeof number === 'number' && Number.isFinite(number))
      exactNumbers.set(snap.id, number);
  }
  const legacyRequests = new Map<string, Promise<number | null>>();
  context.ekonNumber = async (id, campaign) => {
    const exact = exactNumbers.get(id);
    if (exact !== undefined) return exact;
    const key = campaign.nameKey?.trim();
    if (!key) return null;
    let request = legacyRequests.get(key);
    if (!request) {
      request = db
        .collection('campaignEkonLinks')
        .where('campaignNameKey', '==', key)
        .limit(1)
        .get()
        .then((snap) => {
          const number = snap.docs[0]?.data()?.ekonCampaignNumber;
          return typeof number === 'number' && Number.isFinite(number)
            ? number
            : null;
        });
      legacyRequests.set(key, request);
    }
    return request;
  };
  const assignmentCache = new Map<number, EkonAssignmentDoc[]>();
  const items: CampaignAvailabilityItem[] = [];
  for (let offset = 0; offset < campaigns.length; offset += 8) {
    const chunk = await Promise.all(
      campaigns.slice(offset, offset + 8).map(async (snap) => {
        const effective = await buildEffectiveSupportPairs(
          db,
          snap.id,
          snap.data() as CampaignDoc,
          screens,
          assignmentCache,
          context,
        );
        const mappedPairs = effective.pairs.filter(
          (pair) => pair.cameraNames.length > 0,
        ).length;
        return {
          campaignId: snap.id,
          available: mappedPairs > 0,
          totalPairs: effective.pairs.length,
          mappedPairs,
          scopeOrigins: effective.origins,
        };
      }),
    );
    items.push(...chunk);
  }
  return items;
}
