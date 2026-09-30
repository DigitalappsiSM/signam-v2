/**
 * Tipos del seguimiento operativo de campañas.
 *
 * El seguimiento vive en una colección **independiente** de `campaigns`
 * (`campaignOperationalTracking/{campaignId}`) y contiene solo datos
 * operativos y su trazabilidad; nunca se mezcla con la campaña importada.
 */

export type Classification = 'institutional' | 'provider';

/** Origen de la clasificación (para trazabilidad). */
export type ClassificationSource =
  'calendar' | 'import-user' | 'tracking-user' | 'manual-campaign';

/**
 * Estado de la campaña (ciclo de vida), editable a mano desde Campañas y
 * Seguimiento operativo, siempre con motivo e historial:
 *
 * - `active`: operación normal.
 * - `paused`: detenida temporalmente; sigue en consolidación/CSV y Quividi, pero
 *   sale de alertas, resumen del Dashboard, carga por tienda y baja ocupación.
 * - `cancelled`: no se ejecuta; sale de todo (incluido CSV y Quividi).
 * - `duplicate`: copia de otra campaña de SIGNAM (`duplicateOfCampaignId`); sale
 *   de todo.
 *
 * La matriz de efectos vive en `campaigns/campaignStatus.ts`. Se distingue
 * deliberadamente de los estados de los testigos (`WitnessStatus`).
 */
export type TrackingLifecycleStatus =
  'active' | 'paused' | 'cancelled' | 'duplicate';

/** Motivo de un cambio de estado: código del catálogo + texto libre. */
export interface CampaignStatusReason {
  /** Código del catálogo (`other` exige `detail`; `migrated` para legacy). */
  code: string;
  /** Etiqueta legible del motivo en el momento del cambio. */
  label: string;
  /** Texto libre (obligatorio con «Otro», opcional en los demás). */
  detail: string | null;
}

/** Un cambio de estado en el historial (orden cronológico, solo se agrega). */
export interface CampaignStatusEvent {
  id: string;
  from: TrackingLifecycleStatus;
  to: TrackingLifecycleStatus;
  reason: CampaignStatusReason;
  /** Campaña original cuando `to === 'duplicate'`. */
  duplicateOfCampaignId: string | null;
  duplicateOfCampaignName: string | null;
  at: number;
  byUid: string;
  byEmail: string;
}

/** Un comentario de la bitácora de una campaña (historial). */
export interface OperationalComment {
  id: string;
  text: string;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
}

/** Un indicador manual con su estado y trazabilidad. */
export interface OperationalCheck {
  completed: boolean;
  completedAt: number | null;
  completedByUid: string | null;
  completedByEmail: string | null;
  /**
   * `automatic`: el valor inicial lo puso el sistema/importación.
   * `manual`: un usuario lo modificó explícitamente al menos una vez.
   */
  source: 'automatic' | 'manual';
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}

export interface CampaignOperationalTracking {
  /** ID del documento. En el esquema actual coincide con `campaignId`. */
  id: string;
  /** Referencia estable a `campaigns/{campaignId}`; ausente en documentos legacy. */
  campaignId?: string;
  /** Huella histórica usada por documentos legacy y para diagnóstico. */
  campaignNameKey: string;
  campaignName: string;

  classification: Classification;
  classificationSource: ClassificationSource;
  classificationUpdatedAt: number;
  classificationUpdatedByUid: string;
  classificationUpdatedByEmail: string;

  /**
   * Estado de la campaña. Los documentos **legacy** que no traen este campo se
   * interpretan como `active` (ver `normalizeTracking`). Los estados distintos
   * de `active` no generan alertas ni vencimientos y conservan intactos los
   * checks/comentarios/clasificación para recuperarlos al reactivar.
   */
  lifecycleStatus: TrackingLifecycleStatus;
  /** Marca de tiempo de la última transición de estado. */
  lifecycleUpdatedAt: number;
  /** UID de quien realizó la última transición de estado. */
  lifecycleUpdatedByUid: string;
  /** Correo de quien realizó la última transición de estado. */
  lifecycleUpdatedByEmail: string;
  /**
   * Resumen de texto del motivo vigente (compatibilidad con lectores previos).
   * `null` en `active`.
   */
  cancellationReason: string | null;
  /** Motivo estructurado del estado vigente (`null` en `active`). */
  statusReason?: CampaignStatusReason | null;
  /** Campaña original cuando el estado es `duplicate`. */
  duplicateOfCampaignId?: string | null;
  duplicateOfCampaignName?: string | null;
  /** Historial completo de cambios de estado (solo se agrega). */
  statusHistory?: CampaignStatusEvent[];

  /**
   * Link de descarga: por defecto AUTOMÁTICO (marcado si `campaign.link` es una
   * URL válida). Es editable: si el usuario lo cambia, `source: 'manual'` y su
   * valor manda; mientras `source: 'automatic'`, la UI lo deriva del link del
   * calendario (se actualiza en reimportaciones).
   */
  linkDownload: OperationalCheck;
  /** Validación Liverpool (manual; por defecto marcada si Institucional o link válido). */
  liverpoolValidation: OperationalCheck;
  /** Programación CSM (siempre manual, inicia desmarcada). */
  csmProgramming: OperationalCheck;
  /** T Arranque (manual). */
  witnessStart: OperationalCheck;
  /** T Completos (manual). */
  witnessComplete: OperationalCheck;
  /**
   * Evidencia de pases (reporte de pases de Admira que Liverpool pide a los 5
   * días naturales del inicio). Solo aplica a **Proveedor**. Opcional: los
   * documentos anteriores a este check no lo traen y se leen como desmarcado.
   */
  passesEvidence?: OperationalCheck;

  /** Bitácora de comentarios (orden cronológico, se agregan al final). */
  comments: OperationalComment[];

  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}

/** Indicadores editables persistidos. */
export type CheckKey =
  | 'linkDownload'
  | 'liverpoolValidation'
  | 'csmProgramming'
  | 'witnessStart'
  | 'witnessComplete'
  | 'passesEvidence';
