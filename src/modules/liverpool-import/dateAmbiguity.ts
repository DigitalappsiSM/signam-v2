/**
 * Detección y resolución de **fechas ambiguas** del calendario.
 *
 * Tras la lectura del libro (`readCalendarWorkbook`), las celdas de **fecha real**
 * de Excel ya llegan como ISO `AAAA-MM-DD` (sin ambigüedad). Las que llegan como
 * **texto numérico** `A/B/AAAA` pueden ser día-primero (`d/m`) o mes-primero
 * (`m/d`) cuando ambos componentes son ≤ 12: en ese caso no se debe adivinar,
 * sino pedir confirmación al usuario y **recordar** la elección.
 *
 * Puro y determinista; no toca red ni React.
 */

export type DateOrder = 'DMY' | 'MDY';

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month1: number): number {
  if (month1 === 2 && isLeap(year)) return 29;
  return DAYS_IN_MONTH[month1 - 1] ?? 31;
}

function iso(year: number, month1: number, day: number): string | null {
  if (month1 < 1 || month1 > 12) return null;
  if (day < 1 || day > daysInMonth(year, month1)) return null;
  const mm = String(month1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/** Componentes numéricos `A/B/AAAA` (o `-`), o `null` si no aplica. */
function numericParts(
  value: string,
): { a: number; b: number; year: number } | null {
  const m = (value ?? '').trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  let year = Number(m[3]);
  if (m[3]!.length <= 2) year += 2000;
  return { a: Number(m[1]), b: Number(m[2]), year };
}

/**
 * ¿La fecha es **ambigua**? Solo cuando es texto numérico `A/B/AAAA` con ambos
 * componentes ≤ 12 y distintos (no se puede saber cuál es día y cuál mes). Las
 * fechas ISO, las que tienen un componente > 12 y las de componentes iguales
 * **no** son ambiguas.
 */
export function isAmbiguousDate(value: string): boolean {
  const p = numericParts(value);
  if (!p) return false;
  return p.a <= 12 && p.b <= 12 && p.a !== p.b;
}

/** Interpreta una fecha numérica con un orden dado → ISO, o `null` si no es válida. */
export function interpretDate(value: string, order: DateOrder): string | null {
  const p = numericParts(value);
  if (!p) return null;
  return order === 'DMY' ? iso(p.year, p.b, p.a) : iso(p.year, p.a, p.b);
}

/** Las dos lecturas posibles de una fecha ambigua (para mostrarlas al usuario). */
export interface AmbiguousInterpretations {
  /** Día-primero (`dd/mm`). */
  dmy: string | null;
  /** Mes-primero (`mm/dd`). */
  mdy: string | null;
}

export function ambiguousInterpretations(
  value: string,
): AmbiguousInterpretations {
  return {
    dmy: interpretDate(value, 'DMY'),
    mdy: interpretDate(value, 'MDY'),
  };
}
