import type { WitnessStatus } from './operationalStatus';
import type { DownloadLinkStatus } from './downloadLink';

/**
 * Etiquetas visuales de los estados. Cada estado se transmite con **icono +
 * texto** (no solo color) para accesibilidad; el color de `cls` es un refuerzo.
 */
export const STATUS_META: Record<
  WitnessStatus,
  { label: string; icon: string; cls: string }
> = {
  overdue: { label: 'Vencido', icon: '⛔', cls: 'ot-overdue' },
  'due-today': { label: 'Vence hoy', icon: '⏰', cls: 'ot-due-today' },
  'due-soon': { label: 'Por vencer', icon: '⚠️', cls: 'ot-due-soon' },
  'invalid-date': { label: 'Fecha inválida', icon: '❓', cls: 'ot-invalid' },
  'on-track': { label: 'En tiempo', icon: '🟢', cls: 'ot-on-track' },
  'completed-late': { label: 'Completado tarde', icon: '✔️', cls: 'ot-late' },
  'completed-on-time': { label: 'Completado', icon: '✅', cls: 'ot-done' },
  upcoming: { label: 'Próximo inicio', icon: '🗓️', cls: 'ot-upcoming' },
};

export const LINK_META: Record<
  DownloadLinkStatus,
  { label: string; icon: string }
> = {
  valid: { label: 'Link válido', icon: '✅' },
  missing: { label: 'Link faltante', icon: '➖' },
  invalid: { label: 'Link inválido', icon: '⚠️' },
};
