import { campaignKeyId } from '@/modules/campaigns/ekon';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
  ClassificationSource,
  OperationalCheck,
  OperationalComment,
  TrackingLifecycleStatus,
} from './types';

/**
 * Mensaje de dominio cuando se intenta editar los testigos de una campaña
 * cancelada. La reactivación es la única vía para volver a editar los checks.
 */
export const CANCELLED_CHECK_MESSAGE =
  'La campaña está cancelada: reactívala para volver a editar sus indicadores.';

/**
 * Construcción y transición puras del documento de seguimiento operativo.
 *
 * Los documentos actuales usan el `campaignId` canónico. `campaignKeyId` se
 * conserva únicamente para compatibilidad con documentos legacy. Toda la lógica
 * de reglas de negocio vive aquí, sin Firestore ni UI.
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
  campaignId?: string;
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
    id: params.campaignId ?? campaignKeyId(params.campaignNameKey),
    campaignId: params.campaignId,
    campaignNameKey: params.campaignNameKey,
    campaignName: params.campaignName,
    classification: params.classification,
    classificationSource: params.classificationSource,
    classificationUpdatedAt: now,
    classificationUpdatedByUid: actor.uid,
    classificationUpdatedByEmail: actor.email,
    lifecycleStatus: 'active',
    lifecycleUpdatedAt: now,
    lifecycleUpdatedByUid: actor.uid,
    lifecycleUpdatedByEmail: actor.email,
    cancellationReason: null,
    linkDownload: makeCheck(params.linkValid, 'automatic', actor, now),
    liverpoolValidation: makeCheck(validationDefault, 'automatic', actor, now),
    csmProgramming: makeCheck(false, 'automatic', actor, now),
    witnessStart: makeCheck(false, 'automatic', actor, now),
    witnessComplete: makeCheck(false, 'automatic', actor, now),
    comments: [],
    createdAt: now,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}

/**
 * Rellena los campos de ciclo de vida ausentes en documentos **legacy** (los
 * creados antes de esta funcionalidad). Un documento sin `lifecycleStatus` se
 * interpreta como `active`; los metadatos de transición faltantes se derivan de
 * la creación y `cancellationReason` ausente se normaliza a `null`. Es idempotente
 * y no altera un documento que ya trae ciclo de vida válido.
 *
 * Debe aplicarse tanto en lecturas de cliente como **dentro** de las
 * transacciones de escritura, para que ningún camino escriba un documento sin
 * estos campos.
 */
export function normalizeTracking(
  tracking: CampaignOperationalTracking,
): CampaignOperationalTracking {
  const status: TrackingLifecycleStatus =
    tracking.lifecycleStatus === 'cancelled' ? 'cancelled' : 'active';
  return {
    ...tracking,
    lifecycleStatus: status,
    lifecycleUpdatedAt: tracking.lifecycleUpdatedAt ?? tracking.createdAt,
    lifecycleUpdatedByUid:
      tracking.lifecycleUpdatedByUid ?? tracking.createdByUid,
    lifecycleUpdatedByEmail:
      tracking.lifecycleUpdatedByEmail ?? tracking.createdByEmail,
    cancellationReason: tracking.cancellationReason ?? null,
  };
}

/** ¿La campaña está cancelada? Tolera documentos legacy (los trata como activos). */
export function isCancelled(tracking: CampaignOperationalTracking): boolean {
  return normalizeTracking(tracking).lifecycleStatus === 'cancelled';
}

/**
 * Marca la campaña como **Cancelada** (transición pura). No toca los checks, la
 * clasificación ni los comentarios: sus valores quedan intactos para recuperarse
 * al reactivar. El motivo es opcional: texto vacío se persiste como `null`.
 * Registra quién y cuándo realizó la transición.
 */
export function cancelTracking(
  tracking: CampaignOperationalTracking,
  reason: string,
  actor: TrackingActor,
  now: number,
): CampaignOperationalTracking {
  const base = normalizeTracking(tracking);
  const trimmed = reason.trim();
  return {
    ...base,
    lifecycleStatus: 'cancelled',
    lifecycleUpdatedAt: now,
    lifecycleUpdatedByUid: actor.uid,
    lifecycleUpdatedByEmail: actor.email,
    cancellationReason: trimmed === '' ? null : trimmed,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}

/**
 * Reactiva la campaña (transición pura): vuelve a `active`, limpia el motivo de
 * cancelación y registra quién/cuándo. **No** modifica los checks: reaparecen
 * exactamente con los valores que tenían antes de cancelar.
 */
export function reactivateTracking(
  tracking: CampaignOperationalTracking,
  actor: TrackingActor,
  now: number,
): CampaignOperationalTracking {
  const base = normalizeTracking(tracking);
  return {
    ...base,
    lifecycleStatus: 'active',
    lifecycleUpdatedAt: now,
    lifecycleUpdatedByUid: actor.uid,
    lifecycleUpdatedByEmail: actor.email,
    cancellationReason: null,
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
  // Una campaña cancelada no acepta cambios en sus indicadores: la reactivación
  // es la única vía para volver a editarlos (no basta ocultar las casillas).
  if (isCancelled(tracking)) {
    return { ok: false, reason: CANCELLED_CHECK_MESSAGE };
  }

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
 * Marca **todos** los indicadores como completados (acción explícita del usuario,
 * `source: 'manual'`). Se usa en el botón "Marcar todas" de campañas terminadas.
 * No requiere reglas especiales: dejar todo marcado satisface la relación de
 * testigos (T Completos ⇒ T Arranque).
 */
export function markAllComplete(
  tracking: CampaignOperationalTracking,
  actor: TrackingActor,
  now: number,
): CheckChangeResult {
  // "Marcar todas" también se rechaza sobre una campaña cancelada.
  if (isCancelled(tracking)) {
    return { ok: false, reason: CANCELLED_CHECK_MESSAGE };
  }
  return {
    ok: true,
    tracking: {
      ...tracking,
      linkDownload: makeCheck(true, 'manual', actor, now),
      liverpoolValidation: makeCheck(true, 'manual', actor, now),
      csmProgramming: makeCheck(true, 'manual', actor, now),
      witnessStart: makeCheck(true, 'manual', actor, now),
      witnessComplete: makeCheck(true, 'manual', actor, now),
      updatedAt: now,
      updatedByUid: actor.uid,
      updatedByEmail: actor.email,
    },
  };
}

/**
 * Agrega un comentario a la bitácora (historial) conservando el resto del
 * documento. El `id` se genera fuera (persistencia/UI) para mantener la pureza.
 * Ignora textos vacíos devolviendo el documento sin cambios.
 */
export function addComment(
  tracking: CampaignOperationalTracking,
  id: string,
  text: string,
  actor: TrackingActor,
  now: number,
): CampaignOperationalTracking {
  const trimmed = text.trim();
  if (!trimmed) return tracking;
  const comment: OperationalComment = {
    id,
    text: trimmed,
    createdAt: now,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
  };
  return {
    ...tracking,
    comments: [...(tracking.comments ?? []), comment],
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
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
