import {
  consolidate,
  normalizeStore,
} from '@/modules/consolidation/consolidate';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking, Classification } from './types';
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
  tracking: CampaignOperationalTracking | null;
  classification: Classification | 'unknown';
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
 * Colapsa documentos **idénticos** (misma identidad `nameKey` = todos los datos);
 * conserva el orden de aparición. Dos campañas con el mismo nombre pero distinta
 * vigencia/tiendas tienen identidades distintas y se conservan como filas
 * separadas (cada una con su propio seguimiento).
 */
function dedupeByIdentity(
  campaigns: readonly StoredCampaign[],
): StoredCampaign[] {
  const seen = new Set<string>();
  const out: StoredCampaign[] = [];
  for (const c of campaigns) {
    if (seen.has(c.nameKey)) continue;
    seen.add(c.nameKey);
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
  const trackingByKey = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) trackingByKey.set(t.campaignNameKey, t);

  // Una fila por identidad de campaña (todos los datos): dos "flights" del mismo
  // nombre son filas separadas. El conteo de tiendas se calcula **por campaña**
  // (consolidando cada una por separado) para no mezclar los datos de otra
  // campaña con el mismo nombre; la consolidación/CSV global no se altera.
  return dedupeByIdentity(campaigns).map((campaign) => {
    const t = trackingByKey.get(campaign.nameKey) ?? null;
    const classification: Classification | 'unknown' = t
      ? t.classification
      : classifyFromTipo(campaign.tipo);

    const stores = new Set<string>();
    for (const cn of consolidate([campaign], screens).consolidations) {
      for (const id of cn.screenIds) {
        const store = screenStore.get(id);
        if (store) stores.add(store);
      }
    }
    const distinctStores = stores.size;

    const start = t?.witnessStart ?? null;
    const complete = t?.witnessComplete ?? null;
    const startStatus = witnessStartStatus({
      startStr: campaign.fechaInicio,
      endStr: campaign.fechaFin,
      completed: start?.completed ?? false,
      completedAt: start?.completedAt ?? null,
      today,
    });
    const completeStatus = witnessCompleteStatus({
      startStr: campaign.fechaInicio,
      endStr: campaign.fechaFin,
      completed: complete?.completed ?? false,
      completedAt: complete?.completedAt ?? null,
      today,
    });
    const overall =
      STATUS_SEVERITY[startStatus] <= STATUS_SEVERITY[completeStatus]
        ? startStatus
        : completeStatus;

    const startCivil = parseCampaignDate(campaign.fechaInicio);
    const endCivil = parseCampaignDate(campaign.fechaFin);
    const deadlines: Date[] = [];
    if (!(start?.completed ?? false) && startCivil) {
      deadlines.push(fifthBusinessDay(startCivil));
    }
    if (!(complete?.completed ?? false) && endCivil) deadlines.push(endCivil);
    deadlines.sort((a, b) => a.getTime() - b.getTime());

    return {
      campaign,
      tracking: t,
      classification,
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
  const link =
    t && t.linkDownload && t.linkDownload.source === 'manual'
      ? t.linkDownload.completed
      : linkValid;
  return {
    link,
    liverpool: t
      ? t.liverpoolValidation.completed
      : row.classification === 'institutional' || linkValid,
    csm: t ? t.csmProgramming.completed : false,
    witnessStart: t ? t.witnessStart.completed : false,
    witnessComplete: t ? t.witnessComplete.completed : false,
  };
}

export type AlertKind =
  | 'start-overdue'
  | 'complete-overdue'
  | 'no-link'
  | 'invalid-date'
  | 'active-no-csm'
  | 'provider-no-validation'
  | 'classification-pending';

export interface RowAlert {
  kind: AlertKind;
  label: string;
}

/** Alertas críticas de una campaña (§12.B). Vacío = sin alertas críticas. */
export function criticalAlerts(row: TrackingRow): RowAlert[] {
  const c = effectiveChecks(row);
  const out: RowAlert[] = [];
  if (row.startStatus === 'overdue') {
    out.push({ kind: 'start-overdue', label: 'T Arranque vencido' });
  }
  if (row.completeStatus === 'overdue') {
    out.push({ kind: 'complete-overdue', label: 'T Completos vencido' });
  }
  if (
    (row.timeframe === 'active' || row.timeframe === 'upcoming') &&
    row.linkStatus !== 'valid'
  ) {
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
  const c = effectiveChecks(row);
  return c.link && c.liverpool && c.csm && c.witnessStart && c.witnessComplete;
}
