import type { EkonCampaignType, EkonRatio } from './models';

/**
 * Clasificación por tipo de campaña Ekon.
 *
 * IMPORTANTE: esta "Ratio 1 / Ratio 3" es la clasificación por TIPO DE CAMPAÑA
 * Ekon y es INDEPENDIENTE del cálculo dinámico de baja ocupación que ya existe
 * en SIGNAM (mismo nombre, lógica distinta). Este módulo no toca ese algoritmo.
 *
 * | Tipo Ekon                | Clasificación | Testigos |
 * | ------------------------ | ------------- | -------- |
 * | Campaña Institucionales  | Ratio 3       | No       |
 * | Campaña Liverpesos       | Ratio 3       | No       |
 * | Campaña Liverpool        | Ratio 1       | Sí       |
 * | General                  | Ratio 1       | Sí       |
 */

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Normaliza el texto de `Tipo Campaña` al enum interno. Devuelve `null` cuando
 * el texto no corresponde a ninguno de los cuatro tipos conocidos (se conserva
 * el original y la fila puede aislarse o marcarse como desconocida).
 */
export function parseCampaignType(raw: string): EkonCampaignType | null {
  const n = normalize(raw);
  if (n === 'CAMPANA INSTITUCIONALES' || n === 'INSTITUCIONALES') {
    return 'institucionales';
  }
  if (n === 'CAMPANA LIVERPESOS' || n === 'LIVERPESOS') return 'liverpesos';
  if (n === 'CAMPANA LIVERPOOL' || n === 'LIVERPOOL') return 'liverpool';
  if (n === 'GENERAL') return 'general';
  return null;
}

/** Clasificación Ekon (Ratio 1 / Ratio 3) de un tipo de campaña. */
export function ratioForType(type: EkonCampaignType): EkonRatio {
  return type === 'liverpool' || type === 'general' ? 'ratio1' : 'ratio3';
}

/** Un tipo Ratio 1 (Liverpool o General) requiere testigos. */
export function requiresTestigos(type: EkonCampaignType): boolean {
  return ratioForType(type) === 'ratio1';
}

/**
 * Clasificación derivada de un conjunto de líneas vigentes (campaña mixta):
 * si al menos una línea es Ratio 1 (General o Campaña Liverpool), la campaña
 * completa es Ratio 1 y requiere testigos; si todas son Ratio 3
 * (Institucionales/Liverpesos), es Ratio 3 sin testigos.
 */
export function classifyCampaign(types: readonly EkonCampaignType[]): {
  ratio: EkonRatio;
  requiresTestigos: boolean;
} {
  const anyRatio1 = types.some((t) => ratioForType(t) === 'ratio1');
  const ratio: EkonRatio = anyRatio1 ? 'ratio1' : 'ratio3';
  return { ratio, requiresTestigos: ratio === 'ratio1' };
}

/** Etiqueta legible del tipo (para la UI). */
export function campaignTypeLabel(type: EkonCampaignType): string {
  switch (type) {
    case 'institucionales':
      return 'Campaña Institucionales';
    case 'liverpesos':
      return 'Campaña Liverpesos';
    case 'liverpool':
      return 'Campaña Liverpool';
    case 'general':
      return 'General';
  }
}
