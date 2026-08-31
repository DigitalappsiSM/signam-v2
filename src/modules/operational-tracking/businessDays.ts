import { parseCampaignDate } from '@/modules/campaigns/dateFilter';

/**
 * Utilidades puras de fechas civiles y días hábiles para el seguimiento
 * operativo. Se apoya en `parseCampaignDate`, que normaliza a **medianoche UTC**
 * una fecha civil (sin desfases de zona horaria ni DST): toda la aritmética se
 * hace con `Date.UTC`, tratando el `Date` como una fecha civil.
 *
 * Días hábiles: solo se excluyen sábado y domingo (aún no hay calendario de
 * festivos).
 */

/** Reexporta el parseo civil usado en el resto de la app. */
export { parseCampaignDate };

/** Construye la fecha civil de hoy (a partir de la fecha local) en UTC. */
export function todayCivil(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Suma `n` días civiles (puede ser negativo). */
export function addDays(d: Date, n: number): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n),
  );
}

/** Primer día hábil en o después de `d`. */
function nextBusinessDayOnOrAfter(d: Date): Date {
  let cur = d;
  while (isWeekend(cur)) cur = addDays(cur, 1);
  return cur;
}

/**
 * Quinto día hábil **inclusivo** desde `start`. Si `start` cae en fin de semana,
 * el primer día contado es el lunes siguiente. Ej.: inicio lunes → viernes.
 */
export function fifthBusinessDay(start: Date): Date {
  let cur = nextBusinessDayOnOrAfter(start);
  let counted = 1;
  while (counted < 5) {
    cur = addDays(cur, 1);
    if (!isWeekend(cur)) counted += 1;
  }
  return cur;
}

/**
 * Días naturales de tolerancia para entregar los **testigos completos** (T
 * Completos). La entrega inicia el día inmediato posterior al fin de la campaña
 * y hay esta ventana de días naturales para completarla.
 */
export const WITNESS_COMPLETE_GRACE_DAYS = 4;

/**
 * Vencimiento de T Completos: `fechaFin` + {@link WITNESS_COMPLETE_GRACE_DAYS}
 * días naturales. Es el último día **a tiempo** para entregar los testigos
 * completos (la entrega arranca el día inmediato posterior al fin de campaña).
 */
export function witnessCompleteDeadline(end: Date): Date {
  return addDays(end, WITNESS_COMPLETE_GRACE_DAYS);
}

/** Compara dos fechas civiles: <0, 0, >0. */
export function compareCivil(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

/**
 * Días hábiles restantes desde `today` (exclusivo) hasta `deadline` (inclusivo).
 * Si `deadline` es anterior o igual a `today`, devuelve 0.
 */
export function businessDaysUntil(today: Date, deadline: Date): number {
  if (compareCivil(deadline, today) <= 0) return 0;
  let count = 0;
  let cur = addDays(today, 1);
  while (compareCivil(cur, deadline) <= 0) {
    if (!isWeekend(cur)) count += 1;
    cur = addDays(cur, 1);
  }
  return count;
}

/** Días naturales restantes desde `today` hasta `deadline` (puede ser negativo). */
export function calendarDaysUntil(today: Date, deadline: Date): number {
  const ms = deadline.getTime() - today.getTime();
  return Math.round(ms / 86_400_000);
}

/** Formatea una fecha civil (UTC) como `AAAA-MM-DD` (para `input type="date"`). */
export function toIsoDate(d: Date): string {
  const yyyy = String(d.getUTCFullYear()).padStart(4, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Ventana por defecto de Seguimiento operativo: del **día 1 del mes anterior**
 * al **último día del mes siguiente** (mes anterior + mes actual + mes
 * siguiente), en fechas civiles. Devuelve los extremos en ISO `AAAA-MM-DD`.
 * `Date.UTC` normaliza los desbordes de mes/año (p. ej. enero → dic del año
 * anterior; diciembre → ene/feb del año siguiente).
 */
export function defaultTrackingWindow(now: Date = new Date()): {
  desde: string;
  hasta: string;
} {
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    desde: toIsoDate(new Date(Date.UTC(y, m - 1, 1))),
    // Día 0 del mes (m+2) = último día del mes siguiente (m+1).
    hasta: toIsoDate(new Date(Date.UTC(y, m + 2, 0))),
  };
}

/** Formatea una fecha civil como `dd/mm/aaaa`. */
export function formatDdMmYyyy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * Formatea a `dd/mm/aaaa` una fecha del calendario (string). Si no se puede
 * interpretar, devuelve el texto original recortado, o `—` si está vacío.
 */
export function formatCivilString(value: string | undefined): string {
  const d = parseCampaignDate(value ?? '');
  if (d) return formatDdMmYyyy(d);
  const t = (value ?? '').trim();
  return t === '' ? '—' : t;
}
