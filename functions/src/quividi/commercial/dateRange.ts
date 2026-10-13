/**
 * Rango de fechas de Inteligencia Comercial (auditoría y reconstrucción del
 * rollup). Módulo puro, sin Firebase, para compartirlo sin ciclos de imports.
 */

/**
 * Rango máximo (días, inclusive) de una auditoría o reconstrucción. Cada día dispara varias
 * lecturas de Firestore/Storage; sin tope, una llamada directa al callable con
 * `0000-01-01`…`9999-12-31` materializaría millones de fechas.
 */
export const MAX_AUDIT_DAYS = 93;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Rango válido: fechas reales, fin ≥ inicio y como máximo `MAX_AUDIT_DAYS`. */
export function isValidAuditRange(startDate: string, endDate: string): boolean {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return false;
  if (endDate < startDate) return false;
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  return days <= MAX_AUDIT_DAYS;
}
