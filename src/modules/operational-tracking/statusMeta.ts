import type { WitnessStatus } from './operationalStatus';
import type { DownloadLinkStatus } from './downloadLink';
import type { IconName } from '@/components/Icon';

/**
 * Etiquetas visuales de los estados. Cada estado se transmite con **icono +
 * texto** (no solo color) para accesibilidad; el color de `cls` es un refuerzo.
 * Los iconos son nombres del set SVG (`components/Icon`), coherentes con el
 * resto de la interfaz.
 */
export const STATUS_META: Record<
  WitnessStatus,
  { label: string; icon: IconName; cls: string }
> = {
  // Testigos no aplicables (campañas Institucional): estado neutro, sin
  // obligación ni urgencia. Icono `minus` y clase gris (misma que "cancelada").
  'not-applicable': { label: 'No aplica', icon: 'minus', cls: 'ot-na-badge' },
  overdue: { label: 'Vencido', icon: 'ban', cls: 'ot-overdue' },
  'due-today': { label: 'Vence hoy', icon: 'clock', cls: 'ot-due-today' },
  'due-soon': {
    label: 'Por vencer',
    icon: 'alert-triangle',
    cls: 'ot-due-soon',
  },
  'invalid-date': { label: 'Fecha inválida', icon: 'help', cls: 'ot-invalid' },
  'on-track': { label: 'En tiempo', icon: 'circle-dot', cls: 'ot-on-track' },
  'completed-late': {
    label: 'Completado tarde',
    icon: 'check',
    cls: 'ot-late',
  },
  'completed-on-time': {
    label: 'Completado',
    icon: 'check-circle',
    cls: 'ot-done',
  },
  upcoming: { label: 'Próximo inicio', icon: 'calendar', cls: 'ot-upcoming' },
};

export const LINK_META: Record<
  DownloadLinkStatus,
  { label: string; icon: IconName }
> = {
  valid: { label: 'Link válido', icon: 'check' },
  missing: { label: 'Link faltante', icon: 'minus' },
  invalid: { label: 'Link inválido', icon: 'alert-triangle' },
};
