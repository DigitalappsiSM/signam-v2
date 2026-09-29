import { normalizeStore } from '@/modules/consolidation/consolidate';
import { isMupiPendonSupport } from '@/modules/consolidation/instoreEkon';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import { classifySupport, normalizeSupport, type AdmiraScreen } from '@/domain';
import type { CampaignManualOverrides } from './campaignCorrection';
import {
  MAX_CAMPAIGN_YEAR,
  MIN_CAMPAIGN_YEAR,
} from '@/modules/liverpool-import/campaignDateValidation';
import type {
  CampaignSupport,
  ParsedCampaign,
  StoreRef,
} from '@/modules/liverpool-import/campaignParse';

/**
 * Campañas **manuales** (p. ej. samplings o campañas de proveedor que Liverpool
 * no sube a su calendario).
 *
 * Regla de negocio: una campaña manual es una campaña normal de SIGNAM. Vive en
 * `campaigns`, consolida, genera CSV de Admira y Quividi, y **siempre** tiene
 * seguimiento operativo (checks, testigos, aprobaciones). Lo único que la
 * distingue es su **origen** (`origin: 'manual'`), que es independiente de su
 * clasificación comercial (`tipo`).
 *
 * Como Liverpool puede subir después una campaña que ya se cargó a mano, la
 * importación del calendario compara cada fila nueva contra las manuales aún no
 * vinculadas (ver `scoreManualMatch`) y propone **adoptarla** en lugar de
 * duplicarla. Nunca se fusiona en silencio.
 */

/** Origen del registro. Los documentos legacy sin el campo son `liverpool`. */
export type CampaignOrigin = 'liverpool' | 'manual';

/** Metadatos de origen. Se guardan aparte de los datos importados del calendario. */
export interface CampaignOriginMeta {
  origin?: CampaignOrigin;
  /** Se fija al adoptar una manual: el calendario de Liverpool ya la trae. */
  adoptedFromManualAt?: number;
  adoptedFromManualBy?: string;
  /** Datos de la versión manual, conservados como historial al adoptar. */
  manualSnapshot?: Pick<
    ParsedCampaign,
    'name' | 'tipo' | 'fechaInicio' | 'fechaFin' | 'supports'
  > & { manualOverrides?: CampaignManualOverrides };
}

export const MANUAL_CAMPAIGN_TIPOS = [
  'Institucional',
  'Proveedor',
  'Sampling',
] as const;
export type ManualCampaignTipo = (typeof MANUAL_CAMPAIGN_TIPOS)[number];

export function campaignOrigin(campaign: CampaignOriginMeta): CampaignOrigin {
  return campaign.origin === 'manual' ? 'manual' : 'liverpool';
}

/** Manual **aún no adoptada** por el calendario de Liverpool. */
export function isPendingManualCampaign(campaign: CampaignOriginMeta): boolean {
  return campaignOrigin(campaign) === 'manual';
}

export interface ManualCampaignSupportInput {
  support: string;
  /**
   * `all` = todas las tiendas del soporte; `selected` = solo `stores`; `ekon` =
   * sin detalle: SIGNAM toma las tiendas de la campaña Ekon vinculada (solo
   * Mupi/Pendón, ver `consolidation/instoreEkon.ts`).
   */
  scope: 'all' | 'selected' | 'ekon';
  stores: StoreRef[];
}

export interface ManualCampaignInput {
  name: string;
  tipo: string;
  /** `YYYY-MM-DD` (valor de `input type="date"`). */
  fechaInicio: string;
  fechaFin: string;
  supports: ManualCampaignSupportInput[];
  link?: string;
  vendidoPor?: string;
}

const MONTHS = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

