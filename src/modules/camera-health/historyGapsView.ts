import type { QuividiHistoryGapResult } from '@/services/quividi';

/**
 * Helpers de presentación de «Huecos del histórico». La detección la hace el
 * backend (`functions/src/quividi/historyGaps.ts`); aquí solo se traduce.
 */

/** Mes anterior al de `today` (`YYYY-MM`): el último mes completo. */
export function previousMonth(today: Date): string {
  const year = today.getFullYear();
  const month = today.getMonth(); // 0-based: el mes anterior en 1-based
  return month === 0
    ? `${year - 1}-12`
    : `${year}-${String(month).padStart(2, '0')}`;
}

export function totalGaps(result: QuividiHistoryGapResult): number {
  return result.missing + result.incomplete + result.empty;
}

export function gapResultSummary(result: QuividiHistoryGapResult): string {
  const total = totalGaps(result);
  if (total === 0) {
    return `Sin huecos: ${result.locations} locations × ${result.dates.length} días completos.`;
  }
  const parts = [
    `${total.toLocaleString('es-MX')} particiones con hueco`,
    `${result.missing.toLocaleString('es-MX')} faltantes`,
    `${result.incomplete.toLocaleString('es-MX')} incompletas`,
    `${result.empty.toLocaleString('es-MX')} vacías en medición`,
  ];
  const base = `${parts[0]} (${parts.slice(1).join(', ')}).`;
  if (!result.reload) return base;
  const pending =
    result.pending > 0
      ? ` Quedan ${result.pending.toLocaleString('es-MX')} por encolar: vuelve a pulsar «Recargar faltantes».`
      : '';
  return `${base} Se encolaron ${result.enqueued.toLocaleString('es-MX')} para volver a pedirse a Quividi.${pending}`;
}
