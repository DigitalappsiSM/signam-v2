import {
  reconcileCampaign,
  type EkonAssignment,
  type ReconCampaignInput,
  type ReconciliationResult,
  type ReconciliationStatus,
} from '@/domain/ekon';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  ekonNumberForCampaign,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';

/**
 * Glue puro de la vista de Conciliación: empareja campañas Liverpool con su
 * número Ekon manual, adapta la campaña al modelo neutral del dominio y produce
 * las filas de resultado. Solo participan campañas con vínculo manual.
 */

export interface ReconciliationRow {
  campaign: StoredCampaign;
  ekonNumber: string;
  result: ReconciliationResult;
}

/** Adapta una campaña almacenada al modelo neutral de conciliación. */
export function toReconInput(campaign: StoredCampaign): ReconCampaignInput {
  return {
    name: campaign.name,
    fechaInicio: campaign.fechaInicio,
    fechaFin: campaign.fechaFin,
    supports: campaign.supports.map((s) => ({
      support: s.support,
      stores: s.stores.map((store) => ({
        numero: store.numero,
        nombre: store.nombre,
      })),
    })),
  };
}

/**
 * Construye las filas de conciliación para las campañas con vínculo manual Ekon.
 * `assignmentsByNumber` mapea número Ekon → asignaciones VIGENTES ya filtradas.
 * Las campañas sin vínculo NO aparecen (no se crean asociaciones automáticas).
 */
export function buildReconciliationRows(
  campaigns: readonly StoredCampaign[],
  links: readonly CampaignEkonLink[],
  assignmentsByNumber: ReadonlyMap<string, EkonAssignment[]>,
): ReconciliationRow[] {
  const rows: ReconciliationRow[] = [];
  for (const campaign of campaigns) {
    const number = ekonNumberForCampaign(campaign, links);
    if (number === null) continue;
    const ekonNumber = String(number);
    const assignments = assignmentsByNumber.get(ekonNumber) ?? [];
    rows.push({
      campaign,
      ekonNumber,
      result: reconcileCampaign(
        toReconInput(campaign),
        ekonNumber,
        assignments,
      ),
    });
  }
  return rows;
}

export interface ReconciliationFilters {
  text: string;
  status: ReconciliationStatus | 'all';
  onlyIssues: boolean;
}

/** Filtra/busca las filas de conciliación (campaña, número, producto, estado). */
export function filterReconciliationRows(
  rows: readonly ReconciliationRow[],
  filters: ReconciliationFilters,
): ReconciliationRow[] {
  const text = filters.text.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.status !== 'all' && row.result.status !== filters.status)
      return false;
    if (filters.onlyIssues && row.result.issues.length === 0) return false;
    if (text === '') return true;
    const haystack = [
      row.campaign.name,
      row.ekonNumber,
      ...row.result.productos,
      row.result.ratio ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(text);
  });
}

/** Resumen por estado para las tarjetas superiores. */
export function summarizeReconciliation(rows: readonly ReconciliationRow[]): {
  conciliadas: number;
  advertencias: number;
  error: number;
} {
  let conciliadas = 0;
  let advertencias = 0;
  let error = 0;
  for (const row of rows) {
    const s = row.result.status;
    if (s === 'conciliada' || s === 'centro-administrativo') conciliadas += 1;
    else if (s === 'conciliada-con-advertencias') advertencias += 1;
    else error += 1;
  }
  return { conciliadas, advertencias, error };
}

/** Número de incidencias accionables evitando contar dos veces los resúmenes de tiendas. */
export function reconciliationIncidentCount(row: ReconciliationRow): number {
  const storeIncidents = row.result.stores.details.filter(
    (store) => store.status !== 'matched',
  ).length;
  const nonStoreIssues = row.result.issues.filter(
    (issue) =>
      issue.code !== 'diferencia-tiendas' &&
      issue.code !== 'diferencia-tienda-soporte',
  ).length;
  return storeIncidents + nonStoreIssues;
}

export function hasReconciliationIncidents(row: ReconciliationRow): boolean {
  return reconciliationIncidentCount(row) > 0;
}
