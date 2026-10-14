import { classifySupport, normalizeSupport, type AdmiraScreen } from '@/domain';
import {
  allowedSupportsFor,
  canonicalCircuit,
  isCompatibleSupport,
  normalizeStoreNumber,
  reconcileCampaign,
  type EkonAssignment,
  type StoreReconciliationDetail,
} from '@/domain/ekon';
import {
  isMupiPendonSupport,
  periodsOverlap,
  resolveNoDetailSupports,
} from '@/modules/consolidation/instoreEkon';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import type {
  CampaignSupport,
  ParsedCampaign,
} from '@/modules/liverpool-import/campaignParse';

/**
 * Confirmación de soportes/tiendas Calendario ↔ Ekon.
 *
 * El Calendario Liverpool se captura a mano y puede traer un soporte o una
 * tienda equivocados (caso real: APPLE vino como `MUPPI'S` cuando se pautó en
 * `BANNER DIGITAL`, y Ekon sí lo tenía correcto). Cuando la campaña tiene
 * número Ekon vinculado, SIGNAM compara **tienda por tienda** el soporte del
 * calendario contra el circuito Ekon (sin fechas: solo cuentan las
 * asignaciones cuyo periodo se traslapa con la vigencia, para no mezclar
 * flights) y, si difieren, levanta un **aviso visual** que no bloquea nada.
 *
 * Un admin/operator decide, con motivo obligatorio e historial:
 * - `ekon`: los soportes con tiendas se reemplazan por los de Ekon. Cada
 *   circuito Ekon se traduce al soporte Liverpool que el catálogo Admira tiene
 *   en esa tienda; si hay más de un candidato, el usuario elige.
 * - `calendar`: se conserva el calendario y se apaga el aviso.
 *
 * La decisión vive en `campaignSupportOverrides/{campaignId}`, separada de la
 * campaña importada: la reimportación del calendario nunca la toca. Si el
 * calendario o Ekon cambian después de confirmar, la decisión se sigue
 * aplicando y el aviso vuelve como «Revisar».
 */

export type SupportOverrideDecision = 'ekon' | 'calendar';

export interface SupportOverrideHistoryEntry {
  at: number;
  by: string;
  decision: SupportOverrideDecision;
  reason: string;
  ekonNumber: number | null;
  calendarFingerprint: string;
  ekonFingerprint: string;
  /** Soportes finales confirmados (vacío en `calendar`). */
  supports: CampaignSupport[];
}

export interface CampaignSupportOverride {
  id: string;
  campaignId: string;
  campaignName: string;
  decision: SupportOverrideDecision;
  /** Soportes finales que reemplazan a los del calendario (solo `ekon`). */
  supports: CampaignSupport[];
  reason: string;
  ekonNumber: number | null;
  calendarFingerprint: string;
  ekonFingerprint: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  /** Historial append-only de decisiones. */
  history: SupportOverrideHistoryEntry[];
}

type CampaignLike = Pick<
  ParsedCampaign,
  'name' | 'fechaInicio' | 'fechaFin' | 'supports'
>;

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Asignaciones Ekon comparables con la vigencia de la campaña. */
export function overlappingAssignments(
  campaign: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
  assignments: readonly EkonAssignment[],
): EkonAssignment[] {
  return assignments.filter((a) => !a.conflict && periodsOverlap(campaign, a));
}

/** Huella estable de soportes y tiendas del calendario (orden irrelevante). */
export function calendarFingerprint(campaign: CampaignLike): string {
  const lines = campaign.supports
    .map((s) =>
      [
        normalizeSupport(s.support),
        s.scope ?? '',
        s.scopeSource ?? '',
        s.stores
          .map((st) => normalizeStore(st.numero))
          .sort()
          .join(','),
      ].join('|'),
    )
    .sort();
  return fnv1a(lines.join('\n'));
}

/** Huella estable de circuito + tienda de las asignaciones Ekon comparables. */
export function ekonFingerprint(
  campaign: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
  assignments: readonly EkonAssignment[],
): string {
  const lines = overlappingAssignments(campaign, assignments)
    .filter((a) => !a.centroAdministrativo)
    .map(
      (a) =>
        `${normalizeSupport(a.circuito || a.articulo)}|${normalizeStoreNumber(a.determinanteKey)}`,
    );
  return fnv1a([...new Set(lines)].sort().join('\n'));
}

