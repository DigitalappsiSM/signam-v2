import { normalizeSupport } from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

/**
 * Detección de cambios de campañas contra lo guardado en la base de datos.
 *
 * Cada campaña importada del calendario se persiste; al reimportar, se compara
 * contra lo almacenado y solo se guardan los cambios tras la confirmación del
 * usuario. Si no hay cambios, no se reescribe nada.
 */

/** Campaña tal como se guarda en la base de datos. */
export interface StoredCampaign extends ParsedCampaign {
  id: string;
  nameKey: string;
  signature: string;
  /** Baja lógica. Los documentos legacy sin el campo se consideran activos. */
  active?: boolean;
}

/** Clave de identidad de campaña (por nombre, estable ante cambios de datos). */
export function campaignKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Hash determinístico corto (FNV-1a 32 bits en base36) para compactar la firma
 *  dentro de la huella de comparación. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * **Huella** de una campaña = nombre + **todos los datos** (vigencia, tipo,
 * vendido por, mes, link y soportes/tiendas). Dos filas con el mismo nombre pero
 * distinta vigencia o distintas tiendas/soportes (p. ej. dos "flights" de la
 * misma campaña) tienen **identidades distintas** y se tratan como campañas
 * separadas. Se usa para detectar igualdad exacta y deduplicar el archivo, no
 * como identidad persistente. La identidad canónica es `StoredCampaign.id`, que
 * se conserva cuando una línea lógica cambia. Formato: `nombre#<hash>`.
 */
export function campaignIdentity(c: ParsedCampaign): string {
  return `${campaignKey(c.name)}#${hashString(campaignSignature(c))}`;
}

/**
 * Deduplica el calendario entrante por **identidad** (todos los datos): solo se
 * colapsan filas **idénticas** (mismo nombre y mismos datos). Dos campañas con
 * el mismo nombre pero datos distintos se conservan como filas separadas.
 */
export function dedupeIncoming(
  incoming: readonly ParsedCampaign[],
): ParsedCampaign[] {
  const seen = new Set<string>();
  const out: ParsedCampaign[] = [];
  for (const c of incoming) {
    const id = campaignIdentity(c);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(c);
  }
  return out;
}

interface SupportSig {
  support: string;
  stores: string[];
}

function supportSignatures(c: ParsedCampaign): SupportSig[] {
  return c.supports
    .map((s) => ({
      support: normalizeSupport(s.support),
      stores: Array.from(
        new Set(s.stores.map((st) => normalizeStore(st.numero))),
      ).sort(),
    }))
    .sort((a, b) => a.support.localeCompare(b.support));
}

/**
 * Firma de contenido de una campaña (sin el nombre, que es la llave). Cambios
 * en vigencias, tipo, vendido por, soportes o tiendas alteran la firma;
 * reformatos cosméticos (ceros a la izquierda, orden) no.
 */
export function campaignSignature(c: ParsedCampaign): string {
  return JSON.stringify({
    tipo: c.tipo.trim(),
    vendidoPor: c.vendidoPor.trim(),
    inicio: c.fechaInicio.trim(),
    fin: c.fechaFin.trim(),
    mes: c.mes.trim(),
    link: (c.link ?? '').trim(),
    supports: supportSignatures(c),
  });
}

