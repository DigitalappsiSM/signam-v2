import { normalizeSupport } from '../support';

/**
 * Normalización de circuito Ekon ↔ soporte Liverpool.
 *
 * En Ekon el campo `Artículo` representa el circuito comercial a conciliar. El
 * mapeo autorizado relaciona cada circuito con los `NORMALIZACION LIVERPOOL`
 * permitidos. La conciliación acepta CUALQUIERA de los soportes permitidos para
 * el circuito; no exige igualdad literal entre textos de sistemas distintos.
 *
 * Alias confirmado: el valor Ekon `MEGA MUPI DIGITAL` se normaliza al circuito
 * canónico `MEGA MUPI` antes de aplicar el mapeo.
 *
 * Del lado Liverpool, los soportes InStore del calendario se leen como su
 * equivalente digital (mismo alias que la consolidación y Quividi):
 * `MUPPI'S` → `MEGA MUPI DIGITAL` y `PENDON` → `BANNER DIGITAL`.
 */

/** Circuitos canónicos Ekon. */
export const EKON_CIRCUITS = [
  'ESPECTACULAR IN STORE',
  'ESPECTACULAR OUT LIV',
  'MEGA MUPI',
  'VIDEOWALL',
] as const;

export type EkonCircuit = (typeof EKON_CIRCUITS)[number];

/**
 * Mapeo circuito canónico → soportes `NORMALIZACION LIVERPOOL` permitidos.
 * Configurable y probado. No debe ampliarse sin decisión documentada.
 */
export const CIRCUIT_TO_SUPPORTS: Record<EkonCircuit, readonly string[]> = {
  'ESPECTACULAR IN STORE': [
    'LED ALTABRISA',
    'LED VALLARTA',
    'COLUMNA DIGITAL',
    'BANNER DIGITAL',
  ],
  'ESPECTACULAR OUT LIV': [
    'APARADOR INSURGENTES',
    'APARADOR POLANCO',
    'C&C MTY',
    'PANTALLAS LED ANTEA',
    'VIDEO WALL CRIUS',
  ],
  'MEGA MUPI': ['MEGA MUPI DIGITAL'],
  VIDEOWALL: [
    'PANTALLAS CUADRADAS',
    'VIDEO WALL CRIUS',
    'VIDEO WALL POSTER LED',
  ],
};

/** Aliases de artículo Ekon → circuito canónico. */
const ARTICLE_ALIASES: Record<string, EkonCircuit> = {
  'MEGA MUPI DIGITAL': 'MEGA MUPI',
};

/**
 * Resuelve el `Artículo` Ekon a su circuito canónico. Aplica el alias
 * `MEGA MUPI DIGITAL → MEGA MUPI`. Devuelve `null` si el artículo no es un
 * circuito reconocido.
 */
export function canonicalCircuit(articulo: string): EkonCircuit | null {
  const n = normalizeSupport(articulo);
  const alias = ARTICLE_ALIASES[n];
  if (alias) return alias;
  const direct = EKON_CIRCUITS.find((c) => normalizeSupport(c) === n);
  return direct ?? null;
}

const NORMALIZED_SUPPORTS_BY_CIRCUIT = new Map<EkonCircuit, Set<string>>(
  EKON_CIRCUITS.map((c) => [
    c,
    new Set(CIRCUIT_TO_SUPPORTS[c].map((s) => normalizeSupport(s))),
  ]),
);

/** Aliases de soporte Liverpool (InStore) → soporte digital equivalente. */
const LIVERPOOL_SUPPORT_ALIASES: Record<string, string> = {
  MUPPIS: 'MEGA MUPI DIGITAL',
  PENDON: 'BANNER DIGITAL',
};

/**
 * true si el `soporte` Liverpool es compatible con el `circuito` Ekon (o con el
 * artículo, resolviendo su alias). La comparación es normalizada y el soporte
 * InStore (`MUPPI'S`, `PENDON`) se evalúa por su equivalente digital.
 */
export function isCompatibleSupport(
  articuloOrCircuit: string,
  liverpoolSupport: string,
): boolean {
  const circuit = canonicalCircuit(articuloOrCircuit);
  if (!circuit) return false;
  const set = NORMALIZED_SUPPORTS_BY_CIRCUIT.get(circuit);
  if (!set) return false;
  const n = normalizeSupport(liverpoolSupport);
  return set.has(LIVERPOOL_SUPPORT_ALIASES[n] ?? n);
}

/** Soportes Liverpool permitidos para un artículo/circuito Ekon (o vacío). */
export function allowedSupportsFor(
  articuloOrCircuit: string,
): readonly string[] {
  const circuit = canonicalCircuit(articuloOrCircuit);
  return circuit ? CIRCUIT_TO_SUPPORTS[circuit] : [];
}
