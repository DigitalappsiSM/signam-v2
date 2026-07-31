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
