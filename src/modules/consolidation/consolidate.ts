import {
  RETAILERS_VALUE,
  buildAdmiraCampaignName,
  joinArticulos,
  normalizeResolution,
  normalizeSupport,
  GUADALAJARA_GALERIAS_EXCEPTION,
  type AdmiraCsvRow,
  type AdmiraScreen,
  type ValidationIssue,
} from '@/domain';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

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

export interface ConsolidationResult {
  consolidations: Consolidation[];
  issues: ValidationIssue[];
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

interface ScreenIndex {
  active: Map<string, AdmiraScreen[]>;
  inactive: Map<string, AdmiraScreen[]>;
  /** Pantallas activas por tienda (para la excepción de Guadalajara). */
  activeByStore: Map<string, AdmiraScreen[]>;
  /** Pantallas activas por soporte (para "Asignada sin comentario"). */
  activeBySupport: Map<string, AdmiraScreen[]>;
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

function buildIndex(screens: readonly AdmiraScreen[]): ScreenIndex {
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

/** Consolida las campañas contra el catálogo. Función pura. */
export function consolidate(
  campaigns: readonly ParsedCampaign[],
  screens: readonly AdmiraScreen[],
): ConsolidationResult {
  const index = buildIndex(screens);
  const issues: ValidationIssue[] = [];
  const excludedInstore: { campaign: string; support: string }[] = [];
  const consolidations: Consolidation[] = [];
  let ismExcludedCount = 0;

  const gexc = GUADALAJARA_GALERIAS_EXCEPTION;

  for (const campaign of campaigns) {
    // Pantallas participantes de la campaña (deduplicadas por id, orden estable).
    const matched = new Map<string, AdmiraScreen>();

    for (const support of campaign.supports) {
      if (support.owner === 'instore-media') {
        excludedInstore.push({
          campaign: campaign.name,
          support: support.support,
        });
        continue;
      }

      // Regla: "Asignada" sin comentario (sin tiendas) => todas las pantallas
      // activas de ese soporte (todas las tiendas disponibles).
      if (support.stores.length === 0) {
        const all = index.activeBySupport.get(norm(support.support)) ?? [];
        if (all.length === 0) {
          issues.push({
            severity: 'warning',
            code: 'support-not-in-catalog',
            message: `Soporte "${support.support}" asignado sin comentario en "${campaign.name}", pero no hay pantallas mapeadas a ese soporte en el catálogo.`,
            location: { column: support.support },
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
          let code: string;
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
            severity: 'warning',
            code,
            message,
            location: { column: support.support },
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
    for (const [id, s] of matched) {
      if (isISM(s)) {
        matched.delete(id);
        ismExcludedCount += 1;
      }
    }

    // Agrupar por RESOLUCION.
    const byResolution = new Map<string, AdmiraScreen[]>();
    for (const s of matched.values()) {
      const r = normalizeResolution(s.original.RESOLUCION);
      (byResolution.get(r) ?? byResolution.set(r, []).get(r)!).push(s);
    }

    for (const group of byResolution.values()) {
      const articulosList = group.map((s) => s.original.ARTICULOS);
      const rows = dedupeRows(
        group.map((s) => ({
          ARTICULOS: s.original.ARTICULOS,
          BRANDS: s.original.BRANDS,
          CENTROS: s.original.CENTROS,
          CIRCUITO: s.original.CIRCUITO,
          RESOLUCION: s.original.RESOLUCION,
          RETAILERS: RETAILERS_VALUE,
          'TIPO DE PASES': s.original['TIPO DE PASES'],
        })),
      );
      consolidations.push({
        campaignName: campaign.name,
        resolution: group[0]!.original.RESOLUCION,
        admiraCampaignName: buildAdmiraCampaignName(
          campaign.name,
          articulosList,
        ),
        articulos: joinArticulos(articulosList),
        rows,
        screenIds: group.map((s) => s.id),
        storeCount: group.length,
      });
    }
  }

  return { consolidations, issues, excludedInstore, ismExcludedCount };
}

export interface IssueSummary {
  total: number;
  byCode: Record<string, number>;
  bySupport: Record<string, number>;
}

/** Resume las incidencias por código y por soporte, para un reporte accionable. */
export function summarizeIssues(
  issues: readonly ValidationIssue[],
): IssueSummary {
  const byCode: Record<string, number> = {};
  const bySupport: Record<string, number> = {};
  for (const i of issues) {
    byCode[i.code] = (byCode[i.code] ?? 0) + 1;
    const support = i.location?.column;
    if (support) bySupport[support] = (bySupport[support] ?? 0) + 1;
  }
  return { total: issues.length, byCode, bySupport };
}

function dedupeRows(rows: AdmiraCsvRow[]): AdmiraCsvRow[] {
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
