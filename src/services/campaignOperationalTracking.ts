import {
  collection,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  addComment as addCommentPure,
  applyCheckChange,
  campaignKeyId,
  cancelTracking as cancelTrackingPure,
  initialTracking,
  markAllComplete,
  normalizeTracking,
  reactivateTracking as reactivateTrackingPure,
  setClassification,
  type TrackingActor,
} from '@/modules/operational-tracking/trackingFactory';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
} from '@/modules/operational-tracking/types';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import { campaignIdentity } from '@/modules/campaigns/campaignDiff';

/**
 * Persistencia del seguimiento operativo en Cloud Firestore.
 *
 * Colección independiente (`campaignOperationalTracking/{campaignId}`): la
 * importación del calendario nunca la borra ni sobrescribe checks manuales, y
 * esta colección nunca modifica la campaña importada. Las operaciones que tocan
 * más de un indicador (p. ej. marcar T Completos) usan transacción.
 */

const COLLECTION = 'campaignOperationalTracking';

/** Error de dominio: p. ej. desmarcar T Arranque con T Completos marcado. */
export class TrackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackingError';
  }
}

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

function trackingDocumentId(ref: {
  campaignId?: string;
  campaignNameKey: string;
}): string {
  return ref.campaignId ?? campaignKeyId(ref.campaignNameKey);
}

/** Lee todos los documentos de seguimiento. */
export async function listOperationalTracking(): Promise<
  CampaignOperationalTracking[]
> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  // Normaliza los documentos legacy (sin ciclo de vida) a `active` al leer.
  return snapshot.docs.map((d) =>
    normalizeTracking({
      id: d.id,
      ...(d.data() as Omit<CampaignOperationalTracking, 'id'>),
    }),
  );
}

export interface UpdateCheckParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  key: CheckKey;
  completed: boolean;
  /** Clasificación con la que crear el documento si aún no existe. */
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Marca/desmarca un indicador manual. Si el documento no existe todavía
 * (campaña migrada), lo crea con la clasificación indicada dentro de la misma
 * transacción antes de aplicar el cambio. Lanza `TrackingError` si la regla de
 * testigos lo impide.
 */
export async function updateCheck(
  params: UpdateCheckParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignId: params.campaignId,
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = normalizeTracking({
      id: documentId,
      ...base,
    });
    const result = applyCheckChange(
      current,
      params.key,
      params.completed,
      params.actor,
      now,
    );
    if (!result.ok) throw new TrackingError(result.reason);
    const { id: _id, ...data } = result.tracking;
    void _id;
    tx.set(ref, data);
    return result.tracking;
  });
}

export interface MarkAllChecksParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  /** Clasificación con la que crear el documento si aún no existe. */
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Marca todos los indicadores de una campaña (botón "Marcar todas"). Crea el
 * documento si no existe dentro de la misma transacción antes de marcar.
 */
export async function markAllChecks(
  params: MarkAllChecksParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignId: params.campaignId,
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = normalizeTracking({
      id: documentId,
      ...base,
    });
    const result = markAllComplete(current, params.actor, now);
    if (!result.ok) throw new TrackingError(result.reason);
    const { id: _id, ...data } = result.tracking;
    void _id;
    tx.set(ref, data);
    return result.tracking;
  });
}

export interface CancelTrackingParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  /** Motivo opcional; texto vacío se persiste como `null`. */
  reason: string;
  /** Clasificación con la que crear el documento si aún no existe. */
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Cancela una campaña (transición transaccional). Si no existe documento de
 * seguimiento lo crea con los defaults actuales dentro de la misma transacción y
 * después aplica la cancelación. Nunca modifica los checks, la clasificación ni
 * los comentarios.
 */
export async function cancelCampaignTracking(
  params: CancelTrackingParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? normalizeTracking({
          id: documentId,
          ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
        })
      : initialTracking(
          {
            campaignId: params.campaignId,
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const tracking = cancelTrackingPure(base, params.reason, params.actor, now);
    const { id: _id, ...data } = tracking;
    void _id;
    tx.set(ref, data);
    return tracking;
  });
}

export interface ReactivateTrackingParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  /** Clasificación con la que crear el documento si aún no existe. */
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Reactiva una campaña cancelada (transición transaccional): vuelve a `active` y
 * limpia el motivo. No modifica los checks: reaparecen con sus valores previos.
 */
export async function reactivateCampaignTracking(
  params: ReactivateTrackingParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? normalizeTracking({
          id: documentId,
          ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
        })
      : initialTracking(
          {
            campaignId: params.campaignId,
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const tracking = reactivateTrackingPure(base, params.actor, now);
    const { id: _id, ...data } = tracking;
    void _id;
    tx.set(ref, data);
    return tracking;
  });
}

export interface AddCommentParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  text: string;
  /** Clasificación con la que crear el documento si aún no existe. */
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Agrega un comentario a la bitácora de una campaña. Crea el documento si no
 * existe dentro de la misma transacción antes de agregar el comentario.
 */
