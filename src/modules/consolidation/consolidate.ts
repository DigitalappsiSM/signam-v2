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

/** Clave de índice `soporte|tienda`. */
function key(support: string, store: string): string {
  return `${norm(support)}|${store.trim()}`;
}

interface ScreenIndex {
  active: Map<string, AdmiraScreen[]>;
  inactive: Map<string, AdmiraScreen[]>;
  /** Pantallas activas por tienda (para la excepción de Guadalajara). */
  activeByStore: Map<string, AdmiraScreen[]>;
}

function buildIndex(screens: readonly AdmiraScreen[]): ScreenIndex {
  const active = new Map<string, AdmiraScreen[]>();
  const inactive = new Map<string, AdmiraScreen[]>();
  const activeByStore = new Map<string, AdmiraScreen[]>();

  for (const screen of screens) {
    const support = screen.metadata.calendarSupport;
    if (!support) continue; // sin mapear: no participa
    const k = key(support, screen.original['Numero de Tienda']);
    const target = screen.metadata.active ? active : inactive;
    (target.get(k) ?? target.set(k, []).get(k)!).push(screen);

    if (screen.metadata.active) {
      const store = screen.original['Numero de Tienda'].trim();
      (
        activeByStore.get(store) ?? activeByStore.set(store, []).get(store)!
      ).push(screen);
    }
  }
  return { active, inactive, activeByStore };
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

      for (const store of support.stores) {
        const num = store.numero.trim();
        const k = key(support.support, num);
        const activeMatches = index.active.get(k) ?? [];

        if (activeMatches.length === 0) {
          const inactiveMatches = index.inactive.get(k) ?? [];
          issues.push({
            severity: 'warning',
            code:
              inactiveMatches.length > 0
                ? 'screen-inactive'
                : 'screen-not-found',
            message:
              inactiveMatches.length > 0
                ? `Pantalla inactiva excluida: campaña "${campaign.name}", soporte "${support.support}", tienda ${num}.`
                : `Sin pantalla activa en el catálogo: campaña "${campaign.name}", soporte "${support.support}", tienda ${num}.`,
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
