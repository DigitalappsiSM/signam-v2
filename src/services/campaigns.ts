import {
  collection,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
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
import {
  campaignCorrectionError,
  correctionChanges,
  correctionComment,
  type CampaignCorrectionEvent,
  type CampaignCorrectionValues,
  type CampaignManualOverrides,
} from '@/modules/campaigns/campaignCorrection';
import type {
  ImportDateCorrection,
  ImportDateCorrections,
} from '@/modules/liverpool-import/importDateCorrection';

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

export interface CorrectCampaignParams {
  campaignId: string;
  values: CampaignCorrectionValues;
  reason: string;
  actor: Actor;
}

/**
 * Corrige campos escalares y registra el evento en la subcolección append-only
 * dentro de la misma transacción. Las correcciones quedan como overrides para
 * que una reimportación no restaure silenciosamente el dato erróneo.
 */
export async function correctCampaign({
  campaignId,
  values,
  reason,
  actor,
}: CorrectCampaignParams): Promise<{
  campaign: StoredCampaign;
  event: CampaignCorrectionEvent;
}> {
  const database = db();
  const campaignRef = doc(database, COLLECTION, campaignId);
  const correctionRef = doc(
    collection(database, COLLECTION, campaignId, 'corrections'),
  );

  return runTransaction(database, async (tx) => {
    const snapshot = await tx.get(campaignRef);
    if (!snapshot.exists()) throw new Error('La campaña ya no existe.');
    const current: StoredCampaign = {
      id: campaignId,
      ...(snapshot.data() as Omit<StoredCampaign, 'id'>),
    };
    const validation = campaignCorrectionError(current, values, reason);
    if (validation) throw new Error(validation);

    const now = Date.now();
    const changes = correctionChanges(current, values);
    const next = { ...current, ...values };
    const manualOverrides: CampaignManualOverrides = {
      ...(current.manualOverrides ?? {}),
    };
    for (const change of changes) {
      manualOverrides[change.field] = {
        value: change.after,
        reason: reason.trim(),
        correctedAt: now,
        correctedByUid: actor.uid,
        correctedByEmail: actor.email,
      };
    }
    const event: CampaignCorrectionEvent = {
      id: correctionRef.id,
      campaignId,
      campaignName: current.name,
      changes,
      reason: reason.trim(),
      comment: correctionComment(changes, reason, actor.email, now),
      actorUid: actor.uid,
      actorEmail: actor.email,
      at: now,
    };
    const { id: _campaignId, ...campaignData } = next;
    void _campaignId;
    tx.set(
      campaignRef,
      {
        ...campaignData,
        signature: campaignSignature(next),
        manualOverrides,
        updatedAt: now,
        updatedBy: actor.email,
      },
      { merge: true },
    );
    const { id: _eventId, ...eventData } = event;
    void _eventId;
    tx.set(correctionRef, eventData);

    return {
      campaign: {
        ...next,
        signature: campaignSignature(next),
        manualOverrides,
        updatedAt: now,
        updatedBy: actor.email,
      },
      event,
    };
  });
}

/** Historial inmutable de correcciones de una campaña, más reciente primero. */
export async function listCampaignCorrections(
  campaignId: string,
): Promise<CampaignCorrectionEvent[]> {
  const snapshot = await getDocs(
    collection(db(), COLLECTION, campaignId, 'corrections'),
  );
  return snapshot.docs
    .map((item) => ({
      id: item.id,
      ...(item.data() as Omit<CampaignCorrectionEvent, 'id'>),
    }))
    .sort((a, b) => b.at - a.at);
}

function campaignDoc(
  campaign: ParsedCampaign,
  actor: Actor,
  now: number,
  manualOverrides?: CampaignManualOverrides,
) {
  const base = {
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
  return manualOverrides && Object.keys(manualOverrides).length > 0
    ? { ...base, manualOverrides }
    : base;
}

/**
 * Traduce las correcciones de fecha capturadas durante la importación en los
 * `manualOverrides` y el evento auditable de cada alta afectada. Reutiliza las
 * mismas funciones de dominio que `correctCampaign` para que una corrección de
 * importación quede idéntica a una hecha desde Campañas.
 */
interface CorrectionWrite {
  manualOverrides: CampaignManualOverrides;
  event: CampaignCorrectionEvent;
  eventRef: ReturnType<typeof doc>;
}

function buildImportCorrectionWrite(
  database: ReturnType<typeof db>,
  campaignId: string,
  campaign: ParsedCampaign,
  correction: ImportDateCorrection,
  actor: Actor,
  now: number,
): CorrectionWrite | null {
  const before: ParsedCampaign = {
    ...campaign,
    fechaInicio: correction.before.fechaInicio,
    fechaFin: correction.before.fechaFin,
  };
  const values: CampaignCorrectionValues = {
    fechaInicio: correction.fechaInicio,
    fechaFin: correction.fechaFin,
  };
  const changes = correctionChanges(before, values);
  if (changes.length === 0) return null;
  const reason = correction.reason.trim();
  const manualOverrides: CampaignManualOverrides = {};
  for (const change of changes) {
    manualOverrides[change.field] = {
      value: change.after,
      reason,
      correctedAt: now,
      correctedByUid: actor.uid,
      correctedByEmail: actor.email,
    };
  }
  const eventRef = doc(
    collection(database, COLLECTION, campaignId, 'corrections'),
  );
  const event: CampaignCorrectionEvent = {
    id: eventRef.id,
    campaignId,
    campaignName: campaign.name,
    changes,
    reason,
    comment: correctionComment(changes, reason, actor.email, now),
    actorUid: actor.uid,
    actorEmail: actor.email,
    at: now,
  };
  return { manualOverrides, event, eventRef };
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
  importCorrections?: ImportDateCorrections,
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

  // Correcciones de fecha capturadas durante la importación: solo aplican a
  // altas (las modificaciones de campañas existentes se corrigen desde
  // Campañas). Cada una escribe `manualOverrides` en el alta y un evento en su
  // bitácora `corrections`, en el mismo lote atómico que la creación.
  const correctionWrites = new Map<string, CorrectionWrite>();
  if (importCorrections && importCorrections.size > 0) {
    for (const op of ops) {
      if (op.kind !== 'set' || op.createdAt == null) continue;
      const correction = importCorrections.get(op.campaign.row);
      if (!correction) continue;
      const write = buildImportCorrectionWrite(
        database,
        op.id,
        op.campaign,
        correction,
        actor,
        now,
      );
      if (write) correctionWrites.set(op.id, write);
    }
  }

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
      const correction = correctionWrites.get(op.id);
      const data = campaignDoc(
        op.campaign,
        actor,
        now,
        correction?.manualOverrides,
      );
      batch.set(
        ref,
        op.createdAt ? { ...data, createdAt: op.createdAt } : data,
        { merge: true },
      );
      if (correction) {
        const { id: _eventId, ...eventData } = correction.event;
        void _eventId;
        batch.set(correction.eventRef, eventData);
      }
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
