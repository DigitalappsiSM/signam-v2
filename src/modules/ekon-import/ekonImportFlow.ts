import {
  analyzePeriods,
  buildAssignments,
  confirmedPeriodSet,
  contentHash,
  diffAssignments,
  parseEkonGrid,
  type EkonAssignment,
  type EkonCell,
  type EkonChangeState,
  type EkonParseResult,
  type PeriodAnalysis,
  type StoredEkonAssignment,
} from '@/domain/ekon';

/**
 * Glue puro del flujo de importación Ekon: compone parser + periodos + hash +
 * asignaciones para alimentar la UI por etapas, sin Firestore ni React.
 */

export interface EkonFileAnalysis {
  parse: EkonParseResult;
  periods: PeriodAnalysis;
  assignments: EkonAssignment[];
  contentHash: string;
  /** Métricas para la pantalla de alcance/resumen. */
  metrics: {
    totalRows: number;
    validRows: number;
    rejectedRows: number;
    distinctCampaigns: number;
    distinctLines: number;
    distinctDeterminantes: number;
    periods: number;
    conflicts: number;
  };
}

/** Analiza una matriz neutral de Ekon (resultado de `readEkonWorkbook`). */
export function analyzeEkonGrid(
  grid: readonly (readonly EkonCell[])[],
): EkonFileAnalysis {
  const parse = parseEkonGrid(grid);
  const periods = analyzePeriods(parse.rows);
  const assignments = buildAssignments(parse.rows);
  return {
    parse,
    periods,
    assignments,
    contentHash: contentHash(parse.rows),
    metrics: {
      totalRows: parse.totalRows,
      validRows: parse.validRows,
      rejectedRows: parse.rejectedRows,
      distinctCampaigns: new Set(parse.rows.map((r) => r.campaña)).size,
      distinctLines: new Set(
        parse.rows.map((r) => `${r.campaña}|${r.lineaCampaña}`),
      ).size,
      distinctDeterminantes: new Set(parse.rows.map((r) => r.determinanteKey))
        .size,
      periods: periods.periods.length,
      conflicts: assignments.filter((a) => a.conflict).length,
    },
  };
}

export interface DiffPreview {
  counts: Record<EkonChangeState, number>;
  highlights: number;
}

/**
 * Vista previa del diff SIN escribir: cuenta estados y resaltados contra el
 * estado vigente actual, dentro del alcance de periodos confirmado.
 */
export function previewDiff(
  assignments: readonly EkonAssignment[],
  previous: readonly StoredEkonAssignment[],
  confirmedPeriodIds: readonly string[] | null,
  periods: PeriodAnalysis,
): DiffPreview {
  const confirmed = confirmedPeriodSet(periods.periods, confirmedPeriodIds);
  const diff = diffAssignments(
    {
      previous,
      incoming: assignments,
      confirmedPeriods: confirmed,
      batchId: '__preview__',
    },
    0,
  );
  return { counts: diff.counts, highlights: diff.highlights.length };
}
