import { classifyCampaign } from './campaignType';
import { isCompatibleSupport } from './supportMapping';
import { normalizeStoreNumber } from './normalization';
import type { EkonAssignment, EkonRatio } from './models';

/**
 * Motor de conciliación Ekon ↔ Liverpool. Puro y sin efectos.
 *
 * Compara una campaña Liverpool (con vínculo manual Ekon) contra las
 * asignaciones Ekon VIGENTES de ese número. Explica diferencias; NUNCA corrige,
 * sobrescribe ni mueve fuentes. Las fechas Liverpool no se cambian por las
 * fronteras del periodo Ekon.
 */

/** Entrada neutral de la campaña Liverpool (adaptada desde `StoredCampaign`). */
export interface ReconCampaignInput {
  name: string;
  /** Fecha civil `AAAA-MM-DD` (o texto vacío si no hay). */
  fechaInicio: string;
  fechaFin: string;
  supports: { support: string; stores: { numero: string }[] }[];
}

/** Cobertura de las fechas Liverpool por los periodos Ekon vigentes. */
export type CoverageStatus = 'covered' | 'partial' | 'uncovered' | 'unknown';

/** Estado global de conciliación de una campaña. */
export type ReconciliationStatus =
  | 'conciliada'
  | 'conciliada-con-advertencias'
  | 'sin-campana-ekon'
  | 'periodo-no-cubierto'
  | 'circuito-no-compatible'
  | 'diferencia-tiendas'
  | 'centro-administrativo'
  | 'cambio-pendiente';

/** Incidencia de conciliación (informativa). */
export interface ReconciliationIssue {
  code:
    | 'sin-campana-ekon'
    | 'periodo-no-cubierto'
    | 'periodo-parcial'
    | 'circuito-no-compatible'
    | 'soporte-liverpool-sin-circuito'
    | 'diferencia-tiendas'
    | 'conflicto-pendiente';
  message: string;
}

export interface ReconciliationResult {
  campaignName: string;
  ekonNumber: string;
  status: ReconciliationStatus;
  ekonExists: boolean;
  /** Productos Ekon distintos (informativo). */
  productos: string[];
  ratio: EkonRatio | null;
  requiresTestigos: boolean;
  coverage: CoverageStatus;
  /** Alcance administrativo puro: todas las líneas vigentes son determinante 0. */
  administrativeScope: boolean;
  /** Circuitos Ekon presentes y si tienen soporte Liverpool compatible. */
  circuitMatches: {
    circuito: string;
    compatible: boolean;
    supports: string[];
  }[];
  stores: {
    applies: boolean;
    ekonOnly: string[];
    liverpoolOnly: string[];
    common: string[];
  };
  issues: ReconciliationIssue[];
  /** Estados por asignación relevantes (conflictos/cambios) presentes. */
  pendingConflicts: number;
}

/** Une intervalos `[inicio, fin]` civiles y comprueba si cubren `[start, end]`. */
function coverageOf(
  start: string,
  end: string,
  intervals: { inicio: string; fin: string }[],
): CoverageStatus {
  if (!start || !end) return 'unknown';
  const valid = intervals
    .filter((i) => i.inicio && i.fin)
    .sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0));
  if (valid.length === 0) return 'uncovered';

  // Fusiona intervalos solapados o contiguos (día siguiente).
  const merged: { inicio: string; fin: string }[] = [];
  for (const iv of valid) {
    const last = merged[merged.length - 1];
    if (last && dayDiff(last.fin, iv.inicio) <= 1) {
      if (iv.fin > last.fin) last.fin = iv.fin;
    } else {
      merged.push({ ...iv });
    }
  }
  // ¿Existe un bloque fusionado que contenga [start, end]?
  const fullyCovered = merged.some((m) => m.inicio <= start && m.fin >= end);
  if (fullyCovered) return 'covered';
  // ¿Hay algún solapamiento parcial?
  const overlaps = merged.some((m) => m.inicio <= end && m.fin >= start);
  return overlaps ? 'partial' : 'uncovered';
}

/** Diferencia en días civiles entre dos fechas `AAAA-MM-DD` (later - earlier). */
function dayDiff(earlier: string, later: string): number {
  const e = Date.parse(`${earlier}T00:00:00Z`);
  const l = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(e) || Number.isNaN(l)) return Number.POSITIVE_INFINITY;
  return Math.round((l - e) / 86400000);
}

/**
 * Concilia una campaña Liverpool contra sus asignaciones Ekon vigentes. Las
 * `assignments` que recibe deben ser SOLO las vigentes del número Ekon vinculado
 * (el llamador filtra por número y estado activo).
 */
