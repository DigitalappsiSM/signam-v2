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
  supports: {
    support: string;
    stores: { numero: string; nombre?: string }[];
  }[];
}

/** Cobertura de las fechas Liverpool por los periodos Ekon vigentes. */
export type CoverageStatus = 'covered' | 'partial' | 'uncovered' | 'unknown';

/** Estado global de conciliación de una campaña. */
export type ReconciliationStatus =
  | 'conciliada'
  | 'conciliada-con-advertencias'
  | 'sin-campana-ekon'
  | 'periodo-no-cubierto'
  | 'periodo-parcial'
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
    | 'diferencia-tienda-soporte'
    | 'conflicto-pendiente';
  message: string;
}

export type StoreReconciliationStatus =
  'matched' | 'liverpool-only' | 'ekon-only' | 'support-mismatch';

/** Comparación operativa de una tienda y su cobertura de soportes/circuitos. */
export interface StoreReconciliationDetail {
  storeNumber: string;
  status: StoreReconciliationStatus;
  liverpool: {
    present: boolean;
    names: string[];
    supports: string[];
    unmatchedSupports: string[];
  };
  ekon: {
    present: boolean;
    names: string[];
    circuits: string[];
    unmatchedCircuits: string[];
  };
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
  /** Soportes Liverpool presentes y los circuitos Ekon compatibles. */
  supportMatches: {
    support: string;
    compatible: boolean;
    circuits: string[];
  }[];
  stores: {
    applies: boolean;
    ekonOnly: string[];
    liverpoolOnly: string[];
    common: string[];
    details: StoreReconciliationDetail[];
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
      supportMatches: [],
      stores: {
        applies: false,
        ekonOnly: [],
        liverpoolOnly: [],
        common: [],
        details: [],
      },
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

  // Los conflictos se reportan, pero nunca participan como datos válidos en la
  // cobertura, circuitos o tiendas de la conciliación.
  const comparable = assignments.filter((a) => !a.conflict);

  const productos = [
    ...new Set(comparable.map((a) => a.producto).filter(Boolean)),
  ];
  const classification = classifyCampaign(comparable.map((a) => a.tipoCampaña));

  // Cobertura de periodos (fechas exactas Liverpool vs periodos Ekon).
  const intervals = comparable
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
  const circuits = [
    ...new Set(comparable.map((a) => a.circuito || a.articulo)),
  ];
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
  if (circuitMatches.some((c) => !c.compatible)) {
    issues.push({
      code: 'circuito-no-compatible',
      message:
        'Al menos un circuito Ekon no tiene soporte Liverpool compatible en la campaña.',
    });
  }

  const supportMatches = [...new Set(liverpoolSupports)].map((support) => {
    const compatible = circuits.filter((c) => isCompatibleSupport(c, support));
    return {
      support,
      compatible: compatible.length > 0,
      circuits: compatible,
    };
  });
  const anyUnsupportedLiverpool = supportMatches.some((s) => !s.compatible);
  if (anyUnsupportedLiverpool) {
    issues.push({
      code: 'soporte-liverpool-sin-circuito',
      message:
        'Al menos un soporte Liverpool no tiene circuito Ekon compatible en la campaña.',
    });
  }

  // Tiendas: solo determinantes físicos (excluye Centro Administrativo = 0).
  const physical = comparable.filter((a) => !a.centroAdministrativo);
  const administrativeScope = comparable.length > 0 && physical.length === 0;
  let stores = {
    applies: false,
    ekonOnly: [] as string[],
    liverpoolOnly: [] as string[],
    common: [] as string[],
    details: [] as StoreReconciliationDetail[],
  };
  if (!administrativeScope) {
    const ekonByStore = new Map<
      string,
      { names: Set<string>; circuits: Set<string> }
    >();
    for (const assignment of physical) {
      const current = ekonByStore.get(assignment.determinanteKey) ?? {
        names: new Set<string>(),
        circuits: new Set<string>(),
      };
      if (assignment.tienda) current.names.add(assignment.tienda);
      current.circuits.add(assignment.circuito || assignment.articulo);
      ekonByStore.set(assignment.determinanteKey, current);
    }

    // Se incluyen TODOS los soportes y tiendas Liverpool. La compatibilidad se
    // evalúa después, por tienda, para no ocultar un doble problema.
    const liverpoolByStore = new Map<
      string,
      { names: Set<string>; supports: Set<string> }
    >();
    for (const support of campaign.supports) {
      for (const store of support.stores) {
        const number = normalizeStoreNumber(store.numero);
        const current = liverpoolByStore.get(number) ?? {
          names: new Set<string>(),
          supports: new Set<string>(),
        };
        if (store.nombre) current.names.add(store.nombre);
        current.supports.add(support.support);
        liverpoolByStore.set(number, current);
      }
    }

    const storeNumbers = [
      ...new Set([...liverpoolByStore.keys(), ...ekonByStore.keys()]),
    ].sort(compareStoreNumbers);
    const details = storeNumbers.map<StoreReconciliationDetail>((number) => {
      const liverpool = liverpoolByStore.get(number);
      const ekon = ekonByStore.get(number);
      const supports = [...(liverpool?.supports ?? [])].sort();
      const ekonCircuits = [...(ekon?.circuits ?? [])].sort();
      const unmatchedSupports = supports.filter(
        (support) =>
          !ekonCircuits.some((circuit) =>
            isCompatibleSupport(circuit, support),
          ),
      );
      const unmatchedCircuits = ekonCircuits.filter(
        (circuit) =>
          !supports.some((support) => isCompatibleSupport(circuit, support)),
      );
      let status: StoreReconciliationStatus = 'matched';
      if (!ekon) status = 'liverpool-only';
      else if (!liverpool) status = 'ekon-only';
      else if (unmatchedSupports.length > 0 || unmatchedCircuits.length > 0)
        status = 'support-mismatch';
      return {
        storeNumber: number,
        status,
        liverpool: {
          present: Boolean(liverpool),
          names: [...(liverpool?.names ?? [])].sort(),
          supports,
          unmatchedSupports,
        },
        ekon: {
          present: Boolean(ekon),
          names: [...(ekon?.names ?? [])].sort(),
          circuits: ekonCircuits,
          unmatchedCircuits,
        },
      };
    });
    const ekonOnly = details
      .filter((d) => d.status === 'ekon-only')
      .map((d) => d.storeNumber);
    const liverpoolOnly = details
      .filter((d) => d.status === 'liverpool-only')
      .map((d) => d.storeNumber);
    const common = details
      .filter((d) => d.liverpool.present && d.ekon.present)
      .map((d) => d.storeNumber);
    stores = { applies: true, ekonOnly, liverpoolOnly, common, details };
    if (ekonOnly.length > 0 || liverpoolOnly.length > 0) {
      issues.push({
        code: 'diferencia-tiendas',
        message: `Diferencias de tiendas: ${ekonOnly.length} solo Ekon, ${liverpoolOnly.length} solo Liverpool.`,
      });
    }
    const supportMismatches = details.filter(
      (d) => d.status === 'support-mismatch',
    );
    if (supportMismatches.length > 0) {
      issues.push({
        code: 'diferencia-tienda-soporte',
        message: `${supportMismatches.length} tienda(s) tienen soportes o circuitos sin correspondencia compatible.`,
      });
    }
  }

  return {
    campaignName: campaign.name,
    ekonNumber,
    status: deriveStatus({
      administrativeScope,
      coverage,
      anyIncompatible: anyIncompatible || anyUnsupportedLiverpool,
      storeDiff:
        stores.applies &&
        stores.details.some((store) => store.status !== 'matched'),
      pendingConflicts,
      anyWarning: issues.length > 0,
    }),
    ekonExists: true,
    productos,
    ratio: comparable.length > 0 ? classification.ratio : null,
    requiresTestigos:
      comparable.length > 0 ? classification.requiresTestigos : false,
    coverage,
    administrativeScope,
    circuitMatches,
    supportMatches,
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
  if (flags.coverage === 'partial') return 'periodo-parcial';
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
    case 'periodo-parcial':
      return 'Periodo cubierto parcialmente';
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

function compareStoreNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}
