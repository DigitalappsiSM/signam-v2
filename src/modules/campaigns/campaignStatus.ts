import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type {
  CampaignOperationalTracking,
  CampaignStatusReason,
  TrackingLifecycleStatus,
} from '@/modules/operational-tracking/types';

/**
 * Estados de campaña (puro, sin Firestore ni UI).
 *
 * El estado manual (`active`/`paused`/`cancelled`/`duplicate`) se guarda en el
 * documento de seguimiento (`campaignOperationalTracking/{campaignId}`), que la
 * importación del calendario nunca sobrescribe. `withdrawn` (Retirada del
 * calendario) no se edita: se deriva de la baja lógica que aplica la
 * importación (`campaign.active === false`) y domina sobre el estado manual.
 *
 * Toda decisión de «¿esta campaña entra en X?» pasa por `statusAllows`, para que
 * Campañas, Seguimiento, Dashboard, baja ocupación y Quividi apliquen la misma
 * matriz aprobada.
 */

export type CampaignStatus = TrackingLifecycleStatus;
export type EffectiveCampaignStatus = CampaignStatus | 'withdrawn';

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'active',
  'paused',
  'cancelled',
  'duplicate',
];

export const EFFECTIVE_STATUS_LABELS: Record<EffectiveCampaignStatus, string> =
  {
    active: 'Activa',
    paused: 'En pausa',
    cancelled: 'Cancelada',
    duplicate: 'Duplicada',
    withdrawn: 'Retirada del calendario',
  };

/** Áreas del sistema que dependen del estado. */
export type StatusEffect =
  /** Alertas, vencimientos y «estado general» del seguimiento. */
  | 'operationalAlerts'
  /** Checks editables en Seguimiento operativo. */
  | 'trackingChecks'
  /** Resumen operativo del Dashboard (KPIs, alertas, vencimientos). */
  | 'dashboardSummary'
  /** Carga por tienda/soporte del Dashboard. */
  | 'dashboardLoad'
  /** Consolidación y CSV de Admira. */
  | 'consolidationCsv'
  /** Alertas de baja ocupación. */
  | 'lowOccupancy'
  /** Informe Quividi (PDF/Excel). */
  | 'quividiReport';

/** Matriz de efectos aprobada (ver `AGENTS.md`, «Estados de campaña»). */
export const STATUS_EFFECTS: Record<
  EffectiveCampaignStatus,
  Record<StatusEffect, boolean>
> = {
  active: {
    operationalAlerts: true,
    trackingChecks: true,
    dashboardSummary: true,
    dashboardLoad: true,
    consolidationCsv: true,
    lowOccupancy: true,
    quividiReport: true,
  },
  paused: {
    operationalAlerts: false,
    trackingChecks: true,
    dashboardSummary: false,
    dashboardLoad: false,
    consolidationCsv: true,
    lowOccupancy: false,
    quividiReport: true,
  },
  cancelled: {
    operationalAlerts: false,
    trackingChecks: false,
    dashboardSummary: false,
    dashboardLoad: false,
    consolidationCsv: false,
    lowOccupancy: false,
    quividiReport: false,
  },
  duplicate: {
    operationalAlerts: false,
    trackingChecks: false,
    dashboardSummary: false,
    dashboardLoad: false,
    consolidationCsv: false,
    lowOccupancy: false,
    quividiReport: false,
  },
  withdrawn: {
    operationalAlerts: false,
    trackingChecks: false,
    dashboardSummary: false,
    dashboardLoad: false,
    consolidationCsv: false,
    lowOccupancy: false,
    quividiReport: false,
  },
};

export function statusAllows(
  status: EffectiveCampaignStatus,
  effect: StatusEffect,
): boolean {
  return STATUS_EFFECTS[status][effect];
}

/** ¿El estado participa en el resumen operativo (KPIs, alertas)? */
export function isOperationallyApplicableStatus(
  status: EffectiveCampaignStatus,
): boolean {
  return statusAllows(status, 'dashboardSummary');
}

// --- Catálogo de motivos -------------------------------------------------

export interface StatusReasonOption {
  code: string;
  label: string;
}

/** Código del motivo que exige texto libre. */
export const OTHER_REASON_CODE = 'other';
export const OTHER_REASON: StatusReasonOption = {
  code: OTHER_REASON_CODE,
  label: 'Otro',
};
/** Motivo asignado a las cancelaciones legacy que no registraron motivo. */
export const MIGRATED_REASON: StatusReasonOption = {
  code: 'migrated',
  label: 'Migrado (sin motivo registrado)',
};

/**
 * Motivos por estado destino. `active` son los motivos de **reactivación**
 * (también exige motivo). Siempre termina en «Otro» (texto libre obligatorio).
 */
