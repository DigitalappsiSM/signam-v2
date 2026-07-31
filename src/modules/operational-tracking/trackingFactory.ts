import { campaignKeyId } from '@/modules/campaigns/ekon';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
  ClassificationSource,
  OperationalCheck,
} from './types';

/**
 * Construcción y transición puras del documento de seguimiento operativo.
 *
 * Reutiliza `campaignKeyId` (mismo algoritmo determinístico que la asociación
 * Ekon) para derivar el id desde el `nameKey`. Toda la lógica de reglas de
 * negocio de los checks (Validación Liverpool inicial, relación T Arranque / T
 * Completos, limpieza al desmarcar) vive aquí, sin Firestore ni UI.
 */

export interface TrackingActor {
  uid: string;
  email: string;
}

export { campaignKeyId };

function makeCheck(
  completed: boolean,
  source: 'automatic' | 'manual',
  actor: TrackingActor,
  now: number,
): OperationalCheck {
  return {
    completed,
    completedAt: completed ? now : null,
    completedByUid: completed ? actor.uid : null,
    completedByEmail: completed ? actor.email : null,
    source,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}

export interface InitialTrackingParams {
  campaignNameKey: string;
  campaignName: string;
  classification: Classification;
  classificationSource: ClassificationSource;
  /** ¿El link del calendario es una URL válida? Fija los valores por defecto. */
  linkValid: boolean;
}

/**
 * Documento inicial de seguimiento (todos los checks con `source: automatic`):
 * - **Link de descarga**: marcado si el link del calendario es válido.
 * - **Validación Liverpool**: marcada si es Institucional **o** hay link válido.
 * - **Programación CSM / T Arranque / T Completos**: desmarcados.
 */
export function initialTracking(
  params: InitialTrackingParams,
  actor: TrackingActor,
  now: number,
): CampaignOperationalTracking {
  const institutional = params.classification === 'institutional';
  const validationDefault = institutional || params.linkValid;
  return {
    id: campaignKeyId(params.campaignNameKey),
    campaignNameKey: params.campaignNameKey,
    campaignName: params.campaignName,
    classification: params.classification,
    classificationSource: params.classificationSource,
    classificationUpdatedAt: now,
    classificationUpdatedByUid: actor.uid,
    classificationUpdatedByEmail: actor.email,
    linkDownload: makeCheck(params.linkValid, 'automatic', actor, now),
    liverpoolValidation: makeCheck(validationDefault, 'automatic', actor, now),
    csmProgramming: makeCheck(false, 'automatic', actor, now),
    witnessStart: makeCheck(false, 'automatic', actor, now),
    witnessComplete: makeCheck(false, 'automatic', actor, now),
    createdAt: now,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}

export type CheckChangeResult =
  | { ok: true; tracking: CampaignOperationalTracking }
  | { ok: false; reason: string };

/**
 * Aplica un cambio manual a un indicador y devuelve el nuevo documento (puro).
 *
 * Reglas de testigos:
 * - Marcar T Completos también marca T Arranque si estaba pendiente (misma
 *   operación, mismo usuario y fecha).
 * - No se puede desmarcar T Arranque mientras T Completos siga marcado.
 */
export function applyCheckChange(
  tracking: CampaignOperationalTracking,
  key: CheckKey,
  completed: boolean,
  actor: TrackingActor,
  now: number,
): CheckChangeResult {
  if (
    key === 'witnessStart' &&
    !completed &&
    tracking.witnessComplete.completed
  ) {
    return {
      ok: false,
      reason:
        'Para desmarcar “T Arranque” primero desmarca “T Completos”: mientras los testigos completos estén confirmados, el arranque no puede quedar pendiente.',
    };
  }

  let next: CampaignOperationalTracking = {
    ...tracking,
    [key]: makeCheck(completed, 'manual', actor, now),
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };

  // Marcar T Completos arrastra T Arranque si estaba pendiente.
  if (
    key === 'witnessComplete' &&
    completed &&
    !tracking.witnessStart.completed
  ) {
    next = {
      ...next,
      witnessStart: makeCheck(true, 'manual', actor, now),
    };
  }

  return { ok: true, tracking: next };
}

/**
 * Cambia la clasificación conservando los checks (nunca los sobrescribe). Se usa
 * cuando un usuario corrige la clasificación de forma consciente.
 */
export function setClassification(
  tracking: CampaignOperationalTracking,
  classification: Classification,
  source: ClassificationSource,
  actor: TrackingActor,
  now: number,
): CampaignOperationalTracking {
  return {
    ...tracking,
    classification,
    classificationSource: source,
    classificationUpdatedAt: now,
    classificationUpdatedByUid: actor.uid,
    classificationUpdatedByEmail: actor.email,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}
