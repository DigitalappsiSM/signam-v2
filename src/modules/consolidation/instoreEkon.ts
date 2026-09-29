import { classifySupport, normalizeSupport } from '@/domain';
import {
  isCompatibleSupport,
  normalizeStoreNumber,
  type EkonAssignment,
} from '@/domain/ekon';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import type {
  CampaignSupport,
  ParsedCampaign,
} from '@/modules/liverpool-import/campaignParse';
import type { ConsolidationIssue } from './consolidate';

/**
 * Tiendas de Mupi y Pendón cuando el soporte **no trae detalle**.
 *
 * Regla de negocio: si `MUPPI'S`, `PENDON`, `MEGA MUPI DIGITAL` o
 * `BANNER DIGITAL` llegan marcados sin detalle de tiendas, SIGNAM valida si la
 * campaña tiene número Ekon vinculado y toma las tiendas de sus asignaciones
 * vigentes (última importación Ekon). Con eso el soporte se consolida y genera
 * su CSV como cualquier otro.
 *
 * Es la misma regla que aplica el informe de audiencia Quividi
 * (`functions/src/quividi/effectiveScope.ts`): asignaciones cuyo periodo se
 * traslapa con la vigencia de la campaña y cuyo circuito es compatible con el
 * soporte, tomando el número de tienda del determinante. Así CSV e informe
 * describen el mismo universo de tiendas.
 *
 * Si no hay vínculo, no hay lote Ekon completado o Ekon no trae tiendas para
 * ese soporte, se **bloquea con una incidencia** y el soporte NO se expande a
 * todas las tiendas del catálogo.
 *
 * Es una función pura sobre la campaña: reemplaza el soporte sin detalle por uno
 * con tiendas explícitas y la consolidación normal hace el resto.
 */

/** Soporte Ekon-resoluble → soporte digital al que corresponde su circuito. */
const FAMILY: Readonly<Record<string, 'MEGA MUPI DIGITAL' | 'BANNER DIGITAL'>> =
  {
    MUPPIS: 'MEGA MUPI DIGITAL',
    'MEGA MUPI DIGITAL': 'MEGA MUPI DIGITAL',
    PENDON: 'BANNER DIGITAL',
    'BANNER DIGITAL': 'BANNER DIGITAL',
  };

function periodsOverlap(
  campaign: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
  assignment: Pick<EkonAssignment, 'inicioPeriodo' | 'finPeriodo'>,
): boolean {
  const c1 = parseCampaignDate(campaign.fechaInicio)?.getTime();
  const c2 = parseCampaignDate(campaign.fechaFin)?.getTime();
  const a1 = parseCampaignDate(assignment.inicioPeriodo ?? '')?.getTime();
  const a2 = parseCampaignDate(assignment.finPeriodo ?? '')?.getTime();
  if (c1 == null || c2 == null || a1 == null || a2 == null) return false;
  return c1 <= a2 && a1 <= c2;
}

/** ¿Es Mupi/Pendón (en cualquiera de sus dos nombres)? */
export function isMupiPendonSupport(support: string): boolean {
  return normalizeSupport(support) in FAMILY;
}

/**
 * ¿El soporte trae detalle de tiendas? Tiene detalle si lista tiendas, o si
 * alguien indicó **explícitamente** «todas» (comentario o captura manual). Un
 * soporte solo «Asignado» (sin comentario) o legacy sin tiendas no lo tiene.
 */
export function hasStoreDetail(support: CampaignSupport): boolean {
  if (support.stores.length > 0) return true;
  return (
    support.scopeSource === 'comment-explicit-all' ||
    support.scopeSource === 'resolution-all' ||
    support.scope === 'invalid' ||
    support.scopeSource === 'comment-ambiguous'
  );
}

export interface EkonStoreContext {
  /** Asignaciones Ekon VIGENTES del número vinculado (activas, sin conflicto). */
  assignments: readonly EkonAssignment[];
  hasEkonLink: boolean;
  hasCompletedBatch: boolean;
}

export interface EkonResolution {
  campaign: ParsedCampaign;
  issues: ConsolidationIssue[];
}

function block(
  campaign: ParsedCampaign,
  support: string,
  code: ConsolidationIssue['code'],
  message: string,
): ConsolidationIssue {
  return { code, campaign: campaign.name, support, message };
}

/**
 * Resuelve las tiendas de los Mupi/Pendón sin detalle de UNA campaña. Si no hay
 * ninguno, devuelve la misma campaña. Un soporte bloqueado se retira de la
 * campaña resultante (no aporta pantallas) y deja su incidencia.
 */
export function resolveNoDetailSupports(
  campaign: ParsedCampaign,
  context: EkonStoreContext,
): EkonResolution {
  const issues: ConsolidationIssue[] = [];
  let changed = false;
  const supports: CampaignSupport[] = [];

  for (const support of campaign.supports) {
    const target = FAMILY[normalizeSupport(support.support)];
    if (!target || hasStoreDetail(support)) {
      supports.push(support);
      continue;
    }
    changed = true;

    if (!context.hasEkonLink) {
      issues.push(
        block(
          campaign,
          support.support,
          'ekon-sin-vinculo',
          `"${support.support}" en "${campaign.name}" no trae detalle de tiendas y la campaña no tiene número Ekon vinculado: no se genera CSV de este soporte. Vincula el número Ekon para tomar sus tiendas.`,
        ),
      );
      continue;
    }
    if (!context.hasCompletedBatch) {
      issues.push(
        block(
          campaign,
          support.support,
          'ekon-sin-lote',
          `"${support.support}" en "${campaign.name}" no trae detalle de tiendas y aún no hay una importación Ekon completada: no se genera CSV de este soporte.`,
        ),
      );
      continue;
    }

    const stores = new Map<string, string>();
    for (const a of context.assignments) {
      if (a.centroAdministrativo || a.conflict) continue;
      if (!periodsOverlap(campaign, a)) continue;
      if (!isCompatibleSupport(a.circuito || a.articulo, target)) continue;
      const numero = normalizeStoreNumber(a.determinanteKey);
      if (numero !== '' && !stores.has(numero)) stores.set(numero, a.tienda);
    }
    if (stores.size === 0) {
      issues.push(
        block(
          campaign,
          support.support,
          'ekon-sin-tiendas',
          `La campaña Ekon vinculada a "${campaign.name}" no trae tiendas de ${target} dentro de la vigencia de la campaña: no se genera CSV de "${support.support}".`,
        ),
      );
      continue;
    }

    supports.push({
      support: support.support,
      owner: classifySupport(support.support),
      stores: [...stores].map(([numero, nombre]) => ({ numero, nombre })),
      scope: 'selected',
      scopeSource: 'resolution-selected',
    });
  }

  return changed
    ? { campaign: { ...campaign, supports }, issues }
    : { campaign, issues };
}

/**
 * Aplica la resolución a un conjunto de campañas. `contextFor` entrega el
 * contexto Ekon de cada una. Conserva todas las propiedades (incluido `id`).
 */
export function resolveCampaignsWithEkon<T extends ParsedCampaign>(
  campaigns: readonly T[],
  contextFor: (campaign: T) => EkonStoreContext,
): { campaigns: T[]; issues: ConsolidationIssue[] } {
  const out: T[] = [];
  const issues: ConsolidationIssue[] = [];
  for (const campaign of campaigns) {
    const r = resolveNoDetailSupports(campaign, contextFor(campaign));
    out.push(
      r.campaign === campaign
        ? campaign
        : ({ ...campaign, ...r.campaign } as T),
    );
    issues.push(...r.issues);
  }
  return { campaigns: out, issues };
}
