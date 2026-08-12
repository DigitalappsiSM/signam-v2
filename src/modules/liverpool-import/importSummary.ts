import type { CampaignDiff } from '@/modules/campaigns/campaignDiff';
import type { CalendarAnalysis } from './calendarImport';

/**
 * Resumen numérico de una importación de calendario, para el banner-titular
 * (siempre visible) de `/importar`. Función pura: solo cuenta lo ya derivado por
 * el diff y el análisis, sin efectos ni dependencias de UI.
 */
export interface ImportSummary {
  /** Campañas nuevas que se crearán. */
  added: number;
  /** Campañas con cambios (fechas/soportes/…). */
  modified: number;
  /** Campañas que se inactivarán (baja lógica). */
  removed: number;
  /** Campañas del calendario sin cambios respecto a la base. */
  unchanged: number;
  /** Campañas nuevas que requieren clasificación (con o sin definir). */
  toClassify: number;
  /** Clasificaciones aún sin definir (bloquean el guardado). */
  pending: number;
  /** Errores bloqueantes del diagnóstico del archivo. */
  errors: number;
  /** Advertencias no bloqueantes del diagnóstico del archivo. */
  warnings: number;
  /** ¿Hay algo que guardar? (cambios de campañas o clasificaciones nuevas). */
  hasWork: boolean;
}

export function importSummary(
  diff: CampaignDiff | null,
  analysis: CalendarAnalysis | null,
  toClassify: number,
  pending: number,
): ImportSummary {
  const issues = analysis?.issues ?? [];
  const errors = issues.filter((i) => i.severity === 'blocking').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const added = diff?.added.length ?? 0;
  const modified = diff?.modified.length ?? 0;
  const removed = diff?.removed.length ?? 0;
  return {
    added,
    modified,
    removed,
    unchanged: diff?.unchanged ?? 0,
    toClassify,
    pending,
    errors,
    warnings,
    hasWork: Boolean(diff?.hasChanges) || toClassify > 0,
  };
}
