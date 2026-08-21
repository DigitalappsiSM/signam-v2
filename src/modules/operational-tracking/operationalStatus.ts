import {
  parseCampaignDate,
  fifthBusinessDay,
  businessDaysUntil,
  calendarDaysUntil,
  compareCivil,
  todayCivil,
} from './businessDays';

/**
 * Estados y alertas de los testigos (T Arranque / T Completos). Todo es puro y
 * recibe la fecha civil de "hoy" para poder probarse sin depender del reloj.
 */

export type WitnessStatus =
  | 'not-applicable'
  | 'upcoming'
  | 'on-track'
  | 'due-soon'
  | 'due-today'
  | 'overdue'
  | 'completed-on-time'
  | 'completed-late'
  | 'invalid-date';

export interface WitnessInput {
  startStr: string;
  endStr: string;
  completed: boolean;
  completedAt: number | null;
  /** Fecha civil de hoy (medianoche UTC). */
  today: Date;
}

/**
 * Prioridad visual (menor = más urgente), según la especificación §10.
 *
 * `not-applicable` (testigos no aplicables para campañas Institucional) tiene la
 * severidad más baja: se ordena después de cualquier obligación real, pendiente o
 * urgente, para no competir con estados que sí requieren acción.
 */
export const STATUS_SEVERITY: Record<WitnessStatus, number> = {
  overdue: 1,
  'due-today': 2,
  'due-soon': 3,
  'invalid-date': 4,
  'on-track': 5,
  'completed-late': 6,
  'completed-on-time': 7,
  upcoming: 8,
  'not-applicable': 9,
};

/** Convierte un timestamp de completado a su fecha civil (zona local). */
function completedCivil(ts: number): Date {
  return todayCivil(new Date(ts));
}

/** Estado de T Arranque: límite = 5.º día hábil inclusivo desde el inicio. */
export function witnessStartStatus(input: WitnessInput): WitnessStatus {
  const start = parseCampaignDate(input.startStr);
  if (!start) return 'invalid-date';
  const deadline = fifthBusinessDay(start);

  if (input.completed) {
    if (input.completedAt == null) return 'completed-on-time';
    return compareCivil(completedCivil(input.completedAt), deadline) <= 0
      ? 'completed-on-time'
      : 'completed-late';
  }

  if (compareCivil(input.today, start) < 0) return 'upcoming';
  const cmp = compareCivil(input.today, deadline);
  if (cmp > 0) return 'overdue';
  if (cmp === 0) return 'due-today';
  return businessDaysUntil(input.today, deadline) <= 2
    ? 'due-soon'
    : 'on-track';
}

/** Estado de T Completos: límite = `fechaFin` (fin del día local). */
export function witnessCompleteStatus(input: WitnessInput): WitnessStatus {
  const end = parseCampaignDate(input.endStr);
  if (!end) return 'invalid-date';

  if (input.completed) {
    if (input.completedAt == null) return 'completed-on-time';
    return compareCivil(completedCivil(input.completedAt), end) <= 0
      ? 'completed-on-time'
      : 'completed-late';
  }

  const start = parseCampaignDate(input.startStr);
  if (start && compareCivil(input.today, start) < 0) return 'upcoming';

  const cmp = compareCivil(input.today, end);
  if (cmp > 0) return 'overdue';
  if (cmp === 0) return 'due-today';
  return calendarDaysUntil(input.today, end) <= 5 ? 'due-soon' : 'on-track';
}

/** ¿El estado representa una obligación pendiente y vencida/por vencer? */
export function isPendingAlert(status: WitnessStatus): boolean {
  return (
    status === 'overdue' || status === 'due-today' || status === 'due-soon'
  );
}
