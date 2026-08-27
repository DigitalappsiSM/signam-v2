import {
  consolidate,
  normalizeStore,
} from '@/modules/consolidation/consolidate';
import type { AdmiraScreen } from '@/domain';
import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type {
  CampaignOperationalTracking,
  Classification,
  TrackingLifecycleStatus,
} from './types';
import { classifyFromTipo } from './campaignClassification';
import { downloadLinkStatus, type DownloadLinkStatus } from './downloadLink';
import { witnessStartTarget } from './witnessTarget';
import {
  parseCampaignDate,
  fifthBusinessDay,
  compareCivil,
} from './businessDays';
import {
  witnessStartStatus,
  witnessCompleteStatus,
  STATUS_SEVERITY,
  type WitnessStatus,
} from './operationalStatus';

/**
 * Modelo de vista del seguimiento operativo (puro). Reúne, para cada campaña,
 * la clasificación, el estado del link, las tiendas realmente consolidadas, el
 * objetivo del 10%, los estados de los testigos y el próximo vencimiento.
 *
 * Consolida el conjunto **una sola vez** (evita N+1) y deriva todo lo demás en
 * memoria. No hace escrituras.
 */

export type Timeframe = 'upcoming' | 'active' | 'finished';

export interface TrackingRow {
  campaign: StoredCampaign;
  /**
   * Huella de vista (todos los datos): distingue dos "flights" homónimos y
   * mantiene compatibilidad con deep links legacy. La llave persistente del
   * seguimiento es `campaign.id`; `campaign.nameKey` se reserva para CSV.
   */
  identity: string;
  tracking: CampaignOperationalTracking | null;
  classification: Classification | 'unknown';
  /**
   * Ciclo de vida operativo. `cancelled` exime a la campaña de todos los checks,
   * alertas y vencimientos operativos (ver `criticalAlerts`/`isFullyTracked` y el
   * resumen del Dashboard). Los documentos legacy sin estado se leen como `active`.
   */
  lifecycleStatus: TrackingLifecycleStatus;
  linkStatus: DownloadLinkStatus;
  distinctStores: number;
  target: number;
  startStatus: WitnessStatus;
  completeStatus: WitnessStatus;
  overall: WitnessStatus;
  nextDeadline: Date | null;
  timeframe: Timeframe;
}

function timeframeOf(
  start: Date | null,
  end: Date | null,
  today: Date,
): Timeframe {
  if (end && compareCivil(end, today) < 0) return 'finished';
  if (start && compareCivil(start, today) > 0) return 'upcoming';
  return 'active';
}

/**
 * Colapsa documentos **idénticos** por identidad (todos los datos); conserva el
 * orden de aparición. Dos campañas con el mismo nombre pero distinta
 * vigencia/tiendas tienen identidades distintas y se conservan como filas
 * separadas (cada una con su propio seguimiento).
 */
