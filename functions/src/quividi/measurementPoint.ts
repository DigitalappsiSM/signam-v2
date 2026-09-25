import { normalizeStore, normalizeSupport } from './effectiveScope';

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

export function measurementPointCodeError(value: string): string | null {
  const code = value.trim();
  if (!code) return null;
  if (!MEASUREMENT_POINT_CODE_PATTERN.test(code)) {
    return 'Punto SIGNAM inválido. Usa 1–8 caracteres en mayúsculas, solo letras y números.';
  }
  return null;
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

  const normalizedStore = normalizeStore(storeNumber);
  if (!/^\d+$/.test(normalizedStore)) {
    throw new Error('Número de tienda inválido para Punto SIGNAM.');
  }
  const store = normalizedStore.padStart(3, '0');
  const supportCode = SUPPORT_CODE_BY_NAME[normalizeSupport(support)];
  if (!supportCode) {
    throw new Error(`Soporte sin nomenclatura de Punto SIGNAM: ${support}`);
  }
  return `LIV-${store}-${supportCode}-${code}`;
}