/**
 * Tiendas cuyo soporte del calendario no corresponde al circuito Ekon (o que
 * están solo de un lado). Vacío si coinciden o si no hay nada comparable.
 *
 * - Mupi/Pendón sin detalle se resuelven antes con Ekon (no son diferencia).
 * - Un soporte del calendario sin lista de tiendas (p. ej. circuito completo)
 *   no se compara tienda por tienda: las asignaciones Ekon de su circuito se
 *   dejan fuera para no inventar «solo Ekon».
 */
export function detectSupportDiscrepancies(
  campaign: CampaignLike,
  assignments: readonly EkonAssignment[],
): StoreReconciliationDetail[] {
  const comparable = overlappingAssignments(campaign, assignments).filter(
    (a) => !a.centroAdministrativo,
  );
  if (comparable.length === 0) return [];

  const resolved = resolveNoDetailSupports(
    { ...campaign, row: 0, tipo: '', vendidoPor: '', mes: '', link: '' },
    { assignments: comparable, hasEkonLink: true, hasCompletedBatch: true },
  ).campaign;
  const withStores = resolved.supports.filter((s) => s.stores.length > 0);
  const withoutStores = resolved.supports.filter((s) => s.stores.length === 0);
  const ekon = comparable.filter(
    (a) =>
      !withoutStores.some((s) =>
        isCompatibleSupport(a.circuito || a.articulo, s.support),
      ),
  );
  if (ekon.length === 0 && withStores.length === 0) return [];

  const result = reconcileCampaign(
    {
      name: campaign.name,
      fechaInicio: campaign.fechaInicio,
      fechaFin: campaign.fechaFin,
      supports: withStores.map((s) => ({
        support: s.support,
        stores: s.stores,
      })),
    },
    '',
    ekon,
  );
  if (!result.stores.applies) return [];
  return result.stores.details.filter((d) => d.status !== 'matched');
}

/** Tienda + circuito Ekon con más de un soporte Liverpool posible. */
export interface SupportChoice {
  key: string;
  storeNumber: string;
  storeName: string;
  circuit: string;
  candidates: string[];
}

export function supportChoiceKey(storeNumber: string, circuit: string): string {
  return `${storeNumber}|${circuit}`;
}

export interface EkonSupportsResult {
  /** Soportes finales (Ekon + soportes sin detalle que Ekon no cubre). */
  supports: CampaignSupport[];
  /** Combinaciones que el usuario debe elegir antes de confirmar. */
  pending: SupportChoice[];
}

/**
 * Soportes finales al usar Ekon. Cada asignación se traduce al soporte
 * Liverpool que el catálogo Admira tiene **activo** en esa tienda entre los
 * permitidos para su circuito. Si hay uno, se usa; si hay varios (o ninguno),
 * el usuario elige en `choices`.
 *
 * Los soportes del calendario CON tiendas se reemplazan. Los que no traen
 * tiendas y ningún circuito Ekon cubre se conservan tal cual (Ekon no dice
 * nada de ellos); Mupi/Pendón sin detalle se descartan porque Ekon los cubre.
 */
