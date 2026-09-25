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

export function validMeasurementPointCode(value: string): boolean {
  return MEASUREMENT_POINT_CODE_PATTERN.test(value.trim());
}

export function buildBackendMeasurementPointId(input: {
  storeNumber: string;
  support: string;
  pointCode: string;
}): string | null {
  const pointCode = input.pointCode.trim();
  if (!validMeasurementPointCode(pointCode)) return null;
  const store = normalizedStoreCode(input.storeNumber);
  const support = measurementSupportCode(input.support);
  if (!store || !support) return null;
  return `LIV-${store}-${support}-${pointCode}`;
}