/** Describe en texto los cambios entre una campaña almacenada y una nueva. */
export function describeChanges(
  stored: ParsedCampaign,
  incoming: ParsedCampaign,
): string[] {
  const changes: string[] = [];
  const field = (label: string, a: string, b: string) => {
    if (a.trim() !== b.trim()) changes.push(`${label}: "${a}" → "${b}"`);
  };
  field('Nombre', stored.name, incoming.name);
  field('Vigencia inicio', stored.fechaInicio, incoming.fechaInicio);
  field('Vigencia fin', stored.fechaFin, incoming.fechaFin);
  field('Mes', stored.mes, incoming.mes);
  field('Tipo', stored.tipo, incoming.tipo);
  field('Vendido por', stored.vendidoPor, incoming.vendidoPor);
  field('Link', stored.link ?? '', incoming.link ?? '');

  const oldSup = new Map(supportSignatures(stored).map((s) => [s.support, s]));
  const newSup = new Map(
    supportSignatures(incoming).map((s) => [s.support, s]),
  );

  for (const [name, sig] of newSup) {
    if (!oldSup.has(name)) {
      changes.push(`Soporte agregado: ${name} (${sig.stores.length} tiendas)`);
    }
  }
  for (const [name] of oldSup) {
    if (!newSup.has(name)) changes.push(`Soporte quitado: ${name}`);
  }
  for (const [name, nsig] of newSup) {
    const osig = oldSup.get(name);
    if (!osig) continue;
    const added = nsig.stores.filter((s) => !osig.stores.includes(s));
    const removed = osig.stores.filter((s) => !nsig.stores.includes(s));
    if (added.length || removed.length) {
      const parts: string[] = [];
      if (added.length) parts.push(`+${added.join(', ')}`);
      if (removed.length) parts.push(`-${removed.join(', ')}`);
      changes.push(`Tiendas de ${name}: ${parts.join(' / ')}`);
    }
  }
  return changes;
}

export interface CampaignChange {
  campaign: ParsedCampaign;
  stored: StoredCampaign;
  changes: string[];
}

/** Emparejamiento explícito elegido por el usuario: huella entrante → id guardado. */
export type CampaignMatchSelections = ReadonlyMap<string, string | null>;

export type CampaignMatchReason = 'homonymous' | 'name-change';

/** Caso que SIGNAM no puede emparejar sin riesgo y debe confirmar el usuario. */
export interface CampaignMatchPending {
  incomingIdentity: string;
  campaign: ParsedCampaign;
  candidates: StoredCampaign[];
  reason: CampaignMatchReason;
}

export interface CampaignDiff {
  added: ParsedCampaign[];
  removed: StoredCampaign[];
  modified: CampaignChange[];
  /** Todas las correspondencias resueltas, incluidas las que no cambiaron. */
  matched: Array<{ campaign: ParsedCampaign; stored: StoredCampaign }>;
  unchanged: number;
  pendingMatches: CampaignMatchPending[];
  hasChanges: boolean;
}

/**
 * Compara el calendario contra las campañas guardadas y conserva el `id` de la
 * misma línea lógica:
 * - igualdad exacta por huella → sin cambios;
 * - único entrante y único guardado con el mismo nombre → modificación;
 * - homónimos sin correspondencia inequívoca → confirmación manual;
 * - cambio de nombre con firma idéntica → confirmación manual;
 * - ausentes → baja lógica (solo los que estaban activos).
 */
