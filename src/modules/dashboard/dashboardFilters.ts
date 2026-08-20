import { campaignIntersectsPeriod } from '@/modules/campaigns/dateFilter';
import type { TrackingRow } from '@/modules/operational-tracking/trackingModel';
import type { DateRange, OccupancyClassification } from './occupancyModel';

/**
 * Filtros globales del Dashboard aplicados a las **filas de seguimiento** (KPIs,
 * salud operativa, alertas y vencimientos): el mismo contexto (periodo,
 * clasificación, búsqueda y colocación) recorta todas las secciones del panel.
 *
 * Puro y determinista (sin React ni Firebase). Reutiliza `campaignIntersectsPeriod`
 * (intersección de vigencia inclusiva, sin comparar cadenas). El filtro de
 * colocación (propietario/soporte/tienda) NO se recalcula aquí: se delega en
 * `occupancyModel` —que resuelve las colocaciones contra el catálogo— para que
 * el resumen operativo se recorte exactamente igual que la carga. El llamador
 * pasa el conjunto de ids resueltos (`placementCampaignIds`); `null` significa
 * que no hay filtro de colocación activo y participan todas las campañas.
 */
export interface DashboardFilterValues {
  /** Periodo civil seleccionado (ambos extremos inclusivos). */
  range: DateRange;
  classification: OccupancyClassification | 'all';
  /** Búsqueda por nombre de campaña. */
  search: string;
  /**
   * Ids de campaña (`campaign.id`) con al menos una colocación resuelta que
   * cumple los filtros de propietario/soporte/tienda, tomados de
   * `OccupancyDashboard.campaignIds`. `null` = sin filtro de colocación activo.
   */
  placementCampaignIds: ReadonlySet<string> | null;
}

function normalizeText(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Recorta las filas de seguimiento al contexto global del Dashboard. No excluye
 * canceladas: eso lo decide cada sección (el resumen las excluye; la carga las
 * conserva). Aplica periodo, clasificación, búsqueda y —cuando hay filtro de
 * colocación activo— la pertenencia al conjunto resuelto por `occupancyModel`.
 */
export function filterDashboardRows(
  rows: readonly TrackingRow[],
  filters: DashboardFilterValues,
): TrackingRow[] {
  const search = normalizeText(filters.search ?? '');
  const allowed = filters.placementCampaignIds;
  return rows.filter((r) => {
    if (
      !campaignIntersectsPeriod(
        r.campaign.fechaInicio,
        r.campaign.fechaFin,
        filters.range.start,
        filters.range.end,
      )
    ) {
      return false;
    }
    if (
      filters.classification !== 'all' &&
      r.classification !== filters.classification
    ) {
      return false;
    }
    if (search && !normalizeText(r.campaign.name).includes(search)) {
      return false;
    }
    if (allowed && !allowed.has(r.campaign.id)) return false;
    return true;
  });
}
