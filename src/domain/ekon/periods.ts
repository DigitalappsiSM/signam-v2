import type { EkonPeriod, EkonRawRow } from './models';

/**
 * Detección y análisis de periodos Ekon.
 *
 * Esta regla aplica SOLO a Ekon (Liverpool se sigue cargando siempre como año
 * completo). Los periodos se construyen con `Año + ID Periodo + Inicio + Fin`.
 * El alcance se PROPONE al usuario; nunca se infiere solo con `min/max(fecha)`
 * si hay huecos.
 */

/** Análisis de los periodos presentes en un lote. */
export interface PeriodAnalysis {
  /** Periodos únicos, ordenados por fecha de inicio (o por id si no hay fecha). */
  periods: EkonPeriod[];
  /** Fecha mínima y máxima detectadas. */
  coverage: { min: string | null; max: string | null };
  /**
   * IDs de periodo que aparecen con fechas INCOMPATIBLES (mismo id, distinto
   * inicio/fin). Indican inconsistencia en el archivo.
   */
  inconsistentPeriodIds: string[];
  /**
   * Huecos entre periodos consecutivos (bloques no contiguos). Cada hueco indica
   * el periodo previo y el siguiente entre los que falta cobertura.
   */
  gaps: { after: EkonPeriod; before: EkonPeriod }[];
}

function periodSignature(p: {
  inicio: string | null;
  fin: string | null;
}): string {
  return `${p.inicio ?? ''}|${p.fin ?? ''}`;
}

/**
 * Compara dos periodos por fecha de inicio (los nulos van al final), con el id
 * como desempate estable.
 */
function comparePeriods(a: EkonPeriod, b: EkonPeriod): number {
  if (a.inicio && b.inicio && a.inicio !== b.inicio) {
    return a.inicio < b.inicio ? -1 : 1;
  }
  if (a.inicio && !b.inicio) return -1;
  if (!a.inicio && b.inicio) return 1;
  return Number(a.idPeriodo) - Number(b.idPeriodo) || 0;
}

/**
 * Analiza los periodos presentes en las filas: únicos, cobertura, incoherencias
 * (mismo id con fechas distintas) y huecos entre bloques consecutivos.
 */
export function analyzePeriods(rows: readonly EkonRawRow[]): PeriodAnalysis {
  const byId = new Map<string, Map<string, EkonPeriod>>();
  let min: string | null = null;
  let max: string | null = null;

  for (const row of rows) {
    const id = row.idPeriodo;
    if (id === '') continue;
    const period: EkonPeriod = {
      año: row.año,
      idPeriodo: id,
      inicio: row.inicioPeriodo,
      fin: row.finPeriodo,
    };
    const variants = byId.get(id) ?? new Map<string, EkonPeriod>();
    variants.set(periodSignature(period), period);
    byId.set(id, variants);

    if (row.inicioPeriodo && (min === null || row.inicioPeriodo < min)) {
      min = row.inicioPeriodo;
    }
    if (row.finPeriodo && (max === null || row.finPeriodo > max)) {
      max = row.finPeriodo;
    }
  }

  const periods: EkonPeriod[] = [];
  const inconsistentPeriodIds: string[] = [];
  for (const [id, variants] of byId) {
    if (variants.size > 1) inconsistentPeriodIds.push(id);
    // Representante: la variante con fecha de inicio más temprana.
    const chosen = [...variants.values()].sort(comparePeriods)[0]!;
    periods.push(chosen);
  }
  periods.sort(comparePeriods);

  // Huecos: dos periodos consecutivos con fechas cuyo intervalo no es contiguo
  // (el inicio del siguiente no es el día posterior al fin del anterior).
  const gaps: { after: EkonPeriod; before: EkonPeriod }[] = [];
  for (let i = 0; i < periods.length - 1; i += 1) {
    const current = periods[i]!;
    const next = periods[i + 1]!;
    if (!current.fin || !next.inicio) continue;
    if (!isNextDay(current.fin, next.inicio)) {
      gaps.push({ after: current, before: next });
    }
  }

  return {
    periods,
    coverage: { min, max },
    inconsistentPeriodIds: inconsistentPeriodIds.sort(),
    gaps,
  };
}

/** true si `later` es exactamente el día civil siguiente a `earlier`. */
function isNextDay(earlier: string, later: string): boolean {
  const e = Date.parse(`${earlier}T00:00:00Z`);
  const l = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(e) || Number.isNaN(l)) return false;
  return l - e === 86400000;
}

/**
 * Filtra los periodos "confirmados" a partir de la selección del usuario. Si la
 * selección está vacía se interpretan como confirmados TODOS los detectados
 * (comportamiento por defecto tras la confirmación del alcance completo).
 */
export function confirmedPeriodSet(
  detected: readonly EkonPeriod[],
  confirmedIds: readonly string[] | null,
): Set<string> {
  if (confirmedIds === null) {
    return new Set(detected.map((p) => p.idPeriodo));
  }
  return new Set(confirmedIds);
}
