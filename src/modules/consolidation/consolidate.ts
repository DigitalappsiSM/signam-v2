import {
  RETAILERS_VALUE,
  buildAdmiraCampaignName,
  buildConsolidationKey,
  joinArticulos,
  normalizeSupport,
  GUADALAJARA_GALERIAS_EXCEPTION,
  type AdmiraCsvRow,
  type AdmiraScreen,
} from '@/domain';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import { effectiveCampaignSupportScope } from '@/modules/liverpool-import/campaignParse';

/**
 * Motor de consolidación (paso 2b).
 *
 * Cruza las campañas del calendario contra las pantallas activas del catálogo
 * usando `Numero de Tienda` + `NORMALIZACION LIVERPOOL` (metadato
 * `calendarSupport`), consolida por `Campaña + RESOLUCION` y produce las filas
 * del CSV de Admira. Regla de negocio: `RETAILERS` es constante `LIVERPOOL`.
 *
 * Exclusiones de esta etapa (con incidencia):
 * - Soportes InStore Media (Muppi's / Pendón).
 * - Pantallas cuyo `TIPO DE pantallas` sea `ISM` (lógica pendiente).
 * - Pantallas inactivas solicitadas.
 */

export interface Consolidation {
  campaignName: string;
  resolution: string;
  admiraCampaignName: string;
  articulos: string;
  rows: AdmiraCsvRow[];
  screenIds: string[];
  storeCount: number;
}

/** Código de incidencia de consolidación. */
export type IssueCode =
  | 'store-not-in-catalog'
  | 'store-support-mismatch'
  | 'screen-inactive'
  | 'support-not-in-catalog'
  | 'invalid-store-scope';

/** Incidencia estructurada (para agrupar por campaña/soporte y para el PDF). */
export interface ConsolidationIssue {
  code: IssueCode;
  campaign: string;
  support: string;
  store?: string;
  message: string;
}

export interface ConsolidationResult {
  consolidations: Consolidation[];
  issues: ConsolidationIssue[];
  /** Soportes InStore Media detectados y excluidos (campaña + soporte). */
  excludedInstore: { campaign: string; support: string }[];
  /** Pantallas ISM excluidas (deferidas). */
  ismExcludedCount: number;
}

const norm = (v: string) => normalizeSupport(v);
const isISM = (screen: AdmiraScreen) =>
  norm(screen.original['TIPO DE pantallas']).includes('ISM');

/**
 * Normaliza un número de tienda: recorta y, si es numérico, elimina ceros a la
 * izquierda (así `0078` y `78` se consideran la misma tienda). Los códigos no
 * numéricos se conservan tal cual.
 */
export function normalizeStore(value: string): string {
  const t = value.trim();
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
}

/** Clave de índice `soporte|tienda`. */
function key(support: string, store: string): string {
  return `${norm(support)}|${normalizeStore(store)}`;
}

export interface ScreenIndex {
  active: Map<string, AdmiraScreen[]>;
  inactive: Map<string, AdmiraScreen[]>;
  /** Pantallas activas por tienda (para la excepción de Guadalajara). */
  activeByStore: Map<string, AdmiraScreen[]>;
  /** Pantallas activas por soporte (para "Asignada sin comentario"). */
  activeBySupport: Map<string, AdmiraScreen[]>;
}

/**
 * Resultado de cruzar UNA campaña contra el catálogo: sus pantallas activas
 * participantes (deduplicadas por id, orden estable, sin ISM) más las
 * incidencias y exclusiones generadas. Es la pieza reutilizable del motor: la
 * consolidación normal y el análisis de baja ocupación la comparten para no
 * mantener dos variantes incompatibles del cruce calendario↔catálogo.
 */
export interface CampaignMatch {
  matched: AdmiraScreen[];
  issues: ConsolidationIssue[];
  excludedInstore: { campaign: string; support: string }[];
  ismExcludedCount: number;
}

function push(map: Map<string, AdmiraScreen[]>, k: string, s: AdmiraScreen) {
  const list = map.get(k);
  if (list) list.push(s);
  else map.set(k, [s]);
}

/**
 * Excepción de Guadalajara Galerías para el modo "todas las tiendas": si la
 * tienda 78 participa de `VIDEO WALL CRIUS`, incluye además su configuración
 * `CUADRADA` (900 x 900).
 */
function applyGuadalajara(
  supportName: string,
  index: ScreenIndex,
  matched: Map<string, AdmiraScreen>,
): void {
  const g = GUADALAJARA_GALERIAS_EXCEPTION;
  if (norm(supportName) !== norm(g.requestedSupport)) return;
  const store78 = index.activeByStore.get(g.storeNumber) ?? [];
  const participates = store78.some(
    (s) => norm(s.metadata.calendarSupport) === norm(g.requestedSupport),
  );
  if (!participates) return;
  for (const s of store78) {
    if (norm(s.original.Modelo) === 'CUADRADA') matched.set(s.id, s);
  }
}

