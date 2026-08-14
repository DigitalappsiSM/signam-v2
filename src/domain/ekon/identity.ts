import { normalizeId, normalizeStoreNumber } from './normalization';
import { normalizeSupport } from '../support';

/**
 * Identidad estable de una asignación Ekon.
 *
 * Llave: `Año + Campaña + Línea campaña + Determinante + Artículo`.
 *
 * Perfilado sobre el archivo real (21 327 filas): produce 21 317 llaves
 * distintas. Las 10 colisiones son la MISMA asignación física dentro del mismo
 * periodo, diferenciadas solo por `Importe neto` (líneas comerciales del mismo
 * pase). Ninguna llave abarca dos periodos distintos. Por tanto la llave
 * identifica correctamente una asignación a lo largo del tiempo y un cambio de
 * periodo es una MODIFICACIÓN de la misma asignación, no un alta+baja.
 *
 * No se incluyen `ID Periodo`, `Inicio/Fin periodo`, importe, factura ni otros
 * valores mutables: esos pertenecen al fingerprint/versionado. Tampoco se usa
 * el número de fila de Excel como identidad de negocio.
 */

/** Campos que forman la identidad estable. */
export interface EkonIdentityFields {
  año: string;
  campaña: string;
  lineaCampaña: string;
  determinante: string;
  articulo: string;
}

/** Separador que no puede aparecer dentro de los valores normalizados. */
const SEP = '¦';

/**
 * Construye la llave estable de identidad de una asignación. Los identificadores
 * se normalizan (recorte, colapso de espacios); el determinante colapsa ceros a
 * la izquierda y el artículo se compara sin acentos/mayúsculas.
 */
export function assignmentKey(fields: EkonIdentityFields): string {
  return [
    normalizeId(fields.año),
    normalizeId(fields.campaña),
    normalizeId(fields.lineaCampaña),
    normalizeStoreNumber(fields.determinante),
    normalizeSupport(fields.articulo),
  ].join(SEP);
}

const B64URL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Deriva un ID de documento de Firestore estable y seguro a partir de un texto
 * arbitrario (base64url del UTF-8). Solo produce caracteres válidos para un ID
 * (nunca `/`, `.`, `..`), de modo que la misma llave estable siempre mapea al
 * mismo documento (upsert idempotente).
 */
export function safeDocId(value: string): string {
  const key = value.trim();
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
