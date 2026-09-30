import { campaignKeyId } from '@/modules/campaigns/ekon';
import {
  EFFECTIVE_STATUS_LABELS,
  MIGRATED_REASON,
  OTHER_REASON,
  formatStatusReason,
  statusAllows,
  storedStatus,
} from '@/modules/campaigns/campaignStatus';
import type {
  CampaignOperationalTracking,
  CampaignStatusEvent,
  CampaignStatusReason,
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

/** Mensaje de dominio: los indicadores de una campaña duplicada no se editan. */
export const DUPLICATE_CHECK_MESSAGE =
  'La campaña está marcada como duplicada: reactívala para volver a editar sus indicadores.';

/**
 * Mensaje de dominio cuando se intenta editar los testigos (T Arranque /
 * T Completos) de una campaña Institucional: no aplican por regla de negocio.
 */
export const INSTITUTIONAL_WITNESS_MESSAGE =
  'Los testigos no aplican a campañas institucionales.';

/** Mensaje de dominio: la Evidencia de pases solo aplica a campañas Proveedor. */
export const PASSES_EVIDENCE_PROVIDER_MESSAGE =
  'La evidencia de pases solo aplica a campañas de proveedor.';

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
    statusReason: null,
    duplicateOfCampaignId: null,
    duplicateOfCampaignName: null,
    statusHistory: [],
    linkDownload: makeCheck(params.linkValid, 'automatic', actor, now),
    liverpoolValidation: makeCheck(validationDefault, 'automatic', actor, now),
    csmProgramming: makeCheck(false, 'automatic', actor, now),
    witnessStart: makeCheck(false, 'automatic', actor, now),
    witnessComplete: makeCheck(false, 'automatic', actor, now),
    passesEvidence: makeCheck(false, 'automatic', actor, now),
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
 * Rellena los campos de estado ausentes en documentos **legacy** (los creados
 * antes de esta funcionalidad). Un documento sin `lifecycleStatus` se interpreta
 * como `active`; los metadatos de transición faltantes se derivan de la
 * creación. Una cancelación legacy (motivo opcional, sin historial) recibe su
 * motivo estructurado (el texto que tuviera como «Otro», o «Migrado (sin motivo
 * registrado)») y un evento de historial sintético. Es idempotente y no altera
 * un documento que ya trae estos campos.
 *
 * Debe aplicarse tanto en lecturas de cliente como **dentro** de las
 * transacciones de escritura, para que ningún camino escriba un documento sin
 * estos campos.
 */
export function normalizeTracking(
  tracking: CampaignOperationalTracking,
): CampaignOperationalTracking {
  const status: TrackingLifecycleStatus = storedStatus(tracking);
  const lifecycleUpdatedAt = tracking.lifecycleUpdatedAt ?? tracking.createdAt;
  const lifecycleUpdatedByUid =
    tracking.lifecycleUpdatedByUid ?? tracking.createdByUid;
  const lifecycleUpdatedByEmail =
    tracking.lifecycleUpdatedByEmail ?? tracking.createdByEmail;
  const legacyText = tracking.cancellationReason?.trim() || null;
  let statusReason: CampaignStatusReason | null =
    status === 'active' ? null : (tracking.statusReason ?? null);
  if (status !== 'active' && !statusReason) {
    statusReason = legacyText
      ? {
          code: OTHER_REASON.code,
          label: OTHER_REASON.label,
          detail: legacyText,
        }
      : {
          code: MIGRATED_REASON.code,
          label: MIGRATED_REASON.label,
          detail: null,
        };
  }
  let statusHistory: CampaignStatusEvent[] = tracking.statusHistory ?? [];
  if (!tracking.statusHistory && status !== 'active' && statusReason) {
    statusHistory = [
      {
        id: `legacy-${lifecycleUpdatedAt}`,
        from: 'active',
        to: status,
        reason: statusReason,
        duplicateOfCampaignId: null,
        duplicateOfCampaignName: null,
        at: lifecycleUpdatedAt,
        byUid: lifecycleUpdatedByUid,
        byEmail: lifecycleUpdatedByEmail,
      },
    ];
  }
  return {
    ...tracking,
    lifecycleStatus: status,
    lifecycleUpdatedAt,
    lifecycleUpdatedByUid,
    lifecycleUpdatedByEmail,
    cancellationReason:
      status === 'active' ? null : formatStatusReason(statusReason) || null,
    statusReason,
    duplicateOfCampaignId:
      status === 'duplicate' ? (tracking.duplicateOfCampaignId ?? null) : null,
    duplicateOfCampaignName:
      status === 'duplicate'
        ? (tracking.duplicateOfCampaignName ?? null)
        : null,
    statusHistory,
  };
}

/** ¿La campaña está cancelada? Tolera documentos legacy (los trata como activos). */
export function isCancelled(tracking: CampaignOperationalTracking): boolean {
  return normalizeTracking(tracking).lifecycleStatus === 'cancelled';
}

export interface StatusChange {
  to: TrackingLifecycleStatus;
  reason: CampaignStatusReason;
  /** Obligatorio cuando `to === 'duplicate'`. */
  duplicateOf: { campaignId: string; campaignName: string } | null;
}

/**
 * Cambia el estado de la campaña (transición pura) y agrega el evento al
 * historial. **No** toca checks, clasificación ni comentarios: al reactivar
 * reaparecen tal cual estaban. La validación de negocio (motivo obligatorio,
 * original del duplicado, etc.) vive en `validateStatusChange`; aquí solo se
 * rechazan transiciones incoherentes.
 */
export function changeTrackingStatus(
  tracking: CampaignOperationalTracking,
  change: StatusChange,
  actor: TrackingActor,
  now: number,
  eventId: string,
): CampaignOperationalTracking {
  const base = normalizeTracking(tracking);
  const from = base.lifecycleStatus;
  if (from === change.to) {
    throw new Error(
      `La campaña ya está en estado «${EFFECTIVE_STATUS_LABELS[from]}».`,
    );
  }
  if (change.to === 'duplicate' && !change.duplicateOf) {
    throw new Error('Falta la campaña original del duplicado.');
  }
  const duplicateOf = change.to === 'duplicate' ? change.duplicateOf : null;
  const event: CampaignStatusEvent = {
    id: eventId,
    from,
    to: change.to,
    reason: change.reason,
    duplicateOfCampaignId: duplicateOf?.campaignId ?? null,
    duplicateOfCampaignName: duplicateOf?.campaignName ?? null,
    at: now,
    byUid: actor.uid,
    byEmail: actor.email,
  };
  const active = change.to === 'active';
  return {
    ...base,
    lifecycleStatus: change.to,
    lifecycleUpdatedAt: now,
    lifecycleUpdatedByUid: actor.uid,
    lifecycleUpdatedByEmail: actor.email,
    cancellationReason: active ? null : formatStatusReason(change.reason),
    statusReason: active ? null : change.reason,
    duplicateOfCampaignId: duplicateOf?.campaignId ?? null,
    duplicateOfCampaignName: duplicateOf?.campaignName ?? null,
    statusHistory: [...(base.statusHistory ?? []), event],
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}

/** Motivo de rechazo al editar checks según el estado (o `null` si se permite). */
function checksBlockedReason(
  tracking: CampaignOperationalTracking,
): string | null {
  const status = normalizeTracking(tracking).lifecycleStatus;
  if (statusAllows(status, 'trackingChecks')) return null;
  return status === 'duplicate'
    ? DUPLICATE_CHECK_MESSAGE
    : CANCELLED_CHECK_MESSAGE;
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
  // Una campaña cancelada o duplicada no acepta cambios en sus indicadores: la
  // reactivación es la única vía para volver a editarlos (no basta ocultar las
  // casillas). En pausa sí se pueden editar.
  const blocked = checksBlockedReason(tracking);
  if (blocked) return { ok: false, reason: blocked };

  // Los testigos no aplican a las campañas Institucional: se rechaza cualquier
  // cambio en dominio (no basta ocultar las casillas). No se tocan sus valores
  // históricos, que reaparecen si la campaña vuelve a Proveedor.
  if (
    (key === 'witnessStart' || key === 'witnessComplete') &&
    tracking.classification === 'institutional'
  ) {
    return { ok: false, reason: INSTITUTIONAL_WITNESS_MESSAGE };
  }

  // La Evidencia de pases solo aplica a Proveedor (Institucional y clasificación
  // pendiente se rechazan en dominio; sus valores históricos se conservan).
  if (key === 'passesEvidence' && tracking.classification !== 'provider') {
    return { ok: false, reason: PASSES_EVIDENCE_PROVIDER_MESSAGE };
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
 * Marca los indicadores **aplicables** como completados (acción explícita del
 * usuario, `source: 'manual'`). Se usa en el botón "Marcar todas"/"Marcar
 * aplicables" de campañas terminadas y respeta la clasificación almacenada:
 *
 * - **Proveedor**: marca los seis indicadores (incluida la Evidencia de pases).
 *   Dejar todo marcado satisface la relación de testigos (T Completos ⇒ T Arranque).
 * - **Pendiente**: marca Link, Validación, CSM y testigos; no la Evidencia de pases.
 * - **Institucional**: marca sólo Link, Validación Liverpool y Programación CSM;
 *   NO toca T Arranque ni T Completos (no aplican; sus valores se conservan).
 * - **Cancelada / Duplicada**: se rechaza (la reactivación es la única vía).
 */
export function markAllComplete(
  tracking: CampaignOperationalTracking,
  actor: TrackingActor,
  now: number,
): CheckChangeResult {
  // "Marcar todas" también se rechaza sobre una campaña cancelada o duplicada.
  const blocked = checksBlockedReason(tracking);
  if (blocked) return { ok: false, reason: blocked };
  const institutional = tracking.classification === 'institutional';
  return {
    ok: true,
    tracking: {
      ...tracking,
      linkDownload: makeCheck(true, 'manual', actor, now),
      liverpoolValidation: makeCheck(true, 'manual', actor, now),
      csmProgramming: makeCheck(true, 'manual', actor, now),
      // Los testigos no aplican a Institucional: se conservan intactos.
      witnessStart: institutional
        ? tracking.witnessStart
        : makeCheck(true, 'manual', actor, now),
      witnessComplete: institutional
        ? tracking.witnessComplete
        : makeCheck(true, 'manual', actor, now),
      // Solo Proveedor. En otro caso el campo se conserva tal cual (o ausente en
      // documentos legacy): asignar `undefined` haría fallar `tx.set()`.
      ...(tracking.classification === 'provider'
        ? { passesEvidence: makeCheck(true, 'manual', actor, now) }
        : {}),
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
