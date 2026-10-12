import type { AdmiraScreen } from '@/domain/models';

/**
 * Opciones de Tienda+Soporte del visor de auditoría de Inteligencia Comercial.
 *
 * Lógica pura sobre el Catálogo Admira: solo ofrece tiendas que tienen el
 * soporte elegido con al menos una cámara Quividi configurada, así que no se
 * puede auditar una combinación sin datos. El número se normaliza igual que
 * el backend (`normalizedStoreCode` en `functions/src/quividi/measurementPoint.ts`:
 * 3 dígitos con ceros a la izquierda), porque los bindings del histórico se
 * guardan como `LIV-005`, no `LIV-5`.
 */

/** Únicos soportes con medición Quividi que se auditan en Fase 3 (rótulo visible). */
export const COMMERCIAL_SUPPORTS = ['MUPI DIGITAL', 'BANNER DIGITAL'] as const;
export type CommercialSupport = (typeof COMMERCIAL_SUPPORTS)[number];

/**
 * Nombres con que cada soporte aparece en `calendarSupport` del catálogo. El
 * mupi se mapea como `MEGA MUPI DIGITAL` (alias `MUPPI'S` → `MEGA MUPI
 * DIGITAL`, AGENTS.md), pero el maestro puede traer el nombre literal
 * (`MUPPI'S`, `PENDON`) o variantes (`MEGAMUPI DIGITAL`, alias de Quividi);
 * se aceptan todas. Al backend se envía siempre el nombre literal del catálogo,
 * porque los bindings del histórico lo comparan exacto.
 */
const CATALOG_SUPPORT_NAMES: Readonly<
  Record<CommercialSupport, readonly string[]>
> = {
  'MUPI DIGITAL': [
    'MEGA MUPI DIGITAL',
    'MEGAMUPI DIGITAL',
    'MEGA MUPI',
    'MUPI DIGITAL',
    'MUPPIS',
    'MUPIS',
  ],
  'BANNER DIGITAL': ['BANNER DIGITAL', 'PENDON'],
};

export interface CommercialStoreOption {
  /** Número normalizado a 3 dígitos, tal como lo espera el backend. */
  storeNumber: string;
  storeName: string;
  /** Soporte tal como está en el catálogo (lo que se envía al backend). */
  support: string;
  /** Texto visible en las sugerencias: `NOMBRE (005)`. */
  label: string;
}

const MAX_SUGGESTIONS = 8;

export function normalizeStoreNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return String(Number.parseInt(trimmed, 10)).padStart(3, '0');
}

function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['\u2019\u00b4`\u02bc]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasQuividiCamera(screen: AdmiraScreen): boolean {
  return (
    screen.metadata.quividiLocationId != null ||
    screen.metadata.quividiLocationId2 != null
  );
}

/**
 * Tiendas con cámara Quividi para `support`, una por número, ordenadas por
 * nombre. Incluye pantallas inactivas: su histórico sigue siendo auditable
 * (mismo criterio que el catálogo del histórico en el backend).
 */
export function buildStoreOptions(
  screens: readonly AdmiraScreen[],
  support: CommercialSupport,
): CommercialStoreOption[] {
  const catalogNames = CATALOG_SUPPORT_NAMES[support];
  const byNumber = new Map<string, CommercialStoreOption>();
  for (const screen of screens) {
    const catalogSupport = (screen.metadata.calendarSupport ?? '').trim();
    if (!catalogNames.includes(searchKey(catalogSupport))) continue;
    if (!hasQuividiCamera(screen)) continue;
    const storeNumber = normalizeStoreNumber(
      screen.original['Numero de Tienda'] ?? '',
    );
    if (!storeNumber || storeNumber === '000') continue;
    if (byNumber.has(storeNumber)) continue;
    const storeName =
      screen.original['Nombre de tienda']?.trim() || `Tienda ${storeNumber}`;
    byNumber.set(storeNumber, {
      storeNumber,
      storeName,
      support: catalogSupport,
      label: `${storeName} (${storeNumber})`,
    });
  }
  return [...byNumber.values()].sort((a, b) =>
    a.storeName.localeCompare(b.storeName, 'es'),
  );
}

/**
 * Sugerencias para lo tecleado: coincide por nombre (sin acentos ni
 * mayúsculas, por palabras en cualquier orden) o por número.
 */
export function filterStoreOptions(
  options: readonly CommercialStoreOption[],
  query: string,
): CommercialStoreOption[] {
  const key = searchKey(query);
  if (!key) return options.slice(0, MAX_SUGGESTIONS);
  const number = normalizeStoreNumber(key);
  const words = key.split(' ');
  return options
    .filter(
      (option) =>
        (number !== null && option.storeNumber === number) ||
        option.storeNumber.includes(key) ||
        words.every((word) => searchKey(option.label).includes(word)),
    )
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Tienda que corresponde a lo tecleado sin haber elegido una sugerencia: el
 * número exacto, la etiqueta exacta o la única coincidencia. Si es ambiguo
 * devuelve null para que el usuario elija.
 */
export function resolveStoreOption(
  options: readonly CommercialStoreOption[],
  query: string,
): CommercialStoreOption | null {
  const key = searchKey(query);
  if (!key) return null;
  const number = normalizeStoreNumber(key);
  const exact = options.find(
    (option) =>
      (number !== null && option.storeNumber === number) ||
      searchKey(option.label) === key ||
      searchKey(option.storeName) === key,
  );
  if (exact) return exact;
  const matches = filterStoreOptions(options, query);
  return matches.length === 1 ? matches[0]! : null;
}
