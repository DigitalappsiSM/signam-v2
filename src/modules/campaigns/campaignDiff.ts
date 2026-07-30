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

/** Compara las campañas entrantes contra las almacenadas. */
export function diffCampaigns(
  incoming: readonly ParsedCampaign[],
  stored: readonly StoredCampaign[],
): CampaignDiff {
  const storedByKey = new Map(stored.map((s) => [s.nameKey, s]));
  const seen = new Set<string>();

  const added: ParsedCampaign[] = [];
  const modified: CampaignChange[] = [];
  let unchanged = 0;

  for (const c of incoming) {
    const k = campaignKey(c.name);
    seen.add(k);
    const prev = storedByKey.get(k);
    if (!prev) {
      added.push(c);
    } else if (prev.signature !== campaignSignature(c)) {
      modified.push({
        campaign: c,
        stored: prev,
        changes: describeChanges(prev, c),
      });
    } else {
      unchanged += 1;
    }
  }

  const removed = stored.filter((s) => !seen.has(s.nameKey));

  return {
    added,
    removed,
    modified,
    unchanged,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}
