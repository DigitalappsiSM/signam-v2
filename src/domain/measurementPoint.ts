/**
 * Identidad estable de puntos de medición de cámara en SIGNAM.
 *
 * Quividi puede cambiar Location ID, Box ID o alias. El Punto SIGNAM identifica
 * la posición lógica que se mide y permanece estable para histórico y Odoo.
 */

export const MEASUREMENT_POINT_CODE_PATTERN = /^[A-Z0-9]{1,8}$/;

const SUPPORT_CODE_BY_NAME: Readonly<Record<string, string>> = {
  'MEGA MUPI DIGITAL': 'MUPI',
  'MEGAMUPI DIGITAL': 'MUPI',
  'BANNER DIGITAL': 'BANNER',
  'VIDEO WALL CRIUS': 'CRIUS',
  'VIDEO WALL POSTER LED': 'POSTERLED',
  'PANTALLAS CUADRADAS': 'CUADRADA',
  'PANTALLAS LED ANTEA': 'LEDANTEA',
  'APARADOR INSURGENTES': 'APARADORINS',
  'APARADOR POLANCO': 'APARADORPOL',
  'C&C MTY': 'CCMTY',
  'LED ALTABRISA': 'LEDALTABRISA',
  'LED VALLARTA': 'LEDVALLARTA',
  'COLUMNA DIGITAL': 'COLUMNA',
};

function normalizeSupport(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’´`ʼ]/g, '')
    .replace(/\s+/g, ' ');
}

export function measurementPointCodeError(value: string): string | null {
  const code = value.trim();
  if (!code) return null;
  if (!MEASUREMENT_POINT_CODE_PATTERN.test(code)) {
    return 'Punto SIGNAM inválido. Usa 1–8 caracteres en mayúsculas, solo letras y números (ej. 1, 2, P1, P2).';
  }
  return null;
}

export function measurementSupportCode(support: string): string | null {
  return SUPPORT_CODE_BY_NAME[normalizeSupport(support)] ?? null;
}

export function normalizedLiverpoolStoreNumber(storeNumber: string): string | null {
  const value = storeNumber.trim();
  if (!/^\d+$/.test(value)) return null;
  return String(Number.parseInt(value, 10)).padStart(3, '0');
}

export function buildMeasurementPointId(
  storeNumber: string,
  support: string,
  pointCode: string,
): string | null {
  const code = pointCode.trim();
  if (!code) return null;

  const codeError = measurementPointCodeError(code);
  if (codeError) throw new Error(codeError);

  const store = normalizedLiverpoolStoreNumber(storeNumber);
  if (!store) {
    throw new Error(
      'No se puede crear el Punto SIGNAM porque el número de tienda no es numérico.',
    );
  }

  const supportCode = measurementSupportCode(support);
  if (!supportCode) {
    throw new Error(
      `El soporte "${support.trim() || 'sin definir'}" no tiene una nomenclatura de Punto SIGNAM configurada.`,
    );
  }

  return `LIV-${store}-${supportCode}-${code}`;
}
