import type {
  QuividiCommercialConsistency,
  QuividiCommercialDailyRow,
} from '@/services/quividi';

/**
 * Helpers de presentación del visor de auditoría de Inteligencia Comercial
 * (Fase 3). La consistencia cruda-vs-rollup la calcula el backend
 * (`quividi-commercialAudit`, reusando `cameraCombination.ts`); este módulo
 * solo traduce los campos ya calculados a texto, sin reimplementar ninguna
 * regla de negocio.
 */

export function statusLabel(
  status: QuividiCommercialDailyRow['status'],
): string {
  switch (status) {
    case 'measured':
      return 'Medido';
    case 'partial':
      return 'Parcial';
    default:
      return 'Sin medición';
  }
}

export function zoneSplitLabel(zoneSplit: boolean): string {
  return zoneSplit ? 'Zona partida (suma)' : 'Combinación estándar';
}

export function consistencyLabel(flag: QuividiCommercialConsistency): string {
  switch (flag) {
    case 'ok':
      return 'Consistente';
    case 'mismatch':
      return 'Revisar: no cuadra con el crudo';
    default:
      return 'Sin datos';
  }
}

/**
 * Rótulo de un punto en la columna de crudo: su `pointId` de catálogo o, si
 * el binding no lo tiene, un rótulo neutro por posición. Nunca el Location ID
 * de Quividi: el cliente identifica por Tienda+Soporte (AGENTS.md, Fase 3).
 */
export function pointLabel(pointId: string | null, index: number): string {
  return pointId ?? `Punto ${index + 1}`;
}
