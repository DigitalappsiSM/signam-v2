import type { Classification } from './types';

/**
 * Clasificación operativa automática a partir del campo `tipo` de la campaña.
 *
 * - Contiene `INSTITUCIONAL` (ignorando mayúsculas, acentos y espacios) →
 *   `institutional`.
 * - Contiene `PROVEEDOR` → `provider`.
 * - En cualquier otro caso (vacío o desconocido) → `unknown`: exige que el
 *   usuario elija durante la importación. Nunca se asume Proveedor por defecto.
 */

export type AutoClassification = Classification | 'unknown';

function normalize(v: string): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/** Deduce la clasificación desde `tipo`; `unknown` si no es inequívoca. */
export function classifyFromTipo(tipo: string): AutoClassification {
  const t = normalize(tipo);
  const inst = t.includes('INSTITUCIONAL');
  const prov = t.includes('PROVEEDOR');
  if (inst && !prov) return 'institutional';
  if (prov && !inst) return 'provider';
  return 'unknown';
}