export async function addComment(
  params: AddCommentParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignId: params.campaignId,
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = normalizeTracking({
      id: documentId,
      ...base,
    });
    const commentId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`;
    const tracking = addCommentPure(
      current,
      commentId,
      params.text,
      params.actor,
      now,
    );
    const { id: _id, ...data } = tracking;
    void _id;
    tx.set(ref, data);
    return tracking;
  });
}

export interface UpdateClassificationParams {
  campaignId?: string;
  campaignNameKey: string;
  campaignName: string;
  classification: Classification;
  linkValid: boolean;
  actor: TrackingActor;
}

/**
 * Fija o corrige la clasificación. Crea el documento si no existe (sin tocar
 * checks) o actualiza solo la clasificación conservando los checks existentes.
 */
export async function updateClassification(
  params: UpdateClassificationParams,
): Promise<CampaignOperationalTracking> {
  const database = db();
  const documentId = trackingDocumentId(params);
  const ref = doc(database, COLLECTION, documentId);
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    let tracking: CampaignOperationalTracking;
    if (snap.exists()) {
      const base: CampaignOperationalTracking = normalizeTracking({
        id: documentId,
        ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
      });
      tracking = setClassification(
        base,
        params.classification,
        'tracking-user',
        params.actor,
        now,
      );
    } else {
      tracking = initialTracking(
        {
          campaignId: params.campaignId,
          campaignNameKey: params.campaignNameKey,
          campaignName: params.campaignName,
          classification: params.classification,
          classificationSource: 'tracking-user',
          linkValid: params.linkValid,
        },
        params.actor,
        now,
      );
    }
    const { id: _id, ...data } = tracking;
    void _id;
    tx.set(ref, data);
    return tracking;
  });
}

export interface ImportClassificationSelection {
  campaignId: string;
  campaignNameKey: string;
  campaignName: string;
  classification: Classification;
  /** ¿El link del calendario es válido? Fija defaults al crear el documento. */
  linkValid: boolean;
  /** El usuario confirmó cambiar una clasificación ya existente. */
  confirmedReclassify: boolean;
}

/**
 * Inicializa el seguimiento durante la importación confirmada:
 * - crea el documento para campañas sin seguimiento (source `import-user`);
 * - actualiza la clasificación de una campaña existente **solo** si el usuario
 *   confirmó el cambio (nunca toca sus checks);
 * - nunca sobrescribe checks manuales ni borra seguimientos.
 * Devuelve cuántos se crearon y cuántos se reclasificaron.
 */
export async function initializeTrackingForImport(
  selections: readonly ImportClassificationSelection[],
  actor: TrackingActor,
): Promise<{ created: number; reclassified: number }> {
  const database = db();
  let created = 0;
  let reclassified = 0;

  for (const sel of selections) {
    const documentId = trackingDocumentId(sel);
    const ref = doc(database, COLLECTION, documentId);
    // Una transacción por campaña (verifica existencia sin sobrescribir).
    const outcome = await runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (!snap.exists()) {
        const tracking = initialTracking(
          {
            campaignId: sel.campaignId,
            campaignNameKey: sel.campaignNameKey,
            campaignName: sel.campaignName,
            classification: sel.classification,
            classificationSource: 'import-user',
            linkValid: sel.linkValid,
          },
          actor,
          now,
        );
        const { id: _id, ...data } = tracking;
        void _id;
        tx.set(ref, data);
        return 'created' as const;
      }
      // Normaliza el ciclo de vida (legacy → active) sin cambiarlo: la
      // importación nunca altera `lifecycleStatus` ni el motivo de cancelación.
      const base: CampaignOperationalTracking = normalizeTracking({
        id: documentId,
        ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
      });
      if (
        sel.confirmedReclassify &&
        base.classification !== sel.classification
      ) {
        const tracking = setClassification(
          base,
          sel.classification,
          'import-user',
          actor,
          now,
        );
        const { id: _id, ...data } = tracking;
        void _id;
        tx.set(ref, data);
        return 'reclassified' as const;
      }
      return 'skipped' as const;
    });
    if (outcome === 'created') created += 1;
    else if (outcome === 'reclassified') reclassified += 1;
  }

  return { created, reclassified };
}

/**
 * Copia seguimientos legacy, cuya llave era `campaignIdentity`, al `campaign.id`
 * estable. El documento anterior se conserva como historial (las reglas no
 * permiten borrarlo); todas las lecturas actuales priorizan `campaignId`.
 * Idempotente: nunca sobrescribe un seguimiento ya migrado.
 */
export async function migrateLegacyOperationalTracking(
  campaigns: readonly StoredCampaign[],
  tracking: readonly CampaignOperationalTracking[],
): Promise<number> {
  const database = db();
  const currentCampaignIds = new Set(
    tracking.filter((item) => item.campaignId).map((item) => item.campaignId!),
  );
  const legacyByIdentity = new Map<string, CampaignOperationalTracking>();
  for (const item of tracking) {
    if (!item.campaignId) legacyByIdentity.set(item.campaignNameKey, item);
  }

  const copies = campaigns
    .map((campaign) => ({
      campaign,
      legacy: legacyByIdentity.get(campaignIdentity(campaign)),
    }))
    .filter(
      (
        item,
      ): item is {
        campaign: StoredCampaign;
        legacy: CampaignOperationalTracking;
      } => Boolean(item.legacy) && !currentCampaignIds.has(item.campaign.id),
    );

  for (let i = 0; i < copies.length; i += 400) {
    const batch = writeBatch(database);
    for (const { campaign, legacy } of copies.slice(i, i + 400)) {
      const { id: _legacyId, ...data } = legacy;
      void _legacyId;
      batch.set(doc(database, COLLECTION, campaign.id), {
        ...data,
        campaignId: campaign.id,
        campaignName: campaign.name,
      });
    }
    await batch.commit();
  }
  return copies.length;
}
