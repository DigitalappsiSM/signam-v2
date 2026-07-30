/**
 * Filtrado por periodo (`Desde` / `Hasta`) de las campañas.
 *
 * Lógica pura y determinística: parsea el formato real de `fechaInicio` /
 * `fechaFin` a una fecha normalizada (medianoche UTC, sin desfases de zona
 * horaria) y decide si una campaña intersecta el periodo elegido. No compara
 * cadenas ni usa `new Date(string)` (ambiguo entre navegadores/locales).
 *
 * Formatos aceptados:
 * - ISO `YYYY-MM-DD` (también el prefijo de un ISO completo, p. ej. el que
 *   produce `Date.toISOString()`), que es como llegan los `input type="date"`.
 * - `D/M/AAAA` o `D/M/AA` (y con `-`): se interpreta día-primero (locale de
 *   México, origen de Liverpool). Si el primer componente es > 12 se toma como
 *   día; si el segundo es > 12 se interpreta mes-primero; en caso contrario se
 *   asume día-primero.
 *
 * Fechas vacías o no parseables devuelven `null`; su tratamiento en el filtro
 * se documenta en `campaignIntersectsPeriod`.
 */

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month1: number): number {
  if (month1 === 2 && isLeap(year)) return 29;
  return DAYS_IN_MONTH[month1 - 1] ?? 31;
}

/** Construye una fecha en medianoche UTC si (y, m, d) son válidos; si no, null. */
function utcDate(year: number, month1: number, day: number): Date | null {
  if (month1 < 1 || month1 > 12) return null;
  if (day < 1 || day > daysInMonth(year, month1)) return null;
  return new Date(Date.UTC(year, month1 - 1, day));
}

/**
 * Parsea `fechaInicio` / `fechaFin` (o el valor de un `input type="date"`) a una
 * fecha normalizada en medianoche UTC. Devuelve `null` si está vacía o no es
 * interpretable.
 */
export function parseCampaignDate(value: string): Date | null {
  const t = (value ?? '').trim();
  if (t === '') return null;

  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const parts = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (parts) {
    const a = Number(parts[1]);
    const b = Number(parts[2]);
    let year = Number(parts[3]);
    if (parts[3]!.length <= 2) year += 2000;

    let day: number;
    let month: number;
    if (a > 12) {
      day = a;
      month = b;
    } else if (b > 12) {
      // El segundo componente no puede ser un mes: es mes-primero.
      month = a;
      day = b;
    } else {
      // Ambiguo: día-primero (locale de México).
      day = a;
      month = b;
    }
    return utcDate(year, month, day);
  }

  return null;
}

export interface Period {
  desde: Date | null;
  hasta: Date | null;
}

/**
 * Valida el periodo elegido. Devuelve un mensaje si `Desde` es posterior a
 * `Hasta` (rango invertido); en cualquier otro caso, `null`.
 */
export function periodError(desde: string, hasta: string): string | null {
  const d = parseCampaignDate(desde);
  const h = parseCampaignDate(hasta);
  if (d && h && d.getTime() > h.getTime()) {
    return 'La fecha "Desde" no puede ser posterior a "Hasta".';
  }
  return null;
}

/** Indica si hay al menos un extremo del periodo activo. */
export function hasPeriodFilter(desde: string, hasta: string): boolean {
  return parseCampaignDate(desde) !== null || parseCampaignDate(hasta) !== null;
}

/**
 * ¿La campaña (`startStr`..`endStr`) intersecta el periodo `desde`..`hasta`?
 *
 * Intersección inclusiva en los límites:
 * - ambos: `inicio <= hasta && fin >= desde`;
 * - solo `desde`: `fin >= desde`;
 * - solo `hasta`: `inicio <= hasta`;
 * - ninguno: siempre `true` (sin filtro temporal).
 *
 * Fechas de campaña: si falta una de las dos, se usa la otra como ambos
 * extremos (una campaña de un solo día conocido). Si faltan ambas y hay algún
 * filtro activo, la campaña se excluye (no se puede confirmar la intersección).
 */
export function campaignIntersectsPeriod(
  startStr: string,
  endStr: string,
  desde: Date | null,
  hasta: Date | null,
): boolean {
  if (!desde && !hasta) return true;

  const cStart = parseCampaignDate(startStr);
  const cEnd = parseCampaignDate(endStr);
  const start = cStart ?? cEnd;
  const end = cEnd ?? cStart;
  if (!start || !end) return false;

  if (desde && hasta) {
    return (
      start.getTime() <= hasta.getTime() && end.getTime() >= desde.getTime()
    );
  }
  if (desde) return end.getTime() >= desde.getTime();
  if (hasta) return start.getTime() <= hasta.getTime();
  return true;
}
