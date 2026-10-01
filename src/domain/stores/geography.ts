/**
 * Geografía de México para el directorio de tiendas: estados canónicos, zonas
 * comerciales Liverpool, código postal → estado y límites del territorio.
 *
 * Los nombres canónicos de estado coinciden con los del GeoJSON de estados que
 * usa el mapa del panel, así un estado del directorio se pinta sin traducción.
 */

export const MEXICAN_STATES = [
  'Aguascalientes',
  'Baja California',
  'Baja California Sur',
  'Campeche',
  'Chiapas',
  'Chihuahua',
  'Ciudad de México',
  'Coahuila',
  'Colima',
  'Durango',
  'Guanajuato',
  'Guerrero',
  'Hidalgo',
  'Jalisco',
  'México',
  'Michoacán',
  'Morelos',
  'Nayarit',
  'Nuevo León',
  'Oaxaca',
  'Puebla',
  'Querétaro',
  'Quintana Roo',
  'San Luis Potosí',
  'Sinaloa',
  'Sonora',
  'Tabasco',
  'Tamaulipas',
  'Tlaxcala',
  'Veracruz',
  'Yucatán',
  'Zacatecas',
] as const;

export type MexicanState = (typeof MEXICAN_STATES)[number];

/** Zonas comerciales de Liverpool tal como vienen en su directorio. */
export const STORE_ZONES = [
  'Metropolitana',
  'Centro',
  'Noreste',
  'Noroeste',
  'Norte',
  'Sureste',
  'Suroeste',
] as const;

export type StoreZone = (typeof STORE_ZONES)[number];

/** Minúsculas, sin acentos ni puntuación, espacios colapsados. */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STATE_ALIASES: Record<string, MexicanState> = {
  cdmx: 'Ciudad de México',
  df: 'Ciudad de México',
  'distrito federal': 'Ciudad de México',
  'estado de mexico': 'México',
  edomex: 'México',
  'edo mex': 'México',
  'edo de mexico': 'México',
  'baja california norte': 'Baja California',
  bc: 'Baja California',
  bcs: 'Baja California Sur',
  'coahuila de zaragoza': 'Coahuila',
  'michoacan de ocampo': 'Michoacán',
  'veracruz de ignacio de la llave': 'Veracruz',
  nl: 'Nuevo León',
  qroo: 'Quintana Roo',
  slp: 'San Luis Potosí',
};

const STATE_BY_FOLD = new Map<string, MexicanState>(
  MEXICAN_STATES.map((s) => [foldText(s), s]),
);

/**
 * Nombre canónico de un estado escrito de cualquier forma razonable
 * (`CDMX`, `Estado de México`, `Baja California Norte`…). `null` si no se
 * reconoce: el directorio lo reporta, nunca lo adivina.
 */
export function canonicalState(value: string): MexicanState | null {
  const folded = foldText(value);
  if (folded === '') return null;
  return STATE_ALIASES[folded] ?? STATE_BY_FOLD.get(folded) ?? null;
}

/** Zona canónica (`metropolitana` → `Metropolitana`) o `null` si no existe. */
export function canonicalZone(value: string): StoreZone | null {
  const folded = foldText(value);
  return STORE_ZONES.find((z) => foldText(z) === folded) ?? null;
}

/**
 * Rangos de los dos primeros dígitos del código postal por estado (SEPOMEX).
 * Sirve para detectar CP capturados con el estado equivocado; el detalle de
 * colonia y municipio sigue saliendo del directorio.
 */
const POSTAL_PREFIX_RANGES: ReadonlyArray<
  readonly [number, number, MexicanState]
> = [
  [1, 16, 'Ciudad de México'],
  [20, 20, 'Aguascalientes'],
  [21, 22, 'Baja California'],
  [23, 23, 'Baja California Sur'],
  [24, 24, 'Campeche'],
  [25, 27, 'Coahuila'],
  [28, 28, 'Colima'],
  [29, 30, 'Chiapas'],
  [31, 33, 'Chihuahua'],
  [34, 35, 'Durango'],
  [36, 38, 'Guanajuato'],
  [39, 41, 'Guerrero'],
  [42, 43, 'Hidalgo'],
  [44, 49, 'Jalisco'],
  [50, 57, 'México'],
  [58, 61, 'Michoacán'],
  [62, 62, 'Morelos'],
  [63, 63, 'Nayarit'],
  [64, 67, 'Nuevo León'],
  [68, 71, 'Oaxaca'],
  [72, 75, 'Puebla'],
  [76, 76, 'Querétaro'],
  [77, 77, 'Quintana Roo'],
  [78, 79, 'San Luis Potosí'],
  [80, 82, 'Sinaloa'],
  [83, 85, 'Sonora'],
  [86, 86, 'Tabasco'],
  [87, 89, 'Tamaulipas'],
  [90, 90, 'Tlaxcala'],
  [91, 96, 'Veracruz'],
  [97, 97, 'Yucatán'],
  [98, 99, 'Zacatecas'],
];

/**
 * Normaliza un código postal mexicano a 5 dígitos. Excel suele perder el cero
 * inicial de la CDMX (`3020` → `03020`). Devuelve `null` si no es un CP.
 */
export function normalizePostalCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().replace(/\.0+$/, '');
  if (!/^\d{4,5}$/.test(raw)) return null;
  const cp = raw.padStart(5, '0');
  return stateForPostalCode(cp) ? cp : null;
}

/** Estado al que pertenece un CP de 5 dígitos, o `null` si el prefijo no existe. */
export function stateForPostalCode(postalCode: string): MexicanState | null {
  if (!/^\d{5}$/.test(postalCode)) return null;
  const prefix = Number(postalCode.slice(0, 2));
  const hit = POSTAL_PREFIX_RANGES.find(
    ([from, to]) => prefix >= from && prefix <= to,
  );
  return hit ? hit[2] : null;
}

/** Caja envolvente del territorio mexicano (con margen para islas). */
export const MEXICO_BOUNDS = {
  minLat: 14.3,
  maxLat: 32.8,
  minLng: -118.6,
  maxLng: -86.5,
} as const;

/** Indica si una coordenada cae dentro de México (descarta lat/lng invertidas). */
export function isInsideMexico(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= MEXICO_BOUNDS.minLat &&
    lat <= MEXICO_BOUNDS.maxLat &&
    lng >= MEXICO_BOUNDS.minLng &&
    lng <= MEXICO_BOUNDS.maxLng
  );
}