export function reconcileCampaign(
  campaign: ReconCampaignInput,
  ekonNumber: string,
  assignments: readonly EkonAssignment[],
): ReconciliationResult {
  const issues: ReconciliationIssue[] = [];
  const ekonExists = assignments.length > 0;

  if (!ekonExists) {
    issues.push({
      code: 'sin-campana-ekon',
      message: `No se encontraron asignaciones Ekon vigentes para el número ${ekonNumber}.`,
    });
    return {
      campaignName: campaign.name,
      ekonNumber,
      status: 'sin-campana-ekon',
      ekonExists: false,
      productos: [],
      ratio: null,
      requiresTestigos: false,
      coverage: 'unknown',
      administrativeScope: false,
      circuitMatches: [],
      stores: { applies: false, ekonOnly: [], liverpoolOnly: [], common: [] },
      issues,
      pendingConflicts: 0,
    };
  }

  const pendingConflicts = assignments.filter((a) => a.conflict).length;
  if (pendingConflicts > 0) {
    issues.push({
      code: 'conflicto-pendiente',
      message: `${pendingConflicts} asignación(es) en conflicto pendientes de revisión.`,
    });
  }

  const productos = [
    ...new Set(assignments.map((a) => a.producto).filter(Boolean)),
  ];
  const classification = classifyCampaign(
    assignments.map((a) => a.tipoCampaña),
  );

  // Cobertura de periodos (fechas exactas Liverpool vs periodos Ekon).
  const intervals = assignments
    .filter((a) => a.inicioPeriodo && a.finPeriodo)
    .map((a) => ({ inicio: a.inicioPeriodo!, fin: a.finPeriodo! }));
  const coverage = coverageOf(
    campaign.fechaInicio,
    campaign.fechaFin,
    intervals,
  );
  if (coverage === 'uncovered') {
    issues.push({
      code: 'periodo-no-cubierto',
      message: 'Los periodos Ekon vigentes no cubren las fechas Liverpool.',
    });
  } else if (coverage === 'partial') {
    issues.push({
      code: 'periodo-parcial',
      message: 'Los periodos Ekon cubren parcialmente las fechas Liverpool.',
    });
  }

  // Circuitos Ekon vs soportes Liverpool (mapeo autorizado).
  const liverpoolSupports = campaign.supports.map((s) => s.support);
  const circuits = [...new Set(assignments.map((a) => a.articulo))];
  const circuitMatches = circuits.map((circuito) => {
    const compatible = liverpoolSupports.filter((s) =>
      isCompatibleSupport(circuito, s),
    );
    return {
      circuito,
      compatible: compatible.length > 0,
      supports: compatible,
    };
  });
  const anyIncompatible = circuitMatches.some((c) => !c.compatible);
  if (anyIncompatible) {
    issues.push({
      code: 'circuito-no-compatible',
      message:
        'Al menos un circuito Ekon no tiene soporte Liverpool compatible en la campaña.',
    });
  }

  // Tiendas: solo determinantes físicos (excluye Centro Administrativo = 0).
  const physical = assignments.filter((a) => !a.centroAdministrativo);
  const administrativeScope = physical.length === 0;
  let stores = {
    applies: false,
    ekonOnly: [] as string[],
    liverpoolOnly: [] as string[],
    common: [] as string[],
  };
  if (!administrativeScope) {
    const ekonStores = new Set(physical.map((a) => a.determinanteKey));
    // Tiendas Liverpool de soportes compatibles con algún circuito Ekon.
    const liverpoolStores = new Set<string>();
    for (const support of campaign.supports) {
      const compatible = circuits.some((c) =>
        isCompatibleSupport(c, support.support),
      );
      if (!compatible) continue;
      for (const store of support.stores) {
        liverpoolStores.add(normalizeStoreNumber(store.numero));
      }
    }
    const ekonOnly = [...ekonStores]
      .filter((s) => !liverpoolStores.has(s))
      .sort();
    const liverpoolOnly = [...liverpoolStores]
      .filter((s) => !ekonStores.has(s))
      .sort();
    const common = [...ekonStores].filter((s) => liverpoolStores.has(s)).sort();
    stores = { applies: true, ekonOnly, liverpoolOnly, common };
    if (ekonOnly.length > 0 || liverpoolOnly.length > 0) {
      issues.push({
        code: 'diferencia-tiendas',
        message: `Diferencias de tiendas: ${ekonOnly.length} solo Ekon, ${liverpoolOnly.length} solo Liverpool.`,
      });
    }
  }

  return {
    campaignName: campaign.name,
    ekonNumber,
    status: deriveStatus({
      administrativeScope,
      coverage,
      anyIncompatible,
      storeDiff:
        stores.applies &&
        (stores.ekonOnly.length > 0 || stores.liverpoolOnly.length > 0),
      pendingConflicts,
      anyWarning: issues.length > 0,
    }),
    ekonExists: true,
    productos,
    ratio: classification.ratio,
    requiresTestigos: classification.requiresTestigos,
    coverage,
    administrativeScope,
    circuitMatches,
    stores,
    issues,
    pendingConflicts,
  };
}

function deriveStatus(flags: {
  administrativeScope: boolean;
  coverage: CoverageStatus;
  anyIncompatible: boolean;
  storeDiff: boolean;
  pendingConflicts: number;
  anyWarning: boolean;
}): ReconciliationStatus {
  if (flags.pendingConflicts > 0) return 'cambio-pendiente';
  if (flags.coverage === 'uncovered') return 'periodo-no-cubierto';
  if (flags.anyIncompatible) return 'circuito-no-compatible';
  if (flags.storeDiff) return 'diferencia-tiendas';
  if (flags.administrativeScope && !flags.anyWarning)
    return 'centro-administrativo';
  if (flags.anyWarning) return 'conciliada-con-advertencias';
  return 'conciliada';
}

/** Etiqueta legible de un estado de conciliación (para la UI). */
export function reconciliationStatusLabel(
  status: ReconciliationStatus,
): string {
  switch (status) {
    case 'conciliada':
      return 'Conciliada';
    case 'conciliada-con-advertencias':
      return 'Conciliada con advertencias';
    case 'sin-campana-ekon':
      return 'Sin campaña Ekon encontrada';
    case 'periodo-no-cubierto':
      return 'Periodo no cubierto';
    case 'circuito-no-compatible':
      return 'Circuito no compatible';
    case 'diferencia-tiendas':
      return 'Diferencia de tiendas';
    case 'centro-administrativo':
      return 'Centro Administrativo / tiendas no aplican';
    case 'cambio-pendiente':
      return 'Cambio pendiente de revisión';
  }
}
