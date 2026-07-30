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

  /** Validación Liverpool (manual; valor inicial según clasificación). */
  liverpoolValidation: OperationalCheck;
  /** Programación CSM (siempre manual, inicia desmarcada). */
  csmProgramming: OperationalCheck;
  /** T Arranque (manual). */
  witnessStart: OperationalCheck;
  /** T Completos (manual). */
  witnessComplete: OperationalCheck;

  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  updatedAt: number;
  updatedByUid: string;
  updatedByEmail: string;
}

/** Los cuatro indicadores manuales persistidos. */
export type CheckKey =
  'liverpoolValidation' | 'csmProgramming' | 'witnessStart' | 'witnessComplete';