/** Errores bloqueantes del alta manual (vacío = válida). */
export function validateManualCampaign(input: ManualCampaignInput): string[] {
  const errors: string[] = [];
  if (input.name.trim() === '')
    errors.push('El nombre de la campaña es obligatorio.');
  if (!(MANUAL_CAMPAIGN_TIPOS as readonly string[]).includes(input.tipo)) {
    errors.push('Elige un tipo de campaña de la lista.');
  }
  const start = parseCampaignDate(input.fechaInicio);
  const end = parseCampaignDate(input.fechaFin);
  if (!start) errors.push('La fecha de inicio no es válida.');
  if (!end) errors.push('La fecha de fin no es válida.');
  for (const [label, date] of [
    ['inicio', start],
    ['fin', end],
  ] as const) {
    if (
      date &&
      (date.getUTCFullYear() < MIN_CAMPAIGN_YEAR ||
        date.getUTCFullYear() > MAX_CAMPAIGN_YEAR)
    ) {
      errors.push(
        `La fecha de ${label} debe estar entre los años ${MIN_CAMPAIGN_YEAR} y ${MAX_CAMPAIGN_YEAR}.`,
      );
    }
  }
  if (start && end && start.getTime() > end.getTime()) {
    errors.push('La fecha de inicio no puede ser posterior a la de fin.');
  }
  if (input.supports.length === 0) {
    errors.push('Agrega al menos un soporte.');
  }
  const seen = new Set<string>();
  for (const s of input.supports) {
    const key = normalizeSupport(s.support);
    if (key === '') {
      errors.push('Hay un soporte sin nombre.');
      continue;
    }
    if (seen.has(key)) errors.push(`El soporte "${s.support}" está repetido.`);
    seen.add(key);
    if (s.scope === 'ekon' && !isMupiPendonSupport(s.support)) {
      errors.push(
        `«Tiendas de Ekon» solo aplica a Mupi y Pendón; elige tiendas para "${s.support}".`,
      );
    }
    if (s.scope === 'selected' && s.stores.length === 0) {
      errors.push(
        `El soporte "${s.support}" no tiene tiendas: elige tiendas o marca "todas".`,
      );
    }
  }
  return errors;
}

/** Convierte el formulario en una campaña con la misma forma que la importada. */
export function buildManualCampaign(
  input: ManualCampaignInput,
): ParsedCampaign {
  const start = parseCampaignDate(input.fechaInicio);
  const supports: CampaignSupport[] = input.supports.map((s) => ({
    support: s.support.trim(),
    owner: classifySupport(s.support),
    stores: s.scope === 'selected' ? s.stores : [],
    // `ekon` = sin detalle (equivale a «Asignada» sin comentario en el
    // calendario): las tiendas se resuelven desde Ekon al consolidar.
    scope: s.scope === 'selected' ? 'selected' : 'all',
    scopeSource:
      s.scope === 'all'
        ? 'resolution-all'
        : s.scope === 'ekon'
          ? 'no-comment'
          : 'resolution-selected',
  }));
  return {
    row: 0,
    name: input.name.trim().replace(/\s+/g, ' '),
    tipo: input.tipo,
    vendidoPor: (input.vendidoPor ?? '').trim(),
    fechaInicio: input.fechaInicio.trim(),
    fechaFin: input.fechaFin.trim(),
    mes: start ? (MONTHS[start.getUTCMonth()] ?? '') : '',
    link: (input.link ?? '').trim(),
    supports,
  };
}

// ---------------------------------------------------------------------------
// Coincidencia manual ↔ calendario
// ---------------------------------------------------------------------------

function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type NameRelation = 'equal' | 'similar' | 'none';

/** Igual (sin acentos/puntuación), contenido uno en otro, o ≥60 % de palabras. */
export function nameRelation(a: string, b: string): NameRelation {
  const x = foldName(a);
  const y = foldName(b);
  if (x === '' || y === '') return 'none';
  if (x === y) return 'equal';
  if (x.includes(y) || y.includes(x)) return 'similar';
  const tx = new Set(x.split(' '));
  const ty = new Set(y.split(' '));
  const common = [...tx].filter((t) => ty.has(t)).length;
  const union = new Set([...tx, ...ty]).size;
  return common / union >= 0.6 ? 'similar' : 'none';
}

