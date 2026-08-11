/**
 * Tipos del seguimiento operativo de campañas.
 *
 * El seguimiento vive en una colección **independiente** de `campaigns`
 * (`campaignOperationalTracking/{campaignKeyId}`) y contiene solo datos
 * operativos y su trazabilidad; nunca se mezcla con la campaña importada.
 */

export type Classification = 'institutional' | 'provider';

/** Origen de la clasificación (para trazabilidad). */
export type ClassificationSource = 'calendar' | 'import-user' | 'tracking-user';

/**
 * Estado de ciclo de vida operativo de la campaña (independiente de los
 * testigos). `active` es el estado normal; `cancelled` es un estado **manual**
 * que exime a la campaña de todos los checks, alertas y vencimientos operativos
 * sin borrar sus valores. Se distingue deliberadamente de los estados de los
 * testigos (`WitnessStatus`): aquí no se usa un campo `status` ambiguo.
 */
export type TrackingLifecycleStatus = 'active' | 'cancelled';

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
  /** ID del documento = `campaignKeyId(campaignNameKey)`. */
  id: string;
  campaignNameKey: string;
  campaignName: string;

  classification: Classification;
  classificationSource: ClassificationSource;
  classificationUpdatedAt: number;
  classificationUpdatedByUid: string;
  classificationUpdatedByEmail: string;

  /**
   * Ciclo de vida operativo (Activa/Cancelada). Los documentos **legacy** que no
   * traen este campo se interpretan como `active` (ver `normalizeTracking`). Una
   * campaña `cancelled` no requiere checks, no genera alertas ni vencimientos y
   * conserva intactos sus checks/comentarios/clasificación para recuperarlos al
   * reactivar.
   */
  lifecycleStatus: TrackingLifecycleStatus;
  /** Marca de tiempo de la última transición de ciclo de vida. */
  lifecycleUpdatedAt: number;
  /** UID de quien realizó la última transición de ciclo de vida. */
  lifecycleUpdatedByUid: string;
  /** Correo de quien realizó la última transición de ciclo de vida. */
  lifecycleUpdatedByEmail: string;
  /**
   * Motivo opcional de cancelación. Texto vacío se persiste como `null`. Se
   * limpia (a `null`) al reactivar.
   */
  cancellationReason: string | null;

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
  | 'witnessComplete';
