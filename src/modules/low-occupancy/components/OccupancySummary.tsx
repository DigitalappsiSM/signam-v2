import type { OccupancySummary as Summary } from '../types';

/** Segmento de la barra de distribución (decorativa; el texto vive en la leyenda). */
const SEGMENTS: { tone: 'zero' | 'one' | 'two' | 'ok'; key: keyof Summary }[] =
  [
    { tone: 'zero', key: 'zero' },
    { tone: 'one', key: 'one' },
    { tone: 'two', key: 'two' },
    { tone: 'ok', key: 'threePlus' },
  ];

/**
 * Resumen del análisis: un titular ("cuántas unidades requieren atención hoy")
 * más una barra de distribución para escanear de un vistazo, y una leyenda
 * compacta con las cifras exactas (incluye los conteos administrativos:
 * grupos exportables e incidencias).
 */
export function OccupancySummary({ summary }: { summary: Summary }) {
  const attention = summary.zero + summary.one + summary.two;
  const total = summary.totalUnits;

  const stats: { label: string; value: number; tone: string }[] = [
    { label: 'Sin ocupación (0)', value: summary.zero, tone: 'zero' },
    { label: '1 proveedor', value: summary.one, tone: 'one' },
    { label: '2 proveedores', value: summary.two, tone: 'two' },
    { label: '3 o más', value: summary.threePlus, tone: 'ok' },
    { label: 'Total de unidades', value: summary.totalUnits, tone: 'total' },
    {
      label: 'Grupos exportables',
      value: summary.exportableGroups,
      tone: 'total',
    },
    { label: 'Incidencias', value: summary.issues, tone: 'warn' },
  ];

  const distribution = `${summary.zero} sin ocupación, ${summary.one} con 1 proveedor, ${summary.two} con 2 proveedores y ${summary.threePlus} con 3 o más, de ${total} unidades evaluadas`;

  return (
    <section
      className="occ-summary"
      aria-label="Resumen del análisis de ocupación"
    >
      <div className="occ-summary__hero">
        <span className="occ-summary__hero-value">{attention}</span>
        <div className="occ-summary__hero-text">
          <p className="occ-summary__hero-label">
            {attention === 1 ? 'unidad requiere' : 'unidades requieren'}{' '}
            atención
          </p>
          <p className="text-muted occ-summary__hero-sub">
            de {total} {total === 1 ? 'unidad evaluada' : 'unidades evaluadas'}
          </p>
        </div>
      </div>

      {total > 0 && (
        <div
          className="occ-summary__bar"
          role="img"
          aria-label={`Distribución de ocupación: ${distribution}`}
        >
          {SEGMENTS.map(
            ({ tone, key }) =>
              summary[key] > 0 && (
                <span
                  key={tone}
                  className={`occ-summary__bar-segment occ-summary__bar-segment--${tone}`}
                  style={{ width: `${(summary[key] / total) * 100}%` }}
                />
              ),
          )}
        </div>
      )}

      <ul className="occ-summary__legend">
        {stats.map((s) => (
          <li
            key={s.label}
            className={`occ-summary__stat occ-summary__stat--${s.tone}`}
          >
            <span className="occ-summary__value">{s.value}</span>
            <span className="occ-summary__label">{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
