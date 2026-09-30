import {
  normalizeResolution,
  normalizeSupport,
  isInStoreMediaSupport,
  type AdmiraScreen,
} from '@/domain';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import {
  buildScreenIndex,
  dedupeRows,
  matchCampaignScreens,
  normalizeStore,
  screenToAdmiraRow,
  type ConsolidationIssue,
} from '@/modules/consolidation/consolidate';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import type {
  OccupancyAnalysis,
  OccupancyExportGroup,
  OccupancyFilters,
  OccupancyLevel,
  OccupancyUnit,
  ProviderContent,
  RecommendedRatio,
} from './types';

/**
 * Motor puro de "Alertas de baja ocupación".
 *
 * Reutiliza el cruce calendario↔catálogo del motor de consolidación
 * (`matchCampaignScreens`) para no mantener una segunda variante incompatible.
 * No depende de React, Firebase ni efectos secundarios.
 *
 * Pasos:
 * 1. Universo de unidades: todas las pantallas activas y elegibles del catálogo,
 *    agrupadas por `tienda + normalización + resolución`. Una pantalla sin
 *    `calendarSupport` se reporta (no se incluye en silencio). Las pantallas
 *    ISM y los soportes InStore Media se excluyen (se conservan las exclusiones
 *    vigentes).
 * 2. Contenidos de proveedor: por cada campaña Proveedor vigente en la fecha
 *    analizada, se cruzan sus pantallas y cada pantalla aporta el contenido
 *    `Campaña + ARTICULOS` a su unidad (deduplicado).
 * 3. Nivel y ratio: 0 → Sin ocupación comercial, pero **pertenece a Ratio 3**
 *    (se exporta en el CSV Ratio 3 y sigue visible como alerta "Sin
 *    proveedores"); 1 → crítica (Ratio 1); 2 → preventiva (Ratio 1);
 *    3+ → normal (Ratio 3).
 * 4. Grupos exportables por `normalización + resolución` (CSV Ratio 1 y 3). El
 *    CSV Ratio 3 incluye las filas de las unidades sin proveedores.
 */

export interface AnalyzeInput {
  campaigns: readonly ParsedCampaign[];
  screens: readonly AdmiraScreen[];
  /** Fecha civil analizada, `AAAA-MM-DD`. */
  analysisDate: string;
}

/** Formatea una fecha civil (UTC) a `AAAA-MM-DD`. */
export function toIsoDate(d: Date): string {
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Fecha civil de hoy en `AAAA-MM-DD` (a partir de la fecha local). */
export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())),
  );
}

/**
 * ¿La campaña está vigente en `date`? Vigente cuando
 * `fechaInicio <= date <= fechaFin` (ambos extremos inclusivos). Si falta o no
 * es interpretable alguna de las dos fechas, no se puede confirmar vigencia y se
 * considera NO vigente.
 */
export function isCampaignActiveOn(
  campaign: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
  date: Date,
): boolean {
  const start = parseCampaignDate(campaign.fechaInicio);
  const end = parseCampaignDate(campaign.fechaFin);
  if (!start || !end) return false;
  const t = date.getTime();
  return start.getTime() <= t && t <= end.getTime();
}

/** ¿La campaña cuenta para la ocupación? Solo las Proveedor inequívocas. */
export function countsForOccupancy(
  campaign: Pick<ParsedCampaign, 'tipo'>,
): boolean {
  return classifyFromTipo(campaign.tipo) === 'provider';
}

function includesCi(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (n === '') return true;
  return haystack
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .includes(
      n
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''),
    );
}

/**
 * Aplica los filtros visuales a las unidades. Función pura. NO modifica los CSV
 * completos: es exclusivamente para la vista de la tabla.
 */
export function filterUnits(
  units: readonly OccupancyUnit[],
  filters: OccupancyFilters,
): OccupancyUnit[] {
  return units.filter((u) => {
    if (!includesCi(u.centros, filters.centro)) return false;
    if (filters.storeNumber.trim() !== '') {
      if (!includesCi(u.storeNumber, filters.storeNumber)) return false;
    }
    if (
      filters.normalization !== '' &&
      u.normalization !== filters.normalization
    ) {
      return false;
    }
    if (filters.resolution !== '' && u.resolution !== filters.resolution) {
      return false;
    }
    if (filters.level !== '' && u.level !== filters.level) return false;
    if (filters.ratio !== '') {
      if (filters.ratio === '0') {
        // "Sin ocupación" se identifica por NIVEL, no por ratio: una unidad con
        // 0 proveedores pertenece a Ratio 3 (se exporta ahí) pero conserva el
        // nivel `sin-ocupacion`.
        if (u.level !== 'sin-ocupacion') return false;
      } else {
        const target = Number(filters.ratio) as 1 | 3;
        if (u.recommendedRatio !== target) return false;
      }
    }
    if (filters.search.trim() !== '') {
      const hit = u.contents.some(
        (c) =>
          includesCi(c.campaignName, filters.search) ||
          includesCi(c.articulos, filters.search),
      );
      if (!hit) return false;
    }
    return true;
  });
}

