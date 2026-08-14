import { canonicalCircuit } from './supportMapping';
import { normalizeStoreNumber } from './normalization';
import { normalizeSupport } from '../support';
import type { EkonAssignment } from './models';

/**
 * Lógica de decisión del fallback Ekon para CSV.
 *
 * Amplía el flujo existente ÚNICAMENTE para dos soportes:
 * - `MEGA MUPI DIGITAL`
 * - `BANNER DIGITAL`
 *
 * Precedencia:
 * 1. Si el soporte viene marcado en Liverpool, se usa el flujo Liverpool actual.
 * 2. Si no viene marcado, se evalúa el fallback Ekon.
 * 3. Nunca se generan ambos caminos para la misma campaña/soporte.
 * 4. Ningún otro soporte puede sintetizarse desde Ekon.
 *
 * El fallback solo aporta la SEÑAL (Ekon dice que el soporte debe existir) y su
 * clasificación comercial. Liverpool conserva fechas y universo de tiendas; el
 * Master resuelve las pantallas físicas por número de tienda + NORMALIZACION
 * LIVERPOOL, separando por resolución con las reglas actuales.
 */

/** Soportes Liverpool que el fallback puede resolver. Cerrado a estos dos. */
export const FALLBACK_SUPPORT_MEGA_MUPI = 'MEGA MUPI DIGITAL' as const;
export const FALLBACK_SUPPORT_BANNER = 'BANNER DIGITAL' as const;
export const FALLBACK_SUPPORTS = [
  FALLBACK_SUPPORT_MEGA_MUPI,
  FALLBACK_SUPPORT_BANNER,
] as const;

export type FallbackSupport = (typeof FALLBACK_SUPPORTS)[number];

/**
 * Soporte Liverpool que un circuito Ekon puede sintetizar por fallback:
 * - `MEGA MUPI` (incluye alias `MEGA MUPI DIGITAL`) → `MEGA MUPI DIGITAL`.
 * - `ESPECTACULAR IN STORE` → `BANNER DIGITAL`.
 * Cualquier otro circuito → `null` (no participa en el fallback).
 */
export function fallbackSupportForCircuit(
  articulo: string,
): FallbackSupport | null {
  const circuit = canonicalCircuit(articulo);
  if (circuit === 'MEGA MUPI') return FALLBACK_SUPPORT_MEGA_MUPI;
  if (circuit === 'ESPECTACULAR IN STORE') return FALLBACK_SUPPORT_BANNER;
  return null;
}

/** Soporte sintético a inyectar en la consolidación (soporte + tiendas). */
export interface SyntheticSupport {
  support: FallbackSupport;
  stores: { numero: string }[];
}

/** Incidencia que bloquea o explica el fallback. */
export interface FallbackIssue {
  code: 'sin-tiendas-operativas' | 'sin-lote-completado' | 'sin-vinculo-ekon';
  support: FallbackSupport | null;
  message: string;
}

export interface FallbackPlanInput {
  /** Soportes ya marcados en Liverpool para la campaña (texto literal). */
  markedSupports: readonly string[];
  /** Asignaciones Ekon VIGENTES del número vinculado (activas, sin conflicto). */
  assignments: readonly EkonAssignment[];
  /** Universo de tiendas operativas Liverpool (números, ya normalizados o no). */
  operativeStores: readonly string[];
  /** true si existe al menos un lote Ekon completado. */
  hasCompletedBatch: boolean;
  /** true si la campaña tiene vínculo manual Ekon. */
  hasEkonLink: boolean;
}

export interface FallbackPlan {
  syntheticSupports: SyntheticSupport[];
  issues: FallbackIssue[];
}

/**
 * Reúne el universo de tiendas operativas de una campaña Liverpool a partir de
 * sus soportes con tiendas explícitas (nunca expande a "todas las tiendas").
 */
export function collectOperativeStores(
  supports: readonly { stores: { numero: string }[] }[],
): string[] {
  const set = new Set<string>();
  for (const support of supports) {
    for (const store of support.stores) {
      const n = normalizeStoreNumber(store.numero);
      if (n !== '') set.add(n);
    }
  }
  return [...set].sort();
}

/**
 * Decide qué soportes sintéticos añadir por fallback y con qué tiendas, o qué
 * incidencias bloquean la generación. Puro. No toca el CSV: solo produce las
 * entradas de soporte que la consolidación normal resolverá contra el Master,
 * conservando encabezados, columna guarda, BOM, escape y llave
 * `Campaña + RESOLUCION`.
 */
export function planFallbackSupports(input: FallbackPlanInput): FallbackPlan {
  const issues: FallbackIssue[] = [];
  const syntheticSupports: SyntheticSupport[] = [];

  if (!input.hasEkonLink) {
    return { syntheticSupports, issues };
  }
  if (!input.hasCompletedBatch) {
    // Sin lote completado no hay señal utilizable; no se sintetiza nada.
    return { syntheticSupports, issues };
  }

  const marked = new Set(input.markedSupports.map((s) => normalizeSupport(s)));
  const operative = [
    ...new Set(input.operativeStores.map(normalizeStoreNumber)),
  ].filter((n) => n !== '');

  // Circuitos Ekon vigentes → soportes fallback candidatos (deduplicados).
  const candidates = new Set<FallbackSupport>();
  for (const a of input.assignments) {
    const target = fallbackSupportForCircuit(a.articulo);
    if (target) candidates.add(target);
  }

  for (const support of FALLBACK_SUPPORTS) {
    if (!candidates.has(support)) continue;
    // Precedencia: si Liverpool ya marca el soporte, el fallback NO participa.
    if (marked.has(normalizeSupport(support))) continue;
    // Sin tiendas operativas utilizables: se bloquea, nunca se expande al Master.
    if (operative.length === 0) {
      issues.push({
        code: 'sin-tiendas-operativas',
        support,
        message: `No se puede generar ${support}: sin tiendas operativas disponibles.`,
      });
      continue;
    }
    syntheticSupports.push({
      support,
      stores: operative.map((numero) => ({ numero })),
    });
  }

  return { syntheticSupports, issues };
}