function dedupeByIdentity(
  campaigns: readonly StoredCampaign[],
): StoredCampaign[] {
  const seen = new Set<string>();
  const out: StoredCampaign[] = [];
  for (const c of campaigns) {
    const id = campaignIdentity(c);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

export function buildTrackingRows(
  campaigns: readonly StoredCampaign[],
  screens: readonly AdmiraScreen[],
  tracking: readonly CampaignOperationalTracking[],
  today: Date,
): TrackingRow[] {
  const screenStore = new Map<string, string>();
  for (const s of screens) {
    screenStore.set(s.id, normalizeStore(s.original['Numero de Tienda']));
  }
  const trackingByCampaignId = new Map<string, CampaignOperationalTracking>();
  const legacyTrackingByKey = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) {
    if (t.campaignId) trackingByCampaignId.set(t.campaignId, t);
    else legacyTrackingByKey.set(t.campaignNameKey, t);
  }

  // Una fila por identidad de campaña (todos los datos): dos "flights" del mismo
  // nombre son filas separadas. El conteo de tiendas se calcula **por campaña**
  // (consolidando cada una por separado) para no mezclar los datos de otra
  // campaña con el mismo nombre; la consolidación/CSV global no se altera.
  return dedupeByIdentity(campaigns).map((campaign) => {
    const identity = campaignIdentity(campaign);
    const t =
      trackingByCampaignId.get(campaign.id) ??
      legacyTrackingByKey.get(identity) ??
      null;
    const classification: Classification | 'unknown' = t
      ? t.classification
      : classifyFromTipo(campaign.tipo);
    // Documentos legacy sin ciclo de vida se interpretan como `active`.
    const lifecycleStatus: TrackingLifecycleStatus =
      t?.lifecycleStatus === 'cancelled' ? 'cancelled' : 'active';
    const cancelled = lifecycleStatus === 'cancelled';

    const stores = new Set<string>();
    for (const cn of consolidate([campaign], screens).consolidations) {
      for (const id of cn.screenIds) {
        const store = screenStore.get(id);
        if (store) stores.add(store);
      }
    }
    const distinctStores = stores.size;

    // Los testigos (T Arranque / T Completos) sólo aplican a **Proveedor**. Las
    // campañas Institucional no los requieren, y las de clasificación **pendiente**
    // no asumen ningún régimen hasta que el usuario clasifique: en ambos casos los
    // testigos quedan como `not-applicable` (sin estados, vencimientos ni alertas).
    // Se deriva de la clasificación efectiva, no de las casillas de la interfaz.
    const witnessesApplicable = classification === 'provider';

    const start = t?.witnessStart ?? null;
    const complete = t?.witnessComplete ?? null;
    const startStatus: WitnessStatus = witnessesApplicable
      ? witnessStartStatus({
          startStr: campaign.fechaInicio,
          endStr: campaign.fechaFin,
          completed: start?.completed ?? false,
          completedAt: start?.completedAt ?? null,
          today,
        })
      : 'not-applicable';
    const completeStatus: WitnessStatus = witnessesApplicable
      ? witnessCompleteStatus({
          startStr: campaign.fechaInicio,
          endStr: campaign.fechaFin,
          completed: complete?.completed ?? false,
          completedAt: complete?.completedAt ?? null,
          today,
        })
      : 'not-applicable';
    const overall: WitnessStatus = witnessesApplicable
      ? STATUS_SEVERITY[startStatus] <= STATUS_SEVERITY[completeStatus]
        ? startStatus
        : completeStatus
      : 'not-applicable';

    const startCivil = parseCampaignDate(campaign.fechaInicio);
    const endCivil = parseCampaignDate(campaign.fechaFin);
    const deadlines: Date[] = [];
    // Ni las campañas canceladas ni las Institucional (testigos no aplicables)
    // tienen vencimientos de testigos: no se calcula el 5.º día hábil ni se toma
    // `fechaFin` como vencimiento de T Completos.
    if (!cancelled && witnessesApplicable) {
      if (!(start?.completed ?? false) && startCivil) {
        deadlines.push(fifthBusinessDay(startCivil));
      }
      if (!(complete?.completed ?? false) && endCivil) deadlines.push(endCivil);
      deadlines.sort((a, b) => a.getTime() - b.getTime());
    }

    return {
      campaign,
      identity,
      tracking: t,
      classification,
      lifecycleStatus,
      linkStatus: downloadLinkStatus(campaign.link),
      distinctStores,
      target: witnessStartTarget(distinctStores),
      startStatus,
      completeStatus,
      overall,
      nextDeadline: deadlines[0] ?? null,
      timeframe: timeframeOf(startCivil, endCivil, today),
    };
  });
}

/**
 * Valores efectivos de los checks (usa el doc, o los valores por defecto).
 *
 * - `link`: si el usuario lo sobrescribió manualmente, manda su valor; si no, se
 *   deriva del link del calendario (por defecto automático, editable).
 * - `liverpool`: por defecto marcado si es Institucional **o** hay link válido.
 * - `witnessStart` / `witnessComplete`: para las campañas Institucional los
 *   testigos **no aplican**, por lo que su valor efectivo es `true` (obligación
 *   satisfecha) sólo para los cálculos agregados (p. ej. `isFullyTracked`). Esto
 *   NO significa que estén completados ni debe persistirse como tal: los valores
 *   históricos permanecen intactos y reaparecen si la campaña vuelve a Proveedor.
 */
export function effectiveChecks(row: TrackingRow): {
  link: boolean;
  liverpool: boolean;
  csm: boolean;
  witnessStart: boolean;
  witnessComplete: boolean;
} {
  const t = row.tracking;
  const linkValid = row.linkStatus === 'valid';
  const institutional = row.classification === 'institutional';
  const link =
    t && t.linkDownload && t.linkDownload.source === 'manual'
      ? t.linkDownload.completed
      : linkValid;
  return {
    link,
    liverpool: t ? t.liverpoolValidation.completed : institutional || linkValid,
    csm: t ? t.csmProgramming.completed : false,
    witnessStart: institutional ? true : t ? t.witnessStart.completed : false,
    witnessComplete: institutional
      ? true
      : t
        ? t.witnessComplete.completed
        : false,
  };
}

export type AlertKind =
  | 'start-overdue'
  | 'complete-overdue'
  | 'no-link'
  | 'invalid-date'
  | 'active-no-csm'
  | 'provider-no-validation'
  | 'classification-pending'
  | 'finished-pending';

export interface RowAlert {
  kind: AlertKind;
  label: string;
}

/**
 * ¿La fila participa en los cálculos operativos (checks, alertas, vencimientos)?
 * Una campaña cancelada queda fuera de todo el resumen operativo del Dashboard.
 */
export function isOperationallyApplicable(row: TrackingRow): boolean {
  return row.lifecycleStatus !== 'cancelled';
}

/** Alertas críticas de una campaña (§12.B). Vacío = sin alertas críticas. */
export function criticalAlerts(row: TrackingRow): RowAlert[] {
  // Una campaña cancelada nunca genera alertas críticas.
  if (row.lifecycleStatus === 'cancelled') return [];
  const c = effectiveChecks(row);
  const out: RowAlert[] = [];
  if (row.startStatus === 'overdue') {
    out.push({ kind: 'start-overdue', label: 'T Arranque vencido' });
  }
  if (row.completeStatus === 'overdue') {
    out.push({ kind: 'complete-overdue', label: 'T Completos vencido' });
  }
  // Se basa en el check EFECTIVO del link (`c.link`), no en el link crudo del
  // calendario: si el calendario de Liverpool no trae URL pero el link se obtuvo
  // por fuera (p. ej. por correo) y el usuario marcó la casilla "Link" en el
  // seguimiento operativo (`source: 'manual'`), la campaña ya tiene link y no debe
  // alertar. A la inversa, desmarcarlo manualmente sí dispara la alerta aunque el
  // calendario traiga URL.
  if ((row.timeframe === 'active' || row.timeframe === 'upcoming') && !c.link) {
    out.push({ kind: 'no-link', label: 'Sin link válido' });
  }
  if (
    row.startStatus === 'invalid-date' ||
    row.completeStatus === 'invalid-date'
  ) {
    out.push({ kind: 'invalid-date', label: 'Fechas inválidas' });
  }
  if (row.timeframe === 'active' && !c.csm) {
    out.push({ kind: 'active-no-csm', label: 'Activa sin Programación CSM' });
  }
  // Una campaña **terminada** debe tener completos sus indicadores APLICABLES.
  // Antes, la señal de "terminada con pendientes" venía del vencimiento de los
  // testigos; para Institucional ya no aplican, así que se detecta directamente
  // por los indicadores aplicables incompletos (Link/Validación/CSM; para
  // Proveedor incluye además los testigos vía `effectiveChecks`). Se omite cuando
  // ya hay un testigo vencido (Proveedor) para no duplicar la alerta, y cuando la
  // clasificación está pendiente (ya la señala `classification-pending`).
  const applicableComplete =
    c.link && c.liverpool && c.csm && c.witnessStart && c.witnessComplete;
  if (
    row.timeframe === 'finished' &&
    row.classification !== 'unknown' &&
    !applicableComplete &&
    row.startStatus !== 'overdue' &&
    row.completeStatus !== 'overdue'
  ) {
    out.push({ kind: 'finished-pending', label: 'Terminada con pendientes' });
  }
  if (row.classification === 'provider' && !c.liverpool) {
    out.push({
      kind: 'provider-no-validation',
      label: 'Proveedor sin Validación Liverpool',
    });
  }
  if (row.classification === 'unknown') {
    out.push({
      kind: 'classification-pending',
      label: 'Clasificación pendiente',
    });
  }
  return out;
}

/** Severidad global de la fila (menor = más urgente) para ordenar alertas. */
export function rowSeverity(row: TrackingRow): number {
  return STATUS_SEVERITY[row.overall];
}

/** ¿La campaña activa está completamente al día (sin pendientes ni alertas)? */
export function isFullyTracked(row: TrackingRow): boolean {
  // Una campaña cancelada no se considera "seguimiento completo".
  if (row.lifecycleStatus === 'cancelled') return false;
  const c = effectiveChecks(row);
  return c.link && c.liverpool && c.csm && c.witnessStart && c.witnessComplete;
}