/** Llave de unidad `tienda|normalización|resolución` (normalizada). */
function unitKey(store: string, support: string, resolution: string): string {
  return `${normalizeStore(store)}|${normalizeSupport(support)}|${normalizeResolution(resolution)}`;
}

/** Llave de grupo exportable `normalización|resolución` (normalizada). */
function groupKey(support: string, resolution: string): string {
  return `${normalizeSupport(support)}|${normalizeResolution(resolution)}`;
}

/** Llave de deduplicación de contenidos `Campaña + ARTICULOS`. */
function contentKey(campaignName: string, articulos: string): string {
  return `${campaignName.trim()} ${articulos.trim()}`;
}

function levelFor(count: number): OccupancyLevel {
  if (count === 0) return 'sin-ocupacion';
  if (count === 1) return 'baja-critica';
  if (count === 2) return 'baja-preventiva';
  return 'normal';
}

function ratioFor(count: number): RecommendedRatio {
  // Decisión de negocio confirmada: 0 proveedores pertenece a **Ratio 3** y se
  // exporta en el CSV Ratio 3 (para que Admira coloque ahí los institucionales
  // de relleno), aunque conserva el nivel "Sin ocupación comercial". 1–2 → Ratio
  // 1; 3+ → Ratio 3.
  return count === 1 || count === 2 ? 1 : 3;
}

/** ¿La pantalla es elegible para formar una unidad de análisis? */
function isEligibleScreen(screen: AdmiraScreen): boolean {
  if (!screen.metadata.active) return false;
  const support = screen.metadata.calendarSupport;
  if (!support || support.trim() === '') return false;
  if (isInStoreMediaSupport(support)) return false;
  if (normalizeSupport(screen.original['TIPO DE pantallas']).includes('ISM')) {
    return false;
  }
  return true;
}

interface MutableUnit {
  unit: OccupancyUnit;
  /** Índice de contenidos por llave de deduplicación. */
  contentIndex: Map<string, ProviderContent>;
}

