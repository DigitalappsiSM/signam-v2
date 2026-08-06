import type { AdmiraCsvRow } from '@/domain';
import type { ConsolidationIssue } from '@/modules/consolidation/consolidate';

/**
 * Tipos del módulo "Alertas de baja ocupación".
 *
 * El análisis evalúa cada unidad `Numero de Tienda + NORMALIZACION LIVERPOOL
 * (calendarSupport) + RESOLUCION` para una fecha civil, cuenta los contenidos
 * de proveedor vigentes (deduplicados por `Campaña + ARTICULOS`) y recomienda un
 * ratio. Los archivos CSV se agrupan por `NORMALIZACION LIVERPOOL + RESOLUCION`.
 */

/** Nivel de ocupación comercial de una unidad. */
export type OccupancyLevel =
  'sin-ocupacion' | 'baja-critica' | 'baja-preventiva' | 'normal';

/** Ratio recomendado. `null` cuando no hay ocupación comercial (0 proveedores). */
export type RecommendedRatio = 1 | 3 | null;

/**
 * Un contenido de proveedor único dentro de una unidad. La deduplicación es por
 * `Campaña + ARTICULOS`; `TIPO DE PASES` y circuito no dividen el conteo.
 */
export interface ProviderContent {
  /** Nombre de la campaña Liverpool. */
  campaignName: string;
  /** `ARTICULOS` de la pantalla (literal del maestro). */
  articulos: string;
  /** Vigencia de la campaña (texto original del calendario). */
  fechaInicio: string;
  fechaFin: string;
  /** Soporte normalizado (NORMALIZACION LIVERPOOL) de la unidad. */
  support: string;
  /** Llave usada para deduplicar (`Campaña + ARTICULOS`). */
  dedupeKey: string;
  /** IDs de las pantallas físicas que aportan este contenido. */
  screenIds: string[];
}

/** Resultado de una unidad `tienda + normalización + resolución`. */
export interface OccupancyUnit {
  /** Llave interna `tienda|normalización|resolución` (normalizada). */
  key: string;
  storeNumber: string;
  storeName: string;
  centros: string;
  /** NORMALIZACION LIVERPOOL (metadato `calendarSupport`). */
  normalization: string;
  resolution: string;
  /** Contenidos de proveedor vigentes, ya deduplicados. */
  contents: ProviderContent[];
  /** Número de proveedores activos (= `contents.length`). */
  providerCount: number;
  level: OccupancyLevel;
  recommendedRatio: RecommendedRatio;
  /** IDs de las pantallas físicas participantes de la unidad. */
  screenIds: string[];
  /** Filas de Admira (deduplicadas) de las pantallas de la unidad. */
  rows: AdmiraCsvRow[];
}

/**
 * Grupo exportable por `NORMALIZACION LIVERPOOL + RESOLUCION`. De aquí salen los
 * dos CSV independientes (Ratio 1 y Ratio 3).
 */
export interface OccupancyExportGroup {
  /** Llave `normalización|resolución` (normalizada). */
  key: string;
  normalization: string;
  resolution: string;
  /** Unidades con 1 o 2 proveedores (Ratio 1). */
  ratio1Units: OccupancyUnit[];
  /** Unidades con 3 o más proveedores (Ratio 3). */
  ratio3Units: OccupancyUnit[];
  /** Unidades sin ocupación comercial (0 proveedores): alerta, fuera de ambos CSV. */
  zeroUnits: OccupancyUnit[];
  /** Filas del CSV Ratio 1 (deduplicadas). */
  ratio1Rows: AdmiraCsvRow[];
  /** Filas del CSV Ratio 3 (deduplicadas). */
  ratio3Rows: AdmiraCsvRow[];
}

/** Resumen agregado del análisis. */
export interface OccupancySummary {
  totalUnits: number;
  zero: number;
  one: number;
  two: number;
  threePlus: number;
  exportableGroups: number;
  issues: number;
}

/** Resultado completo del análisis de baja ocupación. */
export interface OccupancyAnalysis {
  /** Fecha analizada en formato `AAAA-MM-DD`. */
  analysisDate: string;
  units: OccupancyUnit[];
  groups: OccupancyExportGroup[];
  /** Incidencias del cruce (tienda no en catálogo, inactiva, sin mapear, etc.). */
  issues: ConsolidationIssue[];
  /** Soportes InStore Media excluidos (campaña + soporte). */
  excludedInstore: { campaign: string; support: string }[];
  /** Pantallas ISM excluidas. */
  ismExcludedCount: number;
  summary: OccupancySummary;
}

/**
 * Filtros visuales de la tabla. NO alteran los CSV completos: solo cambian lo
 * que se muestra en pantalla.
 */
export interface OccupancyFilters {
  centro: string;
  storeNumber: string;
  normalization: string;
  resolution: string;
  /** Nivel exacto, o `''` para todos. */
  level: OccupancyLevel | '';
  /** Ratio recomendado: `'1'`, `'3'`, `'0'` (sin ocupación) o `''` para todos. */
  ratio: '1' | '3' | '0' | '';
  /** Búsqueda por campaña o artículo. */
  search: string;
}

/** Filtros vacíos (sin filtrar). */
export const EMPTY_FILTERS: OccupancyFilters = {
  centro: '',
  storeNumber: '',
  normalization: '',
  resolution: '',
  level: '',
  ratio: '',
  search: '',
};

/** Etiquetas textuales (accesibilidad: nunca solo color). */
export const LEVEL_LABELS: Record<OccupancyLevel, string> = {
  'sin-ocupacion': 'Sin ocupación comercial',
  'baja-critica': 'Baja ocupación crítica',
  'baja-preventiva': 'Baja ocupación preventiva',
  normal: 'Ocupación normal',
};

/** Etiqueta del ratio recomendado (o exclusión). */
export function ratioLabel(ratio: RecommendedRatio): string {
  if (ratio === 1) return 'Ratio 1';
  if (ratio === 3) return 'Ratio 3';
  return 'Excluido de CSV';
}
