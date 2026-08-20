import { normalizeSupport } from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import { campaignIntersectsPeriod } from '@/modules/campaigns/dateFilter';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import type { TrackingRow } from '@/modules/operational-tracking/trackingModel';
import type {
  DateRange,
  OccupancyClassification,
  Owner,
} from './occupancyModel';

/**
 * Filtros globales del Dashboard aplicados a las **filas de seguimiento** (KPIs,
 * salud operativa, alertas y vencimientos). Es el equivalente para el resumen
 * operativo de los filtros de colocación del modelo de carga (`occupancyModel`):
 * el mismo contexto (periodo, clasificación, propietario, soporte, tienda y
 * búsqueda) recorta todas las secciones del panel.
 *
 * Puro y determinista (sin React ni Firebase). Reutiliza los helpers existentes:
 * `campaignIntersectsPeriod` (intersección de vigencia inclusiva, sin comparar
 * cadenas) y `normalizeSupport`/`normalizeStore` (comparación de soportes y
 * tiendas). No modifica ni persiste nada: solo filtra la presentación.
 */
export interface DashboardFilterValues {
  /** Periodo civil seleccionado (ambos extremos inclusivos). */
  range: DateRange;
  classification: OccupancyClassification | 'all';
  owner: Owner | 'all';
  /** Clave de soporte normalizada (o vacío para "todos"). */
  support: string | null;
  /** Número de tienda normalizado (o vacío para "todas"). */
  store: string | null;
  /** Búsqueda por nombre de campaña. */
  search: string;
}

function normalizeText(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * ¿La campaña conserva al menos una colocación (soporte/tienda) que cumpla
 * **todos** los filtros de propietario/soporte/tienda activos? Refleja la regla
 * §5.3: un filtro combinado exige una sola colocación que satisfaga todas las
 * condiciones a la vez (no basta con cumplirlas en colocaciones distintas).
 */
function matchesPlacementFilters(
  supports: readonly CampaignSupport[],
  owner: Owner | 'all',
  support: string | null,
  store: string | null,
): boolean {
  if (owner === 'all' && !support && !store) return true;
  return supports.some((s) => {
    if (owner !== 'all' && s.owner !== owner) return false;
    if (support && normalizeSupport(s.support) !== support) return false;
    if (store && !s.stores.some((st) => normalizeStore(st.numero) === store)) {
      return false;
    }
    return true;
  });
}

/**
 * Recorta las filas de seguimiento al contexto global del Dashboard. No excluye
 * canceladas: eso lo decide cada sección (el resumen las excluye; la carga las
 * conserva). Solo aplica periodo, clasificación, propietario, soporte, tienda y
 * búsqueda.
 */
export function filterDashboardRows(
  rows: readonly TrackingRow[],
  filters: DashboardFilterValues,
): TrackingRow[] {
  const search = normalizeText(filters.search ?? '');
  const support = filters.support || null;
  const store = filters.store || null;
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
    if (search && !normalizeText(r.campaign.name).includes(search))
      return false;
    if (
      !matchesPlacementFilters(
        r.campaign.supports,
        filters.owner,
        support,
        store,
      )
    ) {
      return false;
    }
    return true;
  });
}