export const STATUS_REASONS: Record<CampaignStatus, StatusReasonOption[]> = {
  active: [
    {
      code: 'liverpool-or-ism-confirmed',
      label: 'Liverpool o ISM confirmó la campaña',
    },
    { code: 'resumed', label: 'Se reanuda la campaña' },
    { code: 'status-error', label: 'Estado aplicado por error' },
    OTHER_REASON,
  ],
  paused: [
    { code: 'liverpool-request', label: 'Solicitud de Liverpool' },
    { code: 'ism-request', label: 'Solicitud de ISM' },
    { code: 'provider-request', label: 'Solicitud del proveedor' },
    { code: 'content-pending', label: 'Contenido o material pendiente' },
    { code: 'technical-issue', label: 'Incidencia técnica' },
    OTHER_REASON,
  ],
  cancelled: [
    { code: 'liverpool-request', label: 'Cancelada por Liverpool' },
    { code: 'ism-request', label: 'Cancelada por ISM' },
    { code: 'provider-request', label: 'Cancelada por el proveedor' },
    { code: 'capture-error', label: 'Error de captura' },
    OTHER_REASON,
  ],
  duplicate: [
    {
      code: 'calendar-duplicate',
      label: 'Duplicada en el calendario de Liverpool',
    },
    {
      code: 'manual-and-calendar',
      label: 'Campaña manual repetida en el calendario',
    },
    { code: 'name-variant', label: 'Misma campaña con otro nombre' },
    OTHER_REASON,
  ],
};

/** Construye el motivo a persistir a partir del código y el texto libre. */
export function buildStatusReason(
  to: CampaignStatus,
  code: string,
  detail: string,
): CampaignStatusReason | null {
  const option = STATUS_REASONS[to].find((o) => o.code === code);
  if (!option) return null;
  const trimmed = detail.trim();
  return {
    code: option.code,
    label: option.label,
    detail: trimmed === '' ? null : trimmed,
  };
}

/** Texto de una línea para un motivo («Etiqueta · detalle»). */
export function formatStatusReason(
  reason: CampaignStatusReason | null | undefined,
): string {
  if (!reason) return '';
  if (reason.code === OTHER_REASON_CODE && reason.detail) return reason.detail;
  return reason.detail ? `${reason.label} · ${reason.detail}` : reason.label;
}

// --- Estado efectivo -----------------------------------------------------

/** Estado manual guardado (legacy/ausente ⇒ `active`). */
export function storedStatus(
  tracking: Pick<CampaignOperationalTracking, 'lifecycleStatus'> | null,
): CampaignStatus {
  const s = tracking?.lifecycleStatus;
  return s === 'paused' || s === 'cancelled' || s === 'duplicate'
    ? s
    : 'active';
}

/** Estado efectivo: la baja del calendario domina sobre el estado manual. */
export function effectiveCampaignStatus(
  campaign: Pick<StoredCampaign, 'active'>,
  tracking: Pick<CampaignOperationalTracking, 'lifecycleStatus'> | null,
): EffectiveCampaignStatus {
  if (campaign.active === false) return 'withdrawn';
  return storedStatus(tracking);
}

/**
 * Seguimiento de cada campaña (por `campaign.id`, con respaldo legacy por
 * `campaignIdentity`), igual que `buildTrackingRows`.
 */
export function trackingByCampaign(
  campaigns: readonly StoredCampaign[],
  tracking: readonly CampaignOperationalTracking[],
): Map<string, CampaignOperationalTracking> {
  const byId = new Map<string, CampaignOperationalTracking>();
  const legacy = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) {
    if (t.campaignId) byId.set(t.campaignId, t);
    else legacy.set(t.campaignNameKey, t);
  }
  const out = new Map<string, CampaignOperationalTracking>();
  for (const c of campaigns) {
    const t = byId.get(c.id) ?? legacy.get(campaignIdentity(c));
    if (t) out.set(c.id, t);
  }
  return out;
}

/** Estado efectivo de cada campaña, por `campaign.id`. */
export function statusByCampaignId(
  campaigns: readonly StoredCampaign[],
  tracking: readonly CampaignOperationalTracking[],
): Map<string, EffectiveCampaignStatus> {
  const byCampaign = trackingByCampaign(campaigns, tracking);
  return new Map(
    campaigns.map((c) => [
      c.id,
      effectiveCampaignStatus(c, byCampaign.get(c.id) ?? null),
    ]),
  );
}

/** Campañas que participan en un área según su estado. */
export function campaignsAllowedFor<T extends StoredCampaign>(
  effect: StatusEffect,
  campaigns: readonly T[],
  tracking: readonly CampaignOperationalTracking[],
): T[] {
  const statuses = statusByCampaignId(campaigns, tracking);
  return campaigns.filter((c) =>
    statusAllows(statuses.get(c.id) ?? 'active', effect),
  );
}

// --- Cambio de estado ----------------------------------------------------