export type DatesRelation = 'exact' | 'overlap' | 'none';

export function datesRelation(
  a: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
  b: Pick<ParsedCampaign, 'fechaInicio' | 'fechaFin'>,
): DatesRelation {
  const a1 = parseCampaignDate(a.fechaInicio)?.getTime();
  const a2 = parseCampaignDate(a.fechaFin)?.getTime();
  const b1 = parseCampaignDate(b.fechaInicio)?.getTime();
  const b2 = parseCampaignDate(b.fechaFin)?.getTime();
  if (a1 == null || a2 == null || b1 == null || b2 == null) return 'none';
  if (a1 === b1 && a2 === b2) return 'exact';
  return a1 <= b2 && b1 <= a2 ? 'overlap' : 'none';
}

/** Fracción de tiendas compartidas (por soporte compartido) sobre las de la menor. */
function storesOverlap(a: ParsedCampaign, b: ParsedCampaign): number {
  const bySupport = (c: ParsedCampaign) =>
    new Map(
      c.supports.map((s) => [
        normalizeSupport(s.support),
        new Set(s.stores.map((st) => normalizeStore(st.numero))),
      ]),
    );
  const ma = bySupport(a);
  const mb = bySupport(b);
  let shared = 0;
  let smallest = 0;
  let supportsInCommon = 0;
  for (const [support, sa] of ma) {
    const sb = mb.get(support);
    if (!sb) continue;
    supportsInCommon += 1;
    // Conjunto vacío = "todas las tiendas": se considera solapado por completo.
    if (sa.size === 0 || sb.size === 0) {
      shared += 1;
      smallest += 1;
      continue;
    }
    shared += [...sa].filter((s) => sb.has(s)).length;
    smallest += Math.min(sa.size, sb.size);
  }
  return supportsInCommon === 0 || smallest === 0 ? 0 : shared / smallest;
}

export type ManualMatchLevel = 'strong' | 'partial';

export interface ManualMatch {
  level: ManualMatchLevel;
  /** Motivos legibles para mostrar al usuario. */
  reasons: string[];
}

/**
 * Evalúa si `other` (fila del calendario, o alta manual en curso) parece la
 * misma campaña que la manual `manual`.
 *
 * - **strong**: nombre igual y fechas idénticas → se sugiere adoptar.
 * - **partial**: nombre igual o similar con fechas distintas/traslapadas, o
 *   fechas idénticas con nombre similar, o mismas fechas y tiendas casi iguales
 *   → "posible duplicado", lo decide una persona.
 * - `null`: sin relación suficiente.
 */
export function scoreManualMatch(
  other: ParsedCampaign,
  manual: ParsedCampaign,
): ManualMatch | null {
  const name = nameRelation(other.name, manual.name);
  const dates = datesRelation(other, manual);
  const stores = storesOverlap(other, manual);
  const reasons: string[] = [];
  if (name === 'equal') reasons.push('mismo nombre');
  else if (name === 'similar') reasons.push('nombre similar');
  if (dates === 'exact') reasons.push('mismas fechas');
  else if (dates === 'overlap') reasons.push('fechas traslapadas');
  if (stores > 0)
    reasons.push(`${Math.round(stores * 100)} % de tiendas en común`);

  if (name === 'equal' && dates === 'exact')
    return { level: 'strong', reasons };
  if (name !== 'none' && dates !== 'none') return { level: 'partial', reasons };
  // Mismas fechas y prácticamente las mismas tiendas aunque el nombre difiera.
  if (dates === 'exact' && stores >= 0.8) return { level: 'partial', reasons };
  // Mismo nombre exacto con fechas distintas y sin traslape: puede ser otro
  // flight de la misma marca; se avisa pero no se sugiere adoptar.
  if (name === 'equal') return { level: 'partial', reasons };
  return null;
}