export function buildScreenIndex(
  screens: readonly AdmiraScreen[],
): ScreenIndex {
  const active = new Map<string, AdmiraScreen[]>();
  const inactive = new Map<string, AdmiraScreen[]>();
  const activeByStore = new Map<string, AdmiraScreen[]>();
  const activeBySupport = new Map<string, AdmiraScreen[]>();

  for (const screen of screens) {
    const support = screen.metadata.calendarSupport;
    if (!support) continue; // sin mapear: no participa
    const k = key(support, screen.original['Numero de Tienda']);
    push(screen.metadata.active ? active : inactive, k, screen);

    if (screen.metadata.active) {
      push(
        activeByStore,
        normalizeStore(screen.original['Numero de Tienda']),
        screen,
      );
      push(activeBySupport, norm(support), screen);
    }
  }
  return { active, inactive, activeByStore, activeBySupport };
}

/**
 * Cruza UNA campaña contra el catálogo indexado y devuelve sus pantallas
 * participantes (activas, deduplicadas, sin ISM) más incidencias/exclusiones.
 * Función pura reutilizable por la consolidación y por el análisis de ocupación.
 */
export function matchCampaignScreens(
  campaign: ParsedCampaign,
  index: ScreenIndex,
): CampaignMatch {
  const issues: ConsolidationIssue[] = [];
  const excludedInstore: { campaign: string; support: string }[] = [];
  // Pantallas participantes de la campaña (deduplicadas por id, orden estable).
  const matched = new Map<string, AdmiraScreen>();
  const gexc = GUADALAJARA_GALERIAS_EXCEPTION;

  for (const support of campaign.supports) {
    if (support.owner === 'instore-media') {
      excludedInstore.push({
        campaign: campaign.name,
        support: support.support,
      });
      continue;
    }

    const scope = effectiveCampaignSupportScope(support);
    if (
      scope === 'invalid' ||
      (scope === 'selected' && support.stores.length === 0)
    ) {
      issues.push({
        code: 'invalid-store-scope',
        campaign: campaign.name,
        support: support.support,
        message: `El alcance de tiendas de "${support.support}" en "${campaign.name}" está pendiente o es inválido. No se incluye ninguna pantalla.`,
      });
      continue;
    }

    // Regla: alcance `all` explícito (o documento legacy sin tiendas) => todas
    // las pantallas activas del soporte.
    if (scope === 'all') {
      const all = index.activeBySupport.get(norm(support.support)) ?? [];
      if (all.length === 0) {
        issues.push({
          code: 'support-not-in-catalog',
          campaign: campaign.name,
          support: support.support,
          message: `Soporte "${support.support}" asignado sin comentario en "${campaign.name}", pero no hay pantallas mapeadas a ese soporte en el catálogo.`,
        });
      }
      for (const s of all) matched.set(s.id, s);
      // Excepción Guadalajara también aplica en modo "todas las tiendas".
      applyGuadalajara(support.support, index, matched);
      continue;
    }

    for (const store of support.stores) {
      const num = normalizeStore(store.numero);
      const k = key(support.support, num);
      const activeMatches = index.active.get(k) ?? [];

      if (activeMatches.length === 0) {
        const inactiveMatches = index.inactive.get(k) ?? [];
        const storeExists = (index.activeByStore.get(num) ?? []).length > 0;
        let code: IssueCode;
        let message: string;
        if (inactiveMatches.length > 0) {
          code = 'screen-inactive';
          message = `Pantalla inactiva excluida: campaña "${campaign.name}", soporte "${support.support}", tienda ${num}.`;
        } else if (storeExists) {
          code = 'store-support-mismatch';
          message = `La tienda ${num} existe en el catálogo pero no con el soporte "${support.support}" (posible error de Liverpool o falta de mapeo): se excluye. Campaña "${campaign.name}".`;
        } else {
          code = 'store-not-in-catalog';
          message = `La tienda ${num} no existe en el catálogo (el maestro es la verdad absoluta): se excluye. Campaña "${campaign.name}", soporte "${support.support}".`;
        }
        issues.push({
          code,
          campaign: campaign.name,
          support: support.support,
          store: num,
          message,
        });
      }
      for (const s of activeMatches) matched.set(s.id, s);

      // Excepción exclusiva de Guadalajara Galerías: tienda 78 + VIDEO WALL
      // CRIUS incluye además la configuración CUADRADA (900 x 900).
      if (
        num === gexc.storeNumber &&
        norm(support.support) === norm(gexc.requestedSupport)
      ) {
        for (const s of index.activeByStore.get(gexc.storeNumber) ?? []) {
          if (norm(s.original.Modelo) === 'CUADRADA') matched.set(s.id, s);
        }
      }
    }
  }

  // Excluir pantallas ISM (lógica pendiente).
  let ismExcludedCount = 0;
  for (const [id, s] of matched) {
    if (isISM(s)) {
      matched.delete(id);
      ismExcludedCount += 1;
    }
  }

  return {
    matched: [...matched.values()],
    issues,
    excludedInstore,
    ismExcludedCount,
  };
}