export interface StatusChangeInput {
  campaign: StoredCampaign;
  current: CampaignStatus;
  to: CampaignStatus;
  reasonCode: string;
  reasonDetail: string;
  duplicateOfCampaignId: string | null;
  /** Campañas válidas como original (ver `duplicateCandidates`). */
  candidates: readonly StoredCampaign[];
  /** Ids de campañas marcadas como duplicadas de `campaign`. */
  referencedBy: readonly string[];
}

/** Valida un cambio de estado. `null` = válido; si no, el mensaje a mostrar. */
export function validateStatusChange(input: StatusChangeInput): string | null {
  if (input.campaign.active === false) {
    return 'La campaña fue retirada del calendario de Liverpool: su estado no se edita a mano.';
  }
  if (input.to === input.current) {
    return 'La campaña ya está en ese estado.';
  }
  if (!STATUS_REASONS[input.to].some((o) => o.code === input.reasonCode)) {
    return 'Selecciona un motivo.';
  }
  if (
    input.reasonCode === OTHER_REASON_CODE &&
    input.reasonDetail.trim() === ''
  ) {
    return 'Con el motivo «Otro» debes escribir el detalle.';
  }
  if (input.to === 'duplicate') {
    if (!input.duplicateOfCampaignId) {
      return 'Selecciona la campaña original de la que es duplicado.';
    }
    if (input.duplicateOfCampaignId === input.campaign.id) {
      return 'Una campaña no puede ser duplicado de sí misma.';
    }
    if (!input.candidates.some((c) => c.id === input.duplicateOfCampaignId)) {
      return 'La campaña original seleccionada no es válida.';
    }
    if (input.referencedBy.length > 0) {
      return 'Otras campañas están marcadas como duplicadas de esta: no puede ser a su vez un duplicado.';
    }
  }
  return null;
}

/**
 * Campañas que pueden ser la **original** de un duplicado: vigentes en SIGNAM
 * (no retiradas), distintas de la propia y que no sean a su vez duplicadas.
 * Primero las de mismo nombre, después alfabético.
 */
export function duplicateCandidates(
  campaign: StoredCampaign,
  campaigns: readonly StoredCampaign[],
  statuses: ReadonlyMap<string, EffectiveCampaignStatus>,
): StoredCampaign[] {
  const key = campaign.name.trim().toLowerCase();
  return campaigns
    .filter(
      (c) =>
        c.id !== campaign.id &&
        c.active !== false &&
        statuses.get(c.id) !== 'duplicate',
    )
    .sort((a, b) => {
      const sa = a.name.trim().toLowerCase() === key ? 0 : 1;
      const sb = b.name.trim().toLowerCase() === key ? 0 : 1;
      return sa - sb || a.name.localeCompare(b.name, 'es');
    });
}

/** Ids de las campañas marcadas como duplicadas de `campaignId`. */
export function duplicatesOf(
  campaignId: string,
  tracking: readonly CampaignOperationalTracking[],
): string[] {
  return tracking
    .filter(
      (t) =>
        t.lifecycleStatus === 'duplicate' &&
        t.duplicateOfCampaignId === campaignId,
    )
    .map((t) => t.campaignId ?? t.id);
}

/**
 * ¿Hay que avisar que la campaña debe retirarse **a mano** en Admira? Solo
 * cuando sale del CSV y ya estaba marcada la Programación CSM (es decir, ya se
 * programó en Admira): SIGNAM no puede desprogramarla.
 */
export function needsAdmiraWithdrawal(
  current: CampaignStatus,
  to: CampaignStatus,
  tracking: Pick<CampaignOperationalTracking, 'csmProgramming'> | null,
): boolean {
  return (
    statusAllows(current, 'consolidationCsv') &&
    !statusAllows(to, 'consolidationCsv') &&
    tracking?.csmProgramming.completed === true
  );
}

export interface ImportStatusNotice {
  campaignId: string;
  campaignName: string;
  status: CampaignStatus;
  reason: string;
}

/**
 * Campañas que el calendario vuelve a subir o modifica y que tienen un estado
 * manual distinto de `active`. La importación **conserva** ese estado (nunca
 * las reactiva sola); la UI solo avisa para que alguien lo revise.
 */
export function importStatusNotices(
  modified: readonly { stored: StoredCampaign }[],
  tracking: readonly CampaignOperationalTracking[],
): ImportStatusNotice[] {
  const storedList = modified.map((m) => m.stored);
  const byCampaign = trackingByCampaign(storedList, tracking);
  const seen = new Set<string>();
  const out: ImportStatusNotice[] = [];
  for (const stored of storedList) {
    if (seen.has(stored.id)) continue;
    seen.add(stored.id);
    const t = byCampaign.get(stored.id) ?? null;
    const status = storedStatus(t);
    if (status === 'active') continue;
    out.push({
      campaignId: stored.id,
      campaignName: stored.name,
      status,
      reason: formatStatusReason(t?.statusReason),
    });
  }
  return out;
}
