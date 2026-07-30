/**
 * Lógica pura de la asociación uno-a-uno entre una campaña Liverpool y su
 * número de campaña Ekon.
 *
 * Aquí no hay Firestore ni React: solo validación de dominio y derivación de la
 * llave del documento. El servicio (`src/services/campaignEkonLinks.ts`) y la
 * UI (`CampaignsPage`) consumen estas funciones.
 *
 * Reglas del número Ekon:
 * - opcional y vacío por defecto;
 * - solo enteros positivos "seguros" (`Number.isSafeInteger(n) && n > 0`);
 * - se rechazan cero, negativos, decimales, texto y enteros no seguros.
 */

/** Mensajes de validación (reutilizados por la UI para mostrar el error). */
export const EKON_ERRORS = {
  empty: 'Escribe un número de campaña Ekon.',
  notInteger: 'El número Ekon debe ser un entero positivo (sin decimales).',
  notPositive: 'El número Ekon debe ser mayor que cero.',
  unsafe: 'El número Ekon es demasiado grande.',
} as const;

export type EkonParseResult =
  { ok: true; value: number } | { ok: false; error: string };

/**
 * Interpreta la entrada del usuario como número de campaña Ekon.
 * Acepta únicamente una cadena de dígitos que represente un entero positivo
 * seguro. Cualquier otra cosa (vacío, signo, decimal, texto, no seguro) se
 * rechaza con un mensaje.
 */
export function parseEkonNumber(raw: string): EkonParseResult {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, error: EKON_ERRORS.empty };
  // Solo dígitos: descarta signos, decimales, notación científica y texto.
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: EKON_ERRORS.notInteger };
  }
  const value = Number(trimmed);
  if (value === 0) return { ok: false, error: EKON_ERRORS.notPositive };
  if (!Number.isSafeInteger(value)) {
    return { ok: false, error: EKON_ERRORS.unsafe };
  }
  if (value <= 0) return { ok: false, error: EKON_ERRORS.notPositive };
  return { ok: true, value };
}

const B64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Deriva de forma determinística y segura el ID del documento de asociación a
 * partir del `nameKey` normalizado de la campaña (ver `campaignKey`). Se usa
 * base64url del UTF-8 del `nameKey`: es estable, no colisiona y solo contiene
 * caracteres válidos para un ID de Firestore (nunca `/`, ni `.`/`..`).
 *
 * No se usa el ID aleatorio de la colección `campaigns`, para que la asociación
 * sobreviva a reimportaciones, borrados temporales y recreaciones de la campaña.
 */
export function campaignKeyId(nameKey: string): string {
  const key = nameKey.trim();
  if (key === '') return '_';
  const bytes = new TextEncoder().encode(key);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += B64URL[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) out += B64URL[b2 & 0x3f];
  }
  return out;
}
