import { normalizeSupport } from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import type {
  CampaignSupport,
  ParsedCampaign,
  StoreRef,
} from '@/modules/liverpool-import/campaignParse';
import { parseCampaignDate } from './dateFilter';

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

/** Une los soportes de un grupo de campañas: por soporte normalizado, con la
 *  unión de tiendas (dedup por número normalizado; conserva la primera grafía).
 *
 *  Regla clave: una lista de tiendas **vacía** es un comodín ("todas las
 *  pantallas activas del soporte", ver `consolidate()`). Si alguna ocurrencia del
 *  soporte viene sin tiendas, el resultado se mantiene como comodín (vacío) en
 *  lugar de reducirse a la unión de tiendas explícitas (evita CSV incompletos). */
function mergeSupports(group: readonly ParsedCampaign[]): CampaignSupport[] {
  const bySupport = new Map<
    string,
    {
      support: string;
      owner: CampaignSupport['owner'];
      stores: Map<string, StoreRef>;
      wildcard: boolean;
    }
  >();
  const order: string[] = [];
  for (const c of group) {
    for (const s of c.supports) {
      const k = normalizeSupport(s.support);
      let entry = bySupport.get(k);
      if (!entry) {
        entry = {
          support: s.support,
          owner: s.owner,
          stores: new Map(),
          wildcard: false,
        };
        bySupport.set(k, entry);
        order.push(k);
      }
      if (s.stores.length === 0) {
        entry.wildcard = true; // "Asignada" sin comentario: todas las pantallas.
      }
      for (const st of s.stores) {
        const sk = normalizeStore(st.numero);
        if (!entry.stores.has(sk)) entry.stores.set(sk, st);
      }
    }
  }
  return order.map((k) => {
    const e = bySupport.get(k)!;
    return {
      support: e.support,
      owner: e.owner,
      // Comodín preservado: si alguna ocurrencia no tenía tiendas, va vacío.
      stores: e.wildcard ? [] : [...e.stores.values()],
    };
  });
}

/**
 * Fusiona un grupo de campañas que comparten `campaignKey` (la misma campaña
 * repetida en el calendario) en una sola: unión de soportes/tiendas, **span de
 * fechas más amplio**, mejor link y primer valor no vacío de `vendidoPor`/`mes`.
 * Si los `tipo` no vacíos discrepan, se deja vacío para no asumir clasificación.
 */
function mergeParsedGroup(group: ParsedCampaign[]): ParsedCampaign {
  const rep = group[0]!;
  if (group.length === 1) return rep;

  let earliest = rep;
  let latest = rep;
  for (const c of group) {
    const s = parseCampaignDate(c.fechaInicio);
    const sBest = parseCampaignDate(earliest.fechaInicio);
    if (s && (!sBest || s.getTime() < sBest.getTime())) earliest = c;
    const e = parseCampaignDate(c.fechaFin);
    const eBest = parseCampaignDate(latest.fechaFin);
    if (e && (!eBest || e.getTime() > eBest.getTime())) latest = c;
  }

  const isValidLink = (l: string) => /^https?:\/\//i.test(l.trim());
  const link =
    group.find((c) => isValidLink(c.link ?? ''))?.link ??
    group.find((c) => (c.link ?? '').trim() !== '')?.link ??
    rep.link;

  const firstNonEmpty = (pick: (c: ParsedCampaign) => string) =>
    group.map(pick).find((v) => v.trim() !== '') ?? '';

  // Tipo: si las grafías no vacías coinciden (ignorando caja/espacios) se usa;
  // si discrepan, se deja vacío (Pendiente) para forzar decisión explícita.
  const distinctTipos = new Set(
    group.map((c) => c.tipo.trim().toUpperCase()).filter((v) => v !== ''),
  );
  const tipo = distinctTipos.size === 1 ? firstNonEmpty((c) => c.tipo) : '';

  return {
    ...rep,
    tipo,
    vendidoPor: firstNonEmpty((c) => c.vendidoPor) || rep.vendidoPor,
    fechaInicio: earliest.fechaInicio,
    fechaFin: latest.fechaFin,
    mes: firstNonEmpty((c) => c.mes) || rep.mes,
    link,
    supports: mergeSupports(group),
  };
}

/**
 * Deduplica el calendario entrante por `campaignKey`: fusiona filas repetidas de
 * la misma campaña en una sola (conserva el orden de aparición). Evita que el
 * mismo nombre se persista como varios documentos.
 */
export function dedupeIncoming(
  incoming: readonly ParsedCampaign[],
): ParsedCampaign[] {
  const groups = new Map<string, ParsedCampaign[]>();
  const order: string[] = [];
  for (const c of incoming) {
    const k = campaignKey(c.name);
    const g = groups.get(k);
    if (g) {
      g.push(c);
    } else {
      groups.set(k, [c]);
      order.push(k);
    }
  }
  return order.map((k) => mergeParsedGroup(groups.get(k)!));
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
  // Deduplica el calendario entrante (misma campaña repetida → una sola).
  const merged = dedupeIncoming(incoming);

  // Representante por nameKey + duplicados redundantes en BD (para autolimpieza).
  const storedByKey = new Map<string, StoredCampaign>();
  const storedExtras: StoredCampaign[] = [];
  for (const s of stored) {
    if (storedByKey.has(s.nameKey)) storedExtras.push(s);
    else storedByKey.set(s.nameKey, s);
  }

  const seen = new Set<string>();
  const added: ParsedCampaign[] = [];
  const modified: CampaignChange[] = [];
  let unchanged = 0;

  for (const c of merged) {
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

  // Se eliminan: los representantes que ya no están en el calendario y **todos**
  // los duplicados redundantes de BD (se conserva un documento por nameKey).
  const removed = [
    ...[...storedByKey.values()].filter((s) => !seen.has(s.nameKey)),
    ...storedExtras,
  ];

  return {
    added,
    removed,
    modified,
    unchanged,
    hasChanges: added.length > 0 || removed.length > 0 || modified.length > 0,
  };
}