// ---------------------------------------------------------------------------
// Opciones del formulario (soportes y tiendas del catálogo)
// ---------------------------------------------------------------------------

export interface ManualSupportOption {
  support: string;
  stores: StoreRef[];
}

/**
 * Soportes del calendario con pantallas **activas** en el catálogo y las tiendas
 * donde existen. Una manual solo puede apuntar a lo que el catálogo sabe
 * programar; si no, la consolidación la reportaría como incidencia.
 */
export function manualSupportOptions(
  screens: readonly AdmiraScreen[],
): ManualSupportOption[] {
  const bySupport = new Map<string, Map<string, StoreRef>>();
  const labels = new Map<string, string>();
  for (const screen of screens) {
    const support = screen.metadata.calendarSupport?.trim();
    if (!support || !screen.metadata.active) continue;
    const key = normalizeSupport(support);
    labels.set(key, labels.get(key) ?? support);
    const stores = bySupport.get(key) ?? new Map<string, StoreRef>();
    const numero = normalizeStore(screen.original['Numero de Tienda']);
    if (numero !== '' && !stores.has(numero)) {
      stores.set(numero, {
        numero,
        nombre: screen.original['Nombre de tienda'] ?? '',
      });
    }
    bySupport.set(key, stores);
  }
  return [...bySupport]
    .map(([key, stores]) => ({
      support: labels.get(key) ?? key,
      stores: [...stores.values()].sort((a, b) =>
        a.numero.localeCompare(b.numero, 'es', { numeric: true }),
      ),
    }))
    .sort((a, b) => a.support.localeCompare(b.support, 'es'));
}

export interface ManualDuplicateReport {
  /** Bloquea el alta: nombre y fechas iguales a una campaña existente. */
  blocking: Array<{
    campaign: ParsedCampaign & { id: string };
    match: ManualMatch;
  }>;
  /** Pide confirmación explícita: se parece pero no es igual. */
  warnings: Array<{
    campaign: ParsedCampaign & { id: string };
    match: ManualMatch;
  }>;
}

/**
 * Antes de crear una manual se busca si ya existe (de Liverpool o manual): si
 * Liverpool ya la subió, crearla duplicaría campaña, seguimiento y CSV.
 */
export function findManualDuplicates(
  candidate: ParsedCampaign,
  existing: ReadonlyArray<ParsedCampaign & { id: string; active?: boolean }>,
): ManualDuplicateReport {
  const report: ManualDuplicateReport = { blocking: [], warnings: [] };
  for (const campaign of existing) {
    if (campaign.active === false) continue;
    const match = scoreManualMatch(candidate, campaign);
    if (!match) continue;
    (match.level === 'strong' ? report.blocking : report.warnings).push({
      campaign,
      match,
    });
  }
  return report;
}

/**
 * Id determinístico de una campaña manual (nombre normalizado + fechas civiles).
 * Sirve de cerrojo: dos altas simultáneas de la misma campaña apuntan al mismo
 * documento y la segunda se rechaza dentro de la transacción.
 */
export function manualCampaignId(
  campaign: Pick<ParsedCampaign, 'name' | 'fechaInicio' | 'fechaFin'>,
): string {
  const iso = (v: string) =>
    parseCampaignDate(v)?.toISOString().slice(0, 10) ?? v.trim();
  const raw = `${foldName(campaign.name)}|${iso(campaign.fechaInicio)}|${iso(campaign.fechaFin)}`;
  let h = 0x811c9dc5;
  let g = 0x01000193;
  for (let i = 0; i < raw.length; i += 1) {
    h = Math.imul(h ^ raw.charCodeAt(i), 0x01000193);
    g = Math.imul(g ^ raw.charCodeAt(i), 0x85ebca6b);
  }
  return `manual-${(h >>> 0).toString(36)}${(g >>> 0).toString(36)}`;
}
