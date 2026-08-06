import { LEVEL_LABELS, ratioLabel } from '../types';
import type { OccupancyLevel, RecommendedRatio } from '../types';

/**
 * Distintivo textual del nivel de ocupación. Accesibilidad: nunca solo color —
 * cada nivel lleva su etiqueta escrita y una clase que añade un símbolo.
 */
export function LevelBadge({ level }: { level: OccupancyLevel }) {
  return (
    <span className={`occ-badge occ-badge--${level}`}>
      {LEVEL_LABELS[level]}
    </span>
  );
}

/** Distintivo textual del ratio recomendado (o "Excluido de CSV"). */
export function RatioBadge({ ratio }: { ratio: RecommendedRatio }) {
  const kind = ratio === null ? 'excluido' : `r${ratio}`;
  return (
    <span className={`occ-ratio occ-ratio--${kind}`}>{ratioLabel(ratio)}</span>
  );
}
