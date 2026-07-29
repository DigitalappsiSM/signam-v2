import { INSTORE_MEDIA_SUPPORTS } from './constants';

/**
 * Normaliza un texto de soporte para comparaciones robustas:
 * - recorta espacios,
 * - colapsa espacios internos,
 * - elimina acentos,
 * - elimina apóstrofes (rectos y tipográficos),
 * - convierte a mayúsculas.
 *
 * Así `Muppi's`, `MUPPI’S` y `MUPPIS` se consideran el mismo soporte.
 */
export function normalizeSupport(value: string): string {
  return (
    value
      .trim()
      .replace(/\s+/g, ' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Ap\u00f3strofes y acentos usados como ap\u00f3strofe: ' \u2019 \u00b4 ` \u02bc
      .replace(/['\u2019\u00b4`\u02bc]/g, '')
      .toUpperCase()
  );
}

const INSTORE_MEDIA_NORMALIZED = new Set(
  INSTORE_MEDIA_SUPPORTS.map(normalizeSupport),
);

/**
 * Indica si un soporte pertenece a InStore Media (`MUPPI'S`, `PENDON`).
 * Estos soportes se detectan pero se excluyen de la consolidación en esta etapa.
 */
export function isInStoreMediaSupport(support: string): boolean {
  return INSTORE_MEDIA_NORMALIZED.has(normalizeSupport(support));
}

/**
 * Indica si un soporte pertenece a Liverpool (todos los soportes del calendario
 * excepto los de InStore Media). Es el complemento de `isInStoreMediaSupport`.
 */
export function isLiverpoolSupport(support: string): boolean {
  return !isInStoreMediaSupport(support);
}

export type SupportOwner = 'liverpool' | 'instore-media';

/** Clasifica un soporte según su propietario para el diagnóstico de importación. */
export function classifySupport(support: string): SupportOwner {
  return isInStoreMediaSupport(support) ? 'instore-media' : 'liverpool';
}
