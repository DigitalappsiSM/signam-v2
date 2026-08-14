/**
 * Punto de entrada del dominio Ekon. Reglas de negocio puras (sin React ni
 * Firebase) de la integración Ekon–Liverpool: parser, normalización, periodos,
 * identidad, diff/estados, tipos de campaña, mapeo de circuitos, conciliación y
 * fallback de CSV.
 */
export * from './headers';
export * from './normalization';
export * from './models';
export * from './identity';
export * from './periods';
export * from './campaignType';
export * from './supportMapping';
export * from './parse';
export * from './contentHash';
export * from './diff';
export * from './reconciliation';
export * from './fallbackCsv';
