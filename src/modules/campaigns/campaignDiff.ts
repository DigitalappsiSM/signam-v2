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
}

/** Clave de identidad de campaña (por nombre, estable ante cambios de datos). */
export function campaignKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Hash determinístico corto (FNV-1a 32 bits en base36) para compactar la firma
 *  dentro de la identidad y del id de documento. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * **Identidad** de una campaña = nombre + **todos los datos** (vigencia, tipo,
 * vendido por, mes, link y soportes/tiendas). Dos filas con el mismo nombre pero
 * distinta vigencia o distintas tiendas/soportes (p. ej. dos "flights" de la
 * misma campaña) tienen **identidades distintas** y se tratan como campañas
 * separadas. Se usa como llave en el diff, la deduplicación, el seguimiento y el
 * tablero. Formato legible + hash compacto: `nombre#<hash>`.
 *
 * Consecuencia (aceptada): si cambia cualquier dato al reimportar, la identidad
 * cambia; la campaña anterior se ve como eliminada y la nueva como alta, y el
 * seguimiento se asocia a la nueva identidad.
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

export interface CampaignDiff {
  added: ParsedCampaign[];
  removed: StoredCampaign[];
  modified: CampaignChange[];
  unchanged: number;
  hasChanges: boolean;
}

/**
 * Compara las campañas entrantes contra las almacenadas **por identidad** (todos
 * los datos). Como la identidad incluye toda la información, un cambio de
 * cualquier dato produce una identidad nueva: se refleja como **alta** (la
 * versión nueva) + **baja** (la anterior), no como "modificada". `modified`
 * queda vacío por diseño; se conserva en el tipo por compatibilidad.
 */
export function diffCampaigns(
  incoming: readonly ParsedCampaign[],
  stored: readonly StoredCampaign[],
): CampaignDiff {
  // Deduplica el calendario entrante (solo colapsa filas idénticas).
  const merged = dedupeIncoming(incoming);

  // Un representante por **identidad calculada** (todos los datos) + duplicados
  // idénticos en BD (autolimpieza). La identidad se calcula del contenido, no
  // del `nameKey` persistido (que es el nombre, llave estable de Ekon/CSV).
  const storedById = new Map<string, StoredCampaign>();
  const storedExtras: StoredCampaign[] = [];
  for (const s of stored) {
    const id = campaignIdentity(s);
    if (storedById.has(id)) storedExtras.push(s);
    else storedById.set(id, s);
  }

  const seen = new Set<string>();
  const added: ParsedCampaign[] = [];
  let unchanged = 0;

  for (const c of merged) {
    const id = campaignIdentity(c);
    seen.add(id);
    if (storedById.has(id)) unchanged += 1;
    else added.push(c);
  }

  // Se eliminan: las identidades que ya no están en el calendario y los
  // documentos idénticos redundantes de BD (se conserva uno por identidad).
  const removed = [
    ...[...storedById.entries()]
      .filter(([id]) => !seen.has(id))
      .map(([, s]) => s),
    ...storedExtras,
  ];

  return {
    added,
    removed,
    modified: [],
    unchanged,
    hasChanges: added.length > 0 || removed.length > 0,
  };
}
