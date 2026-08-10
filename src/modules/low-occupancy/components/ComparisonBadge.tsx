import { COMPARISON_LABELS } from '../occupancyComparison';
import type { ComparisonStatus } from '../occupancyComparison';

/**
 * Distintivo del estado de comparación contra el día anterior. Accesibilidad:
 * nunca solo color — cada estado lleva su etiqueta escrita y una clase que añade
 * un símbolo.
 */
export function ComparisonBadge({
  status,
  small = false,
}: {
  status: ComparisonStatus;
  small?: boolean;
}) {
  return (
    <span
      className={`occ-diff occ-diff--${status}${small ? ' occ-diff--sm' : ''}`}
    >
      {COMPARISON_LABELS[status]}
    </span>
  );
}