/** Analiza la baja ocupación para una fecha civil. Función pura. */
export function analyzeLowOccupancy(input: AnalyzeInput): OccupancyAnalysis {
  const { campaigns, screens } = input;
  const analysisDate = input.analysisDate.trim();
  const date = parseCampaignDate(analysisDate);

  const issues: ConsolidationIssue[] = [];

  // 1. Universo de unidades a partir del catálogo activo y elegible.
  const units = new Map<string, MutableUnit>();
  const seenNoNormalization = new Set<string>();

  for (const screen of screens) {
    if (!screen.metadata.active) continue;
    const support = screen.metadata.calendarSupport;
    if (!support || support.trim() === '') {
      // No se incluye en silencio: se reporta (una incidencia por pantalla).
      if (!seenNoNormalization.has(screen.id)) {
        seenNoNormalization.add(screen.id);
        issues.push({
          code: 'support-not-in-catalog',
          campaign: '—',
          support: '(sin normalización)',
          store: normalizeStore(screen.original['Numero de Tienda']),
          message: `La pantalla ${screen.id} (tienda ${normalizeStore(
            screen.original['Numero de Tienda'],
          )}) no tiene NORMALIZACION LIVERPOOL y se excluye del análisis.`,
        });
      }
      continue;
    }
    if (!isEligibleScreen(screen)) continue;

    const key = unitKey(
      screen.original['Numero de Tienda'],
      support,
      screen.original.RESOLUCION,
    );
    let mutable = units.get(key);
    if (!mutable) {
      mutable = {
        unit: {
          key,
          storeNumber: normalizeStore(screen.original['Numero de Tienda']),
          storeName: screen.original['Nombre de tienda'],
          centros: screen.original.CENTROS,
          normalization: support,
          resolution: screen.original.RESOLUCION,
          contents: [],
          providerCount: 0,
          level: 'sin-ocupacion',
          recommendedRatio: null,
          screenIds: [],
          rows: [],
        },
        contentIndex: new Map(),
      };
      units.set(key, mutable);
    }
    mutable.unit.screenIds.push(screen.id);
    mutable.unit.rows.push(screenToAdmiraRow(screen));
  }

  // 2. Contenidos de proveedor vigentes por unidad.
  const index = buildScreenIndex(screens);
  const excludedInstore: { campaign: string; support: string }[] = [];

  for (const campaign of campaigns) {
    if (!countsForOccupancy(campaign)) continue;
    if (!date || !isCampaignActiveOn(campaign, date)) continue;

    const match = matchCampaignScreens(campaign, index);
    issues.push(...match.issues);
    excludedInstore.push(...match.excludedInstore);

    for (const screen of match.matched) {
      const support = screen.metadata.calendarSupport;
      const key = unitKey(
        screen.original['Numero de Tienda'],
        support,
        screen.original.RESOLUCION,
      );
      const mutable = units.get(key);
      if (!mutable) continue; // La pantalla no forma parte del universo elegible.

      const articulos = screen.original.ARTICULOS;
      const dedupeKey = contentKey(campaign.name, articulos);
      const existing = mutable.contentIndex.get(dedupeKey);
      if (existing) {
        if (!existing.screenIds.includes(screen.id)) {
          existing.screenIds.push(screen.id);
        }
        continue;
      }
      const content: ProviderContent = {
        campaignName: campaign.name,
        articulos,
        fechaInicio: campaign.fechaInicio,
        fechaFin: campaign.fechaFin,
        support,
        dedupeKey,
        screenIds: [screen.id],
      };
      mutable.contentIndex.set(dedupeKey, content);
      mutable.unit.contents.push(content);
    }
  }

  // 3. Nivel, ratio y deduplicación de filas por unidad.
  const unitList: OccupancyUnit[] = [];
  for (const { unit } of units.values()) {
    unit.providerCount = unit.contents.length;
    unit.level = levelFor(unit.providerCount);
    unit.recommendedRatio = ratioFor(unit.providerCount);
    unit.rows = dedupeRows(unit.rows);
    unitList.push(unit);
  }
  unitList.sort(
    (a, b) =>
      a.normalization.localeCompare(b.normalization, 'es') ||
      a.resolution.localeCompare(b.resolution, 'es') ||
      a.storeNumber.localeCompare(b.storeNumber, 'es', { numeric: true }),
  );

  // 4. Grupos exportables por normalización + resolución.
  const groups = new Map<string, OccupancyExportGroup>();
  for (const unit of unitList) {
    const gk = groupKey(unit.normalization, unit.resolution);
    let group = groups.get(gk);
    if (!group) {
      group = {
        key: gk,
        normalization: unit.normalization,
        resolution: unit.resolution,
        ratio1Units: [],
        ratio3Units: [],
        zeroUnits: [],
        ratio1Rows: [],
        ratio3Rows: [],
      };
      groups.set(gk, group);
    }
    // "Sin proveedores": subconjunto visible como alerta (0 proveedores). Se
    // conserva por separado aunque también forme parte de Ratio 3.
    if (unit.providerCount === 0) group.zeroUnits.push(unit);
    // Partición para los CSV: 1–2 → Ratio 1; 3+ y 0 proveedores → Ratio 3.
    if (unit.recommendedRatio === 1) group.ratio1Units.push(unit);
    else group.ratio3Units.push(unit);
  }

  const groupList: OccupancyExportGroup[] = [];
  for (const group of groups.values()) {
    group.ratio1Rows = dedupeRows(group.ratio1Units.flatMap((u) => u.rows));
    group.ratio3Rows = dedupeRows(group.ratio3Units.flatMap((u) => u.rows));
    groupList.push(group);
  }
  groupList.sort(
    (a, b) =>
      a.normalization.localeCompare(b.normalization, 'es') ||
      a.resolution.localeCompare(b.resolution, 'es'),
  );

  const summary = {
    totalUnits: unitList.length,
    zero: unitList.filter((u) => u.providerCount === 0).length,
    one: unitList.filter((u) => u.providerCount === 1).length,
    two: unitList.filter((u) => u.providerCount === 2).length,
    threePlus: unitList.filter((u) => u.providerCount >= 3).length,
    exportableGroups: groupList.filter(
      (g) => g.ratio1Rows.length > 0 || g.ratio3Rows.length > 0,
    ).length,
    issues: issues.length,
  };

  return {
    analysisDate,
    units: unitList,
    groups: groupList,
    issues,
    excludedInstore,
    summary,
  };
}