export function buildEkonSupports(
  campaign: CampaignLike,
  assignments: readonly EkonAssignment[],
  screens: readonly Pick<AdmiraScreen, 'original' | 'metadata'>[],
  choices: Readonly<Record<string, string>> = {},
): EkonSupportsResult {
  const catalog = new Map<string, Set<string>>();
  for (const s of screens) {
    if (s.metadata.active === false) continue;
    const store = normalizeStore(s.original['Numero de Tienda']);
    const support = normalizeSupport(s.metadata.calendarSupport ?? '');
    if (!store || !support) continue;
    (catalog.get(store) ?? catalog.set(store, new Set()).get(store)!).add(
      support,
    );
  }

  const comparable = overlappingAssignments(campaign, assignments).filter(
    (a) => !a.centroAdministrativo,
  );
  const bySupport = new Map<string, Map<string, string>>();
  const pending = new Map<string, SupportChoice>();
  for (const a of comparable) {
    const circuit = canonicalCircuit(a.circuito || a.articulo);
    if (!circuit) continue;
    const storeNumber = normalizeStoreNumber(a.determinanteKey);
    if (!storeNumber) continue;
    const allowed = allowedSupportsFor(circuit);
    const inCatalog = allowed.filter((s) =>
      catalog.get(normalizeStore(storeNumber))?.has(normalizeSupport(s)),
    );
    const key = supportChoiceKey(storeNumber, circuit);
    const chosen = choices[key];
    let support: string | undefined;
    if (chosen && allowed.includes(chosen)) support = chosen;
    else if (inCatalog.length === 1) support = inCatalog[0];
    if (!support) {
      pending.set(key, {
        key,
        storeNumber,
        storeName: a.tienda,
        circuit,
        candidates: inCatalog.length > 1 ? inCatalog : [...allowed],
      });
      continue;
    }
    const stores =
      bySupport.get(support) ?? bySupport.set(support, new Map()).get(support)!;
    if (!stores.has(storeNumber)) stores.set(storeNumber, a.tienda);
  }

  const kept = campaign.supports.filter(
    (s) =>
      s.stores.length === 0 &&
      !isMupiPendonSupport(s.support) &&
      !comparable.some((a) =>
        isCompatibleSupport(a.circuito || a.articulo, s.support),
      ),
  );
  const fromEkon: CampaignSupport[] = [...bySupport].map(
    ([support, stores]) => ({
      support,
      owner: classifySupport(support),
      stores: [...stores].map(([numero, nombre]) => ({ numero, nombre })),
      scope: 'selected',
      scopeSource: 'resolution-selected',
    }),
  );
  return { supports: [...fromEkon, ...kept], pending: [...pending.values()] };
}

/** Estado del aviso de una campaña. */
export type SupportReviewState =
  /** Sin vínculo Ekon, sin datos comparables o calendario = Ekon. */
  | 'none'
  /** Difieren y nadie ha confirmado. */
  | 'pending'
  /** Confirmado y nada cambió desde entonces. */
  | 'confirmed'
  /** Confirmado, pero el calendario o Ekon cambiaron después. */
  | 'stale';

/** Texto del aviso visible en Campañas y Seguimiento. */
export const SUPPORT_REVIEW_LABELS: Record<
  Exclude<SupportReviewState, 'none'>,
  string
> = {
  pending: 'Soporte/tiendas difieren de Ekon',
  stale: 'Revisar: cambió desde la confirmación',
  confirmed: 'Soportes confirmados',
};

export function supportReviewState(
  campaign: CampaignLike,
  assignments: readonly EkonAssignment[] | undefined,
  override: CampaignSupportOverride | undefined,
  /**
   * Número Ekon vinculado HOY (`undefined` = aún no se sabe). Si ya no es el
   * de la confirmación (desvinculada o cambiada), la decisión está vencida.
   */
  currentEkonNumber?: number | null,
): SupportReviewState {
  if (
    override &&
    currentEkonNumber !== undefined &&
    currentEkonNumber !== override.ekonNumber
  ) {
    return 'stale';
  }
  if (!assignments) return override ? 'confirmed' : 'none';
  if (override) {
    const same =
      override.calendarFingerprint === calendarFingerprint(campaign) &&
      override.ekonFingerprint === ekonFingerprint(campaign, assignments);
    return same ? 'confirmed' : 'stale';
  }
  return detectSupportDiscrepancies(campaign, assignments).length > 0
    ? 'pending'
    : 'none';
}

/**
 * Aplica las decisiones `ekon` confirmadas: reemplaza los soportes de la
 * campaña por los confirmados. No muta. Las decisiones `calendar` no cambian
 * nada. Úsese ANTES de `resolveCampaignsWithEkon` / `consolidate`.
 */
export function applySupportOverrides<
  T extends { id: string; supports: CampaignSupport[] },
>(
  campaigns: readonly T[],
  overrides: ReadonlyMap<string, CampaignSupportOverride>,
): T[] {
  if (overrides.size === 0) return [...campaigns];
  return campaigns.map((campaign) => {
    const override = overrides.get(campaign.id);
    if (!override || override.decision !== 'ekon') return campaign;
    return { ...campaign, supports: override.supports };
  });
}
