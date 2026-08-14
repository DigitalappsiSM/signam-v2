import type {
  EkonAssignment,
  EkonChangeState,
  EkonRevisionEvent,
  StoredEkonAssignment,
} from './models';

/**
 * Detección de cambios y estados de las asignaciones Ekon entre importaciones.
 *
 * Compara las asignaciones vigentes previas contra las del nuevo lote, dentro
 * del ALCANCE de periodos confirmado. Produce un plan puro (estado nuevo +
 * revisiones a registrar) que el servicio persiste. No borra historial ni
 * mueve asociaciones.
 */

/**
 * Campos relevantes para conciliación/versionado. Cambios aquí producen
 * `Modificada`. Los campos comerciales (importe, facturas, comprador, cliente,
 * comercial, contrato, caras) NO forman parte del fingerprint.
 */
export const FINGERPRINT_FIELDS = [
  'producto',
  'tipoCampaña',
  'circuito',
  'codigoCentro',
  'tienda',
  'idPeriodo',
  'inicioPeriodo',
  'finPeriodo',
  'familia',
  'centroAdministrativo',
] as const;

/** Fingerprint determinístico de los campos relevantes de una asignación. */
export function assignmentFingerprint(a: EkonAssignment): string {
  return JSON.stringify({
    producto: a.producto,
    tipoCampaña: a.tipoCampaña,
    circuito: a.circuito,
    codigoCentro: a.codigoCentro,
    tienda: a.tienda,
    idPeriodo: a.idPeriodo,
    inicioPeriodo: a.inicioPeriodo,
    finPeriodo: a.finPeriodo,
    familia: a.familia,
    centroAdministrativo: a.centroAdministrativo,
  });
}

/** Devuelve los campos relevantes que difieren entre dos asignaciones. */
export function changedFields(
  before: EkonAssignment,
  after: EkonAssignment,
): string[] {
  const changed: string[] = [];
  for (const field of FINGERPRINT_FIELDS) {
    if (before[field] !== after[field]) changed.push(field);
  }
  return changed;
}

/** Tipo de resaltado de un posible re-emparejamiento (no se consolida solo). */
export type EkonHighlightReason =
  'line-change' | 'determinante-change' | 'centro-administrativo-change';

/** Posible sustitución entre una asignación no incluida y una nueva. */
export interface EkonHighlight {
  reason: EkonHighlightReason;
  missingKey: string;
  newKey: string;
  message: string;
}

/** Entrada del diff: una asignación y su estado. */
export interface EkonDiffEntry {
  state: EkonChangeState;
  key: string;
  /** Estado resultante (vigente) o, para `no-incluida`, el previo inactivado. */
  after: StoredEkonAssignment;
  before: EkonAssignment | null;
  changedFields: string[];
  event: EkonRevisionEvent;
  periodChange: { from: string; to: string } | null;
}

/** Revisión a registrar (sin id/at/actor, que agrega el servicio). */
export interface EkonRevisionPlan {
  key: string;
  event: EkonRevisionEvent;
  before: EkonAssignment | null;
  after: EkonAssignment | null;
  changedFields: string[];
}

export interface EkonDiffResult {
  entries: EkonDiffEntry[];
  /** Estado vigente resultante (asignaciones activas e inactivas conservadas). */
  nextAssignments: StoredEkonAssignment[];
  revisions: EkonRevisionPlan[];
  highlights: EkonHighlight[];
  counts: Record<EkonChangeState, number>;
}

export interface DiffOptions {
  previous: readonly StoredEkonAssignment[];
  incoming: readonly EkonAssignment[];
  /** Periodos confirmados (ids). Las ausencias solo cuentan dentro de este set. */
  confirmedPeriods: ReadonlySet<string>;
  batchId: string;
}

function toStored(
  a: EkonAssignment,
  base: Partial<StoredEkonAssignment>,
  batchId: string,
  now: number,
): StoredEkonAssignment {
  return {
    ...a,
    fingerprint: assignmentFingerprint(a),
    active: base.active ?? true,
    firstBatchId: base.firstBatchId ?? batchId,
    lastBatchId: batchId,
    missingSinceBatchId: base.missingSinceBatchId ?? null,
    revision: base.revision ?? 1,
    updatedAt: now,
  };
}

/**
 * Calcula el diff entre el estado vigente previo y el lote entrante. Puro y
 * determinístico. `now` permite fijar los timestamps en pruebas.
 */
