import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  addComment as addCommentPure,
  applyCheckChange,
  campaignKeyId,
  initialTracking,
  markAllComplete,
  setClassification,
  type TrackingActor,
} from '@/modules/operational-tracking/trackingFactory';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
} from '@/modules/operational-tracking/types';

/**
 * Persistencia del seguimiento operativo en Cloud Firestore.
 *
 * Colección independiente (`campaignOperationalTracking/{campaignKeyId}`): la
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

/** Lee todos los documentos de seguimiento. */
export async function listOperationalTracking(): Promise<
  CampaignOperationalTracking[]
> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<CampaignOperationalTracking, 'id'>),
  }));
}

export interface UpdateCheckParams {
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
  const ref = doc(database, COLLECTION, campaignKeyId(params.campaignNameKey));
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = {
      id: campaignKeyId(params.campaignNameKey),
      ...base,
    };
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
  const ref = doc(database, COLLECTION, campaignKeyId(params.campaignNameKey));
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = {
      id: campaignKeyId(params.campaignNameKey),
      ...base,
    };
    const tracking = markAllComplete(current, params.actor, now);
    const { id: _id, ...data } = tracking;
    void _id;
    tx.set(ref, data);
    return tracking;
  });
}

export interface AddCommentParams {
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
  const ref = doc(database, COLLECTION, campaignKeyId(params.campaignNameKey));
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const base = snap.exists()
      ? (snap.data() as Omit<CampaignOperationalTracking, 'id'>)
      : initialTracking(
          {
            campaignNameKey: params.campaignNameKey,
            campaignName: params.campaignName,
            classification: params.classification,
            classificationSource: 'import-user',
            linkValid: params.linkValid,
          },
          params.actor,
          now,
        );
    const current: CampaignOperationalTracking = {
      id: campaignKeyId(params.campaignNameKey),
      ...base,
    };
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
  const ref = doc(database, COLLECTION, campaignKeyId(params.campaignNameKey));
  return runTransaction(database, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    let tracking: CampaignOperationalTracking;
    if (snap.exists()) {
      const base: CampaignOperationalTracking = {
        id: campaignKeyId(params.campaignNameKey),
        ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
      };
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
    const ref = doc(database, COLLECTION, campaignKeyId(sel.campaignNameKey));
    // Una transacción por campaña (verifica existencia sin sobrescribir).
    const outcome = await runTransaction(database, async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      if (!snap.exists()) {
        const tracking = initialTracking(
          {
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
      const base: CampaignOperationalTracking = {
        id: campaignKeyId(sel.campaignNameKey),
        ...(snap.data() as Omit<CampaignOperationalTracking, 'id'>),
      };
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
