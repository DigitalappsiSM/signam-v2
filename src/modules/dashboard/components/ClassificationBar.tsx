import {
  CLASSIFICATION_LABEL,
  type ClassificationBreakdown,
} from '../occupancyModel';

const ORDER = ['institutional', 'provider', 'unknown'] as const;

/**
 * Barra horizontal apilada por clasificación (Institucional / Proveedor /
 * Pendiente). El ancho total es relativo a `max` (comparación entre filas); los
 * segmentos son proporcionales al desglose. No transmite información solo por
 * color: expone `aria-label` con los números y la leyenda se muestra aparte.
 */
export function ClassificationBar({
  breakdown,
  total,
  max,
}: {
  breakdown: ClassificationBreakdown;
  total: number;
  max: number;
}) {
  const widthPct =
    max > 0 ? Math.max((total / max) * 100, total > 0 ? 6 : 0) : 0;
  const label = ORDER.filter((k) => breakdown[k] > 0)
    .map((k) => `${CLASSIFICATION_LABEL[k]}: ${breakdown[k]}`)
    .join(', ');
  return (
    <div
      className="occ-bar"
      style={{ width: `${widthPct}%` }}
      role="img"
      aria-label={label || 'Sin campañas'}
    >
      {ORDER.map((k) =>
        breakdown[k] > 0 ? (
          <span
            key={k}
            className={`occ-bar__seg occ-bar__seg--${k}`}
            style={{ flexGrow: breakdown[k] }}
            title={`${CLASSIFICATION_LABEL[k]}: ${breakdown[k]}`}
          />
        ) : null,
      )}
    </div>
  );
}

/** Leyenda accesible compartida por las gráficas. */
export function ClassificationLegend() {
  return (
    <div className="occ-legend">
      {ORDER.map((k) => (
        <span key={k} className="occ-legend__item">
          <span className={`occ-swatch occ-swatch--${k}`} aria-hidden="true" />
          {CLASSIFICATION_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
