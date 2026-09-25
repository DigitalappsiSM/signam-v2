export const MEASUREMENT_POINT_CODE_PATTERN = /^[A-Z0-9]{1,8}$/;

const SUPPORT_CODE_ALIASES: Readonly<Record<string, string>> = {
  'MEGA MUPI DIGITAL': 'MUPI',
  'BANNER DIGITAL': 'BANNER',
  'VIDEO WALL CRIUS': 'CRIUS',
  'VIDEO WALL POSTER LED': 'POSTERLED',
  'PANTALLAS CUADRADAS': 'CUADRADA',
  'APARADOR INSURGENTES': 'APARADOR',
  'APARADOR POLANCO': 'APARADOR',
  'C&C MTY': 'CCMTY',
  'PANTALLAS LED ANTEA': 'LEDANTEA',
  'LED ALTABRISA': 'LEDALTABRISA',
  'LED VALLARTA': 'LEDVALLARTA',
  'COLUMNA DIGITAL': 'COLUMNA',
};

function normalizedSupport(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’´`ʼ]/g, '')
    .replace(/\s+/g, ' ');
}

export function measurementSupportCode(support: string): string | null {
  const normalized = normalizedSupport(support);
  return SUPPORT_CODE_ALIASES[normalized] ?? null;
}

export function normalizedStoreCode(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return String(numeric).padStart(3, '0');
}

export function validateMeasurementPointCode(value: string): string | null {
  const code = value.trim();
  if (!code) return null;
  if (!MEASUREMENT_POINT_CODE_PATTERN.test(code)) {
    throw new Error(
      'El Punto SIGNAM debe tener entre 1 y 8 caracteres, solo letras MAYÚSCULAS y números (ej. 1, 2, P1, P2).',
    );
  }
  return code;
}

export function buildMeasurementPointId(input: {
  retailerCode?: string;
  storeNumber: string;
  support: string;
  pointCode: string;
}): string | null {
  const pointCode = validateMeasurementPointCode(input.pointCode);
  if (!pointCode) return null;
  const store = normalizedStoreCode(input.storeNumber);
  if (!store) {
    throw new Error('El número de tienda debe ser numérico para construir el Punto SIGNAM.');
  }
  const support = measurementSupportCode(input.support);
  if (!support) {
    throw new Error(
      'El soporte no tiene una nomenclatura SIGNAM configurada. Corrige la normalización antes de guardar.',
    );
  }
  const retailer = (input.retailerCode ?? 'LIV').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,8}$/.test(retailer)) {
    throw new Error('El código de retailer no es válido para el Punto SIGNAM.');
  }
  return `${retailer}-${store}-${support}-${pointCode}`;
}
