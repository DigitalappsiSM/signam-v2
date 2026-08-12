import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  campaignKey,
  campaignIdentity,
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

/** Lee las campañas guardadas. Por defecto omite las bajas lógicas. */
export async function listCampaigns(options?: {
  includeInactive?: boolean;
}): Promise<StoredCampaign[]> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  const campaigns = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<StoredCampaign, 'id'>),
  }));
  return options?.includeInactive
    ? campaigns
    : campaigns.filter((campaign) => campaign.active !== false);
}

function campaignDoc(campaign: ParsedCampaign, actor: Actor, now: number) {
  return {
    ...campaign,
    // `nameKey` = nombre normalizado (llave estable de Ekon y del CSV). La
    // separación de "flights" homónimos ocurre en Seguimiento vía la identidad
    // por todos los datos (`campaignIdentity`), no aquí.
    nameKey: campaignKey(campaign.name),
    signature: campaignSignature(campaign),
    active: true,
    deactivatedAt: null,
    deactivatedBy: null,
    updatedAt: now,
    updatedBy: actor.email,
  };
}

export interface ApplyResult {
  added: number;
  modified: number;
  removed: number;
  /** IDs canónicos asignados a las altas de esta importación. */
  addedCampaignIds: Record<string, string>;
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
    | { kind: 'set'; id: string; campaign: ParsedCampaign; createdAt?: number }
    | { kind: 'deactivate'; campaign: StoredCampaign };

  const ops: Op[] = [
    ...diff.added.map((campaign) => ({
      kind: 'set' as const,
      id: doc(collection(database, COLLECTION)).id,
      campaign,
      createdAt: now,
    })),
    ...diff.modified.map((m) => ({
      kind: 'set' as const,
      id: m.stored.id,
      campaign: m.campaign,
    })),
    ...diff.removed.map((campaign) => ({
      kind: 'deactivate' as const,
      campaign,
    })),
  ];

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === 'deactivate') {
        batch.set(
          doc(database, COLLECTION, op.campaign.id),
          {
            active: false,
            deactivatedAt: now,
            deactivatedBy: actor.email,
            updatedAt: now,
            updatedBy: actor.email,
          },
          { merge: true },
        );
        continue;
      }
      const ref = doc(database, COLLECTION, op.id);
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
    addedCampaignIds: Object.fromEntries(
      ops
        .filter(
          (op): op is Extract<Op, { kind: 'set' }> =>
            op.kind === 'set' && op.createdAt != null,
        )
        .map((op) => [campaignIdentity(op.campaign), op.id]),
    ),
  };
}
