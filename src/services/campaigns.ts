import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  campaignKey,
  campaignSignature,
  type CampaignDiff,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

/**
 * Persistencia de campañas del calendario en Cloud Firestore.
 *
 * Solo se escriben los cambios aceptados por el usuario (altas, modificaciones y
 * bajas). Si no hay cambios, no se reescribe nada.
 */

const COLLECTION = 'campaigns';
const BATCH_LIMIT = 400;

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee todas las campañas guardadas. */
export async function listCampaigns(): Promise<StoredCampaign[]> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<StoredCampaign, 'id'>),
  }));
}

function campaignDoc(campaign: ParsedCampaign, actor: Actor, now: number) {
  return {
    ...campaign,
    nameKey: campaignKey(campaign.name),
    signature: campaignSignature(campaign),
    updatedAt: now,
    updatedBy: actor.email,
  };
}

export interface ApplyResult {
  added: number;
  modified: number;
  removed: number;
}

/**
 * Aplica los cambios de un diff previamente confirmado: altas, modificaciones y
 * bajas. Devuelve los conteos aplicados.
 */
export async function applyCampaignChanges(
  diff: CampaignDiff,
  actor: Actor,
): Promise<ApplyResult> {
  const database = db();
  const now = Date.now();

  type Op =
    | { kind: 'set'; id?: string; campaign: ParsedCampaign; createdAt?: number }
    | { kind: 'delete'; id: string };

  const ops: Op[] = [
    ...diff.added.map((campaign) => ({
      kind: 'set' as const,
      campaign,
      createdAt: now,
    })),
    ...diff.modified.map((m) => ({
      kind: 'set' as const,
      id: m.stored.id,
      campaign: m.campaign,
    })),
    ...diff.removed.map((r) => ({ kind: 'delete' as const, id: r.id })),
  ];

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === 'delete') {
        batch.delete(doc(database, COLLECTION, op.id));
        continue;
      }
      const ref = op.id
        ? doc(database, COLLECTION, op.id)
        : doc(collection(database, COLLECTION));
      const data = campaignDoc(op.campaign, actor, now);
      batch.set(
        ref,
        op.createdAt ? { ...data, createdAt: op.createdAt } : data,
        { merge: true },
      );
    }
    await batch.commit();
  }

  return {
    added: diff.added.length,
    modified: diff.modified.length,
    removed: diff.removed.length,
  };
}
