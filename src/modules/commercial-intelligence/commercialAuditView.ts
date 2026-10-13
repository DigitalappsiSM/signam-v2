import type {
  QuividiCommercialConsistency,
  QuividiCommercialDailyRow,
  QuividiCommercialRawPointDay,
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
    case 'pending-rollup':
      return 'Rollup pendiente';
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

/**
 * Lectura cruda de un punto en un día. Si solo llegó una de las dos series de
 * Fase 2 (OTS o watchers), la que falta se rotula «sin medir» en vez de 0: un
 * 0 se leería como «no hubo audiencia», que no es lo que pasó.
 */
export function rawPointSummary(
  point: Pick<
    QuividiCommercialRawPointDay,
    'measured' | 'otsMeasured' | 'viewersMeasured' | 'ots' | 'watchers'
  >,
  formatNumber: (value: number) => string,
): string {
  if (!point.measured) return 'sin medición';
  const ots = point.otsMeasured
    ? `${formatNumber(point.ots)} OTS`
    : 'OTS sin medir';
  const watchers = point.viewersMeasured
    ? `${formatNumber(point.watchers)} watchers`
    : 'watchers sin medir';
  return `${ots} · ${watchers}`;
}

/** Hay días con crudo y sin rollup: tiene sentido ofrecer reconstruirlo. */
export function hasPendingRollup(
  days: readonly { consistency: QuividiCommercialConsistency }[],
): boolean {
  return days.some((day) => day.consistency === 'pending-rollup');
}

/**
 * Cifra comercial publicada de un día. Una serie que el rollup no midió
 * (`otsMeasured`/`viewersMeasured === false`) se rotula «sin medir», no 0.
 */
export function commercialSummary(
  row: Pick<
    QuividiCommercialDailyRow,
    'publishedOts' | 'publishedWatchers' | 'otsMeasured' | 'viewersMeasured'
  >,
  formatNumber: (value: number) => string,
): string {
  const ots =
    row.otsMeasured === false
      ? 'OTS sin medir'
      : `${formatNumber(row.publishedOts)} OTS publicados`;
  const watchers =
    row.viewersMeasured === false
      ? 'watchers sin medir'
      : `${formatNumber(row.publishedWatchers)} watchers`;
  return `${ots} · ${watchers}`;
}
