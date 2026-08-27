import {
  DIGITAL_CHECK_KEYS,
  type DigitalOperationalItem,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';

export type DigitalProgressStatus =
  'not-started' | 'in-progress' | 'complete' | 'cancelled';

export interface DigitalPeriodOption {
  key: string;
  id: string;
  label: string;
  start: string;
  end: string;
}

/** Identidad de filtro que evita mezclar C17/C18 de años diferentes. */
export function digitalPeriodKey(
  item: Pick<DigitalOperationalItem, 'periodId' | 'periodStart' | 'periodEnd'>,
): string {
  return `${item.periodStart}|${item.periodEnd}|${item.periodId}`;
}

/** Texto comparable para búsquedas sin depender de mayúsculas ni acentos. */
export function normalizeDigitalSearch(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Estado de avance derivado exclusivamente de los tres checks digitales. */
export function digitalProgressStatus(
  tracking: DigitalOperationalTracking,
): DigitalProgressStatus {
  if (tracking.lifecycleStatus === 'cancelled') return 'cancelled';
  const completed = DIGITAL_CHECK_KEYS.filter(
    (key) => tracking.checks[key].completed,
  ).length;
  if (completed === 0) return 'not-started';
  if (completed === DIGITAL_CHECK_KEYS.length) return 'complete';
  return 'in-progress';
}

/** Catorcenas únicas disponibles, ordenadas por fecha civil de inicio. */
export function digitalPeriodOptions(
  items: readonly DigitalOperationalItem[],
): DigitalPeriodOption[] {
  const byKey = new Map<string, DigitalPeriodOption>();
  for (const item of items) {
    const key = digitalPeriodKey(item);
    const current = byKey.get(key);
    const candidate = {
      key,
      id: item.periodId,
      label: item.periodLabel,
      start: item.periodStart,
      end: item.periodEnd,
    };
    if (!current || candidate.start < current.start) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      a.label.localeCompare(b.label, 'es', { numeric: true }),
  );
}

/**
 * Ventana predeterminada: catorcena anterior, vigente y siguiente. Cuando hoy
 * cae entre periodos, toma como referencia la siguiente; fuera del calendario,
 * usa el extremo más cercano para que la pantalla nunca quede vacía por defecto.
 */
export function surroundingPeriodIds(
  periods: readonly DigitalPeriodOption[],
  today: string,
): Set<string> {
  if (periods.length === 0) return new Set();
  let index = periods.findIndex(
    (period) => period.start <= today && today <= period.end,
  );
  if (index < 0) {
    const next = periods.findIndex((period) => period.start > today);
    index = next >= 0 ? next : periods.length - 1;
  }
  return new Set(
    periods
      .slice(Math.max(0, index - 1), Math.min(periods.length, index + 2))
      .map((period) => period.key),
  );
}

/** Fecha civil ISO mostrada sin conversiones de zona horaria. */
export function formatDigitalDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value || '—';
}
