import type { OccupancySummary as Summary } from '../types';

/** Resumen agregado del análisis de baja ocupación. */
export function OccupancySummary({ summary }: { summary: Summary }) {
  const cards: { label: string; value: number; tone: string }[] = [
    { label: 'Total de unidades', value: summary.totalUnits, tone: 'total' },
    { label: 'Sin ocupación (0)', value: summary.zero, tone: 'zero' },
    { label: '1 proveedor', value: summary.one, tone: 'one' },
    { label: '2 proveedores', value: summary.two, tone: 'two' },
    { label: '3 o más', value: summary.threePlus, tone: 'ok' },
    {
      label: 'Grupos exportables',
      value: summary.exportableGroups,
      tone: 'total',
    },
    { label: 'Incidencias', value: summary.issues, tone: 'warn' },
  ];
  return (
    <section
      className="occ-summary"
      aria-label="Resumen del análisis de ocupación"
    >
      {cards.map((c) => (
        <div
          key={c.label}
          className={`occ-summary__card occ-summary__card--${c.tone}`}
        >
          <span className="occ-summary__value">{c.value}</span>
          <span className="occ-summary__label">{c.label}</span>
        </div>
      ))}
    </section>
  );
}
