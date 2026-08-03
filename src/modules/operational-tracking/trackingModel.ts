import {
  consolidate,
  normalizeStore,
  type Consolidation,
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
 * Colapsa campañas que comparten `nameKey` en una sola. El seguimiento operativo
 * es **por nombre de campaña** (un documento por `nameKey`, los checks y la
 * bitácora sobreviven a las reimportaciones), por lo que dos campañas con el
 * mismo nombre son la misma campaña operativa: mostrarlas como filas separadas
 * duplica la vista y acopla sus comentarios/indicadores. Se conserva el orden de
 * aparición y se toma el **span más amplio** (inicio más temprano, fin más
 * tardío) y el **mejor link** disponible.
 */
function dedupeByNameKey(
  campaigns: readonly StoredCampaign[],
): StoredCampaign[] {
  const groups = new Map<string, StoredCampaign[]>();
  const order: string[] = [];
  for (const c of campaigns) {
    const g = groups.get(c.nameKey);
    if (g) {
      g.push(c);
    } else {
      groups.set(c.nameKey, [c]);
      order.push(c.nameKey);
    }
  }
  return order.map((key) => {
    const group = groups.get(key)!;
    const rep = group[0]!;
    if (group.length === 1) return rep;
    let earliest = rep;
    let latest = rep;
    for (const c of group) {
      const s = parseCampaignDate(c.fechaInicio);
      const sBest = parseCampaignDate(earliest.fechaInicio);
      if (s && (!sBest || s.getTime() < sBest.getTime())) earliest = c;
      const e = parseCampaignDate(c.fechaFin);
      const eBest = parseCampaignDate(latest.fechaFin);
      if (e && (!eBest || e.getTime() > eBest.getTime())) latest = c;
    }
    const link =
      group.find((c) => downloadLinkStatus(c.link) === 'valid')?.link ??
      group.find((c) => c.link.trim() !== '')?.link ??
      rep.link;
    const tipo = group.find((c) => c.tipo.trim() !== '')?.tipo ?? rep.tipo;
    return {
      ...rep,
      fechaInicio: earliest.fechaInicio,
      fechaFin: latest.fechaFin,
      link,
      tipo,
    };
  });
}

export function buildTrackingRows(
  campaigns: readonly StoredCampaign[],
  screens: readonly AdmiraScreen[],
  tracking: readonly CampaignOperationalTracking[],
  today: Date,
): TrackingRow[] {
  const result = consolidate(campaigns, screens);
  const consByCampaign = new Map<string, Consolidation[]>();
  for (const c of result.consolidations) {
    const list = consByCampaign.get(c.campaignName) ?? [];
    list.push(c);
    consByCampaign.set(c.campaignName, list);
  }
  const screenStore = new Map<string, string>();
  for (const s of screens) {
    screenStore.set(s.id, normalizeStore(s.original['Numero de Tienda']));
  }
  const trackingByKey = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) trackingByKey.set(t.campaignNameKey, t);

  // Una fila por campaña (por nombre): colapsa duplicados con el mismo nameKey.
  return dedupeByNameKey(campaigns).map((campaign) => {
    const t = trackingByKey.get(campaign.nameKey) ?? null;
    const classification: Classification | 'unknown' = t
      ? t.classification
      : classifyFromTipo(campaign.tipo);

    const stores = new Set<string>();
    for (const cn of consByCampaign.get(campaign.name) ?? []) {
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