export function diffCampaigns(
  incoming: readonly ParsedCampaign[],
  stored: readonly StoredCampaign[],
  selections: CampaignMatchSelections = new Map(),
): CampaignDiff {
  const merged = dedupeIncoming(incoming);
  const unmatchedIncoming = new Map(
    merged.map((c) => [campaignIdentity(c), c]),
  );
  const unmatchedStored = new Map(stored.map((c) => [c.id, c]));
  const added: ParsedCampaign[] = [];
  const modified: CampaignChange[] = [];
  const pendingMatches: CampaignMatchPending[] = [];
  const matched: Array<{ campaign: ParsedCampaign; stored: StoredCampaign }> =
    [];
  const forcedNew = new Set(
    [...selections]
      .filter(([, storedId]) => storedId === null)
      .map(([id]) => id),
  );
  let unchanged = 0;

  const pair = (campaign: ParsedCampaign, saved: StoredCampaign) => {
    unmatchedIncoming.delete(campaignIdentity(campaign));
    unmatchedStored.delete(saved.id);
    matched.push({ campaign, stored: saved });
    const changes = describeChanges(saved, campaign);
    if (saved.active === false) changes.unshift('Campaña reactivada');
    if (changes.length === 0) unchanged += 1;
    else modified.push({ campaign, stored: saved, changes });
  };

  // 1) Las selecciones del usuario tienen precedencia, siempre que sigan siendo
  // válidas y no intenten reutilizar el mismo documento dos veces.
  for (const [incomingId, storedId] of selections) {
    if (storedId === null) continue;
    const campaign = unmatchedIncoming.get(incomingId);
    const saved = unmatchedStored.get(storedId);
    if (campaign && saved) pair(campaign, saved);
  }

  // 2) Igualdad exacta de nombre + contenido. Si hubiera duplicados legacy
  // idénticos, solo se empareja automáticamente cuando queda uno a uno.
  const exactIncoming = new Map<string, ParsedCampaign[]>();
  const exactStored = new Map<string, StoredCampaign[]>();
  for (const c of unmatchedIncoming.values()) {
    if (forcedNew.has(campaignIdentity(c))) continue;
    const key = campaignIdentity(c);
    (exactIncoming.get(key) ?? exactIncoming.set(key, []).get(key)!).push(c);
  }
  for (const c of unmatchedStored.values()) {
    const key = campaignIdentity(c);
    (exactStored.get(key) ?? exactStored.set(key, []).get(key)!).push(c);
  }
  for (const [key, inc] of exactIncoming) {
    const saved = exactStored.get(key) ?? [];
    if (inc.length === 1 && saved.length === 1) pair(inc[0]!, saved[0]!);
  }

  // 3) Mismo nombre: si tras retirar las coincidencias exactas queda una sola
  // pareja, es una modificación inequívoca. Cualquier conjunto mayor se pide.
  const names = new Set(
    [...unmatchedIncoming.values()].map((c) => campaignKey(c.name)),
  );
  for (const name of names) {
    const inc = [...unmatchedIncoming.values()].filter(
      (c) =>
        !forcedNew.has(campaignIdentity(c)) && campaignKey(c.name) === name,
    );
    const saved = [...unmatchedStored.values()].filter(
      (c) => campaignKey(c.name) === name,
    );
    if (inc.length === 1 && saved.length === 1) {
      pair(inc[0]!, saved[0]!);
    } else if (inc.length > 0 && saved.length > 0) {
      for (const campaign of inc) {
        pendingMatches.push({
          incomingIdentity: campaignIdentity(campaign),
          campaign,
          candidates: saved,
          reason: 'homonymous',
        });
      }
    }
  }

  // 4) Un cambio de nombre nunca se asume. Solo se propone cuando la firma sin
  // nombre coincide exactamente; el usuario decide el emparejamiento.
  const pendingIncomingIds = new Set(
    pendingMatches.map((p) => p.incomingIdentity),
  );
  for (const campaign of unmatchedIncoming.values()) {
    const incomingId = campaignIdentity(campaign);
    if (forcedNew.has(incomingId)) continue;
    if (pendingIncomingIds.has(incomingId)) continue;
    const candidates = [...unmatchedStored.values()].filter(
      (saved) =>
        campaignKey(saved.name) !== campaignKey(campaign.name) &&
        campaignSignature(saved) === campaignSignature(campaign),
    );
    if (candidates.length > 0) {
      pendingMatches.push({
        incomingIdentity: incomingId,
        campaign,
        candidates,
        reason: 'name-change',
      });
      pendingIncomingIds.add(incomingId);
    }
  }

  // Mientras haya una decisión pendiente, esas campañas y sus candidatas no se
  // reportan prematuramente como altas/bajas.
  const reservedStoredIds = new Set(
    pendingMatches.flatMap((p) => p.candidates.map((c) => c.id)),
  );
  for (const campaign of unmatchedIncoming.values()) {
    if (!pendingIncomingIds.has(campaignIdentity(campaign)))
      added.push(campaign);
  }
  const removed = [...unmatchedStored.values()].filter(
    (c) => c.active !== false && !reservedStoredIds.has(c.id),
  );

  return {
    added,
    removed,
    modified,
    matched,
    unchanged,
    pendingMatches,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}