/**
 * Acumulador de una consolidación (`Campaña + RESOLUCION`). Reúne, a lo largo de
 * todos los flights homónimos, las pantallas participantes deduplicadas por
 * `screen.id` y en orden estable de aparición.
 */
interface ConsolidationAccumulator {
  campaignName: string;
  /** Resolución original (primera aparición) usada para mostrar/serializar. */
  resolution: string;
  screens: Map<string, AdmiraScreen>;
}

/**
 * Consolida las campañas contra el catálogo. Función pura.
 *
 * La llave definitiva es `Campaña + RESOLUCION` (`buildConsolidationKey`), por
 * lo que varios **flights homónimos** (misma campaña repetida en el calendario)
 * se unen en una **única** `Consolidation` por resolución: las pantallas se
 * acumulan globalmente y se deduplican por `screen.id`. Así el menú de descargas
 * y el ZIP presentan un solo CSV por resolución, en vez de uno por flight.
 */
export function consolidate(
  campaigns: readonly ParsedCampaign[],
  screens: readonly AdmiraScreen[],
): ConsolidationResult {
  const index = buildScreenIndex(screens);
  const issues: ConsolidationIssue[] = [];
  const excludedInstore: { campaign: string; support: string }[] = [];
  let ismExcludedCount = 0;

  // Acumulador global por `Campaña + RESOLUCION`. El orden de inserción de las
  // llaves determina el orden de las consolidaciones resultantes.
  const groups = new Map<string, ConsolidationAccumulator>();

  for (const campaign of campaigns) {
    const match = matchCampaignScreens(campaign, index);
    issues.push(...match.issues);
    excludedInstore.push(...match.excludedInstore);
    ismExcludedCount += match.ismExcludedCount;

    for (const s of match.matched) {
      // Resoluciones con diferencias cosméticas (mayúsculas/espacios) se
      // consideran iguales: la llave normaliza la resolución.
      const key = buildConsolidationKey(campaign.name, s.original.RESOLUCION);
      let acc = groups.get(key);
      if (!acc) {
        acc = {
          campaignName: campaign.name,
          resolution: s.original.RESOLUCION,
          screens: new Map(),
        };
        groups.set(key, acc);
      }
      // Deduplicación de pantallas por id (una misma pantalla compartida por
      // varios flights entra una sola vez).
      if (!acc.screens.has(s.id)) acc.screens.set(s.id, s);
    }
  }

  const consolidations: Consolidation[] = [];
  for (const acc of groups.values()) {
    const group = [...acc.screens.values()];
    const articulosList = group.map((s) => s.original.ARTICULOS);
    const rows = dedupeRows(group.map(screenToAdmiraRow));
    consolidations.push({
      campaignName: acc.campaignName,
      resolution: acc.resolution,
      admiraCampaignName: buildAdmiraCampaignName(
        acc.campaignName,
        articulosList,
      ),
      articulos: joinArticulos(articulosList),
      rows,
      screenIds: group.map((s) => s.id),
      storeCount: group.length,
    });
  }

  return { consolidations, issues, excludedInstore, ismExcludedCount };
}

export interface IssueSummary {
  total: number;
  byCode: Record<string, number>;
  bySupport: Record<string, number>;
  byCampaign: Record<string, number>;
}

/** Resume las incidencias por código, soporte y campaña, para reportes. */
export function summarizeIssues(
  issues: readonly ConsolidationIssue[],
): IssueSummary {
  const byCode: Record<string, number> = {};
  const bySupport: Record<string, number> = {};
  const byCampaign: Record<string, number> = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    bySupport[i.support] = (bySupport[i.support] ?? 0) + 1;
    byCampaign[i.campaign] = (byCampaign[i.campaign] ?? 0) + 1;
  }
  return { total: issues.length, byCode, bySupport, byCampaign };
}

/**
 * Convierte una pantalla del catálogo en una fila del CSV de Admira. Es la
 * única fuente del formato de fila (reutilizada por la consolidación normal y
 * por los CSV auxiliares Ratio 1 / Ratio 3): `RETAILERS` es constante
 * `LIVERPOOL` y el resto se toma literal de los campos originales del maestro.
 */
export function screenToAdmiraRow(screen: AdmiraScreen): AdmiraCsvRow {
  return {
    ARTICULOS: screen.original.ARTICULOS,
    BRANDS: screen.original.BRANDS,
    CENTROS: screen.original.CENTROS,
    CIRCUITO: screen.original.CIRCUITO,
    RESOLUCION: screen.original.RESOLUCION,
    RETAILERS: RETAILERS_VALUE,
    'TIPO DE PASES': screen.original['TIPO DE PASES'],
  };
}

/** Deduplica filas de Admira idénticas conservando el orden de aparición. */
export function dedupeRows(rows: readonly AdmiraCsvRow[]): AdmiraCsvRow[] {
  const seen = new Set<string>();
  const result: AdmiraCsvRow[] = [];
  for (const row of rows) {
    const k = JSON.stringify(row);
    if (seen.has(k)) continue;
    seen.add(k);
    result.push(row);
  }
  return result;
}