export function diffAssignments(
  options: DiffOptions,
  now = Date.now(),
): EkonDiffResult {
  const { previous, incoming, confirmedPeriods, batchId } = options;
  const prevByKey = new Map(previous.map((a) => [a.key, a]));
  const incomingByKey = new Map(incoming.map((a) => [a.key, a]));

  const entries: EkonDiffEntry[] = [];
  const revisions: EkonRevisionPlan[] = [];
  const nextAssignments: StoredEkonAssignment[] = [];
  const counts: Record<EkonChangeState, number> = {
    nueva: 0,
    'sin-cambios': 0,
    modificada: 0,
    'no-incluida': 0,
    restaurada: 0,
    conflicto: 0,
  };

  const record = (
    state: EkonChangeState,
    after: StoredEkonAssignment,
    before: EkonAssignment | null,
    event: EkonRevisionEvent,
    fields: string[],
    periodChange: { from: string; to: string } | null,
    withRevision: boolean,
  ) => {
    counts[state] += 1;
    entries.push({
      state,
      key: after.key,
      after,
      before,
      changedFields: fields,
      event,
      periodChange,
    });
    nextAssignments.push(after);
    if (withRevision) {
      revisions.push({
        key: after.key,
        event,
        before,
        after: state === 'no-incluida' ? before : after,
        changedFields: fields,
      });
    }
  };

  // 1) Recorre las asignaciones entrantes.
  for (const inc of incoming) {
    const prev = prevByKey.get(inc.key);

    // Conflicto de datos en el lote entrante: se conserva, no participa en
    // conciliación/fallback (el servicio la marca inactiva-conflicto).
    if (inc.conflict) {
      const stored = toStored(
        inc,
        {
          active: false,
          firstBatchId: prev?.firstBatchId,
          revision: prev ? prev.revision + 1 : 1,
        },
        batchId,
        now,
      );
      record(
        'conflicto',
        stored,
        prev ?? null,
        prev ? 'modified' : 'created',
        [],
        null,
        true,
      );
      continue;
    }

    if (!prev) {
      const stored = toStored(inc, {}, batchId, now);
      record('nueva', stored, null, 'created', [], null, true);
      continue;
    }

    // Reaparición de una asignación previamente no incluida → Restaurada.
    if (prev.active === false && prev.missingSinceBatchId) {
      const fields = changedFields(prev, inc);
      const periodChange =
        prev.idPeriodo !== inc.idPeriodo
          ? { from: prev.idPeriodo, to: inc.idPeriodo }
          : null;
      const stored = toStored(
        inc,
        {
          active: true,
          firstBatchId: prev.firstBatchId,
          missingSinceBatchId: null,
          revision: prev.revision + 1,
        },
        batchId,
        now,
      );
      record(
        'restaurada',
        stored,
        prev,
        'restored',
        fields,
        periodChange,
        true,
      );
      continue;
    }

    // Existente y vigente: sin cambios o modificada.
    const fingerprint = assignmentFingerprint(inc);
    if (fingerprint === prev.fingerprint) {
      const stored = toStored(
        inc,
        {
          active: true,
          firstBatchId: prev.firstBatchId,
          revision: prev.revision,
        },
        batchId,
        now,
      );
      record('sin-cambios', stored, prev, 'created', [], null, false);
      continue;
    }

    const fields = changedFields(prev, inc);
    const periodChange =
      prev.idPeriodo !== inc.idPeriodo
        ? { from: prev.idPeriodo, to: inc.idPeriodo }
        : null;
    const stored = toStored(
      inc,
      {
        active: true,
        firstBatchId: prev.firstBatchId,
        revision: prev.revision + 1,
      },
      batchId,
      now,
    );
    record(
      'modificada',
      stored,
      prev,
      periodChange ? 'period-change' : 'modified',
      fields,
      periodChange,
      true,
    );
  }

  // 2) Asignaciones previas ausentes del lote entrante.
  for (const prev of previous) {
    if (incomingByKey.has(prev.key)) continue;
    // Fuera del alcance confirmado: intacta (se conserva tal cual).
    if (!confirmedPeriods.has(prev.idPeriodo)) {
      nextAssignments.push(prev);
      continue;
    }
    // Ya estaba inactiva: se conserva sin nuevo evento.
    if (prev.active === false) {
      nextAssignments.push(prev);
      continue;
    }
    // Dentro del alcance y estaba vigente → No incluida (baja lógica).
    const stored: StoredEkonAssignment = {
      ...prev,
      active: false,
      missingSinceBatchId: batchId,
      lastBatchId: prev.lastBatchId,
      revision: prev.revision + 1,
      updatedAt: now,
    };
    record('no-incluida', stored, prev, 'missing', [], null, true);
  }

  const highlights = detectHighlights(entries);

  return { entries, nextAssignments, revisions, highlights, counts };
}

/**
 * Detecta posibles sustituciones entre asignaciones `no-incluida` y `nueva` que
 * comparten campaña y difieren solo en línea o determinante (incluye 0↔físico).
 * Es informativo: NO consolida ni mueve nada sin confirmación humana.
 */
function detectHighlights(entries: readonly EkonDiffEntry[]): EkonHighlight[] {
  const missing = entries
    .filter((e) => e.state === 'no-incluida')
    .map((e) => e.after);
  const created = entries
    .filter((e) => e.state === 'nueva')
    .map((e) => e.after);
  const highlights: EkonHighlight[] = [];

  for (const m of missing) {
    for (const n of created) {
      if (m.año !== n.año || m.campaña !== n.campaña) continue;
      const sameArticle = m.circuito === n.circuito;
      if (
        sameArticle &&
        m.determinanteKey === n.determinanteKey &&
        m.lineaCampaña !== n.lineaCampaña
      ) {
        highlights.push({
          reason: 'line-change',
          missingKey: m.key,
          newKey: n.key,
          message: `Posible cambio de línea en campaña ${m.campaña}: ${m.lineaCampaña} → ${n.lineaCampaña} (requiere confirmación).`,
        });
      } else if (
        sameArticle &&
        m.lineaCampaña === n.lineaCampaña &&
        m.determinanteKey !== n.determinanteKey
      ) {
        const zeroChange = m.centroAdministrativo !== n.centroAdministrativo;
        highlights.push({
          reason: zeroChange
            ? 'centro-administrativo-change'
            : 'determinante-change',
          missingKey: m.key,
          newKey: n.key,
          message: zeroChange
            ? `Cambio Centro Administrativo ↔ tienda física en campaña ${m.campaña} (determinante ${m.determinante} → ${n.determinante}).`
            : `Posible cambio de determinante en campaña ${m.campaña}: ${m.determinante} → ${n.determinante} (requiere confirmación).`,
        });
      }
    }
  }
  return highlights;
}
