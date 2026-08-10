import { ComparisonBadge } from './ComparisonBadge';
import { formatIsoDdMmYyyy, pluralizeCentros } from '../occupancyComparison';
import type {
  CentroRef,
  GroupComparison,
  SectionComparison,
} from '../occupancyComparison';

/**
 * Detalle de los cambios de una tarjeta respecto al día anterior: por sección
 * (Ratio 1, Ratio 3 y Sin proveedores) muestra el estado, los conteos y la lista
 * de centros que **entraron** y **salieron**.
 */
export function OccupancyChangeDetail({
  comparison,
  selectedDate,
  previousDate,
  onClose,
}: {
  comparison: GroupComparison;
  selectedDate: string;
  previousDate: string;
  onClose: () => void;
}) {
  const sections: { label: string; section: SectionComparison }[] = [
    { label: 'Ratio 1', section: comparison.ratio1 },
    { label: 'Ratio 3', section: comparison.ratio3 },
    { label: 'Sin proveedores', section: comparison.zero },
  ];

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de cambios respecto al día anterior"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card" style={{ maxWidth: 720 }}>
        <h2 className="modal__title">
          Cambios · {comparison.normalization} ·{' '}
          {comparison.resolution || 'sin resolución'}
        </h2>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {formatIsoDdMmYyyy(selectedDate)} comparado con{' '}
          <strong>{formatIsoDdMmYyyy(previousDate)}</strong>{' '}
          <ComparisonBadge status={comparison.overall} />
        </p>

        <div className="occ-changes">
          {sections.map(({ label, section }) => (
            <section key={label} className="occ-changes__section">
              <h3 className="occ-changes__title">
                {label} <ComparisonBadge status={section.status} small />
              </h3>
              <p className="text-muted occ-changes__counts">
                Hoy: {section.today} · Día anterior: {section.yesterday}
              </p>
              <ChangeList
                heading={`Entraron (${section.entered.length})`}
                tone="in"
                centros={section.entered}
              />
              <ChangeList
                heading={`Salieron (${section.exited.length})`}
                tone="out"
                centros={section.exited}
              />
              {section.entered.length === 0 && section.exited.length === 0 && (
                <p className="text-muted occ-changes__empty">
                  Sin entradas ni salidas de centros.
                </p>
              )}
            </section>
          ))}
        </div>

        <div className="modal__actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangeList({
  heading,
  tone,
  centros,
}: {
  heading: string;
  tone: 'in' | 'out';
  centros: CentroRef[];
}) {
  if (centros.length === 0) return null;
  return (
    <div className={`occ-changes__list occ-changes__list--${tone}`}>
      <span className="occ-changes__list-head">{heading}</span>
      <ul>
        {centros.map((c) => (
          <li key={c.key}>
            <strong>Tienda {c.storeNumber}</strong>
            {c.centros ? ` · ${c.centros}` : ''}
            {c.storeName ? ` · ${c.storeName}` : ''}
          </li>
        ))}
      </ul>
      <span className="visually-hidden">
        {pluralizeCentros(centros.length)}
      </span>
    </div>
  );
}
