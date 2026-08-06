import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import { LevelBadge, RatioBadge } from './LevelBadge';
import { LEVEL_LABELS } from '../types';
import type { OccupancyUnit } from '../types';

/**
 * Detalle de una unidad: explica el resultado (contenidos deduplicados,
 * vigencias, soporte, pantallas físicas y llave de deduplicación).
 */
export function OccupancyDetail({
  unit,
  onClose,
}: {
  unit: OccupancyUnit;
  onClose: () => void;
}) {
  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de la unidad"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card" style={{ maxWidth: 780 }}>
        <h2 className="modal__title">
          Tienda {unit.storeNumber} · {unit.normalization} · {unit.resolution}
        </h2>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {unit.storeName || 'Sin nombre'}
          {unit.centros ? ` · ${unit.centros}` : ''}
        </p>

        <p style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <LevelBadge level={unit.level} />
          <RatioBadge ratio={unit.recommendedRatio} />
          <span className="badge badge-muted">
            {unit.providerCount} proveedor
            {unit.providerCount === 1 ? '' : 'es'}
          </span>
        </p>

        {unit.providerCount === 0 ? (
          <div className="import__note">
            {LEVEL_LABELS['sin-ocupacion']}: no hay contenidos de proveedor
            vigentes para la fecha analizada. Esta unidad se muestra como alerta
            y queda <strong>fuera de ambos CSV</strong> (Ratio 1 y Ratio 3).
          </div>
        ) : (
          <table className="catalog__table" style={{ marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Artículo</th>
                <th>Vigencia inicio</th>
                <th>Vigencia fin</th>
                <th>Soporte</th>
                <th>Pantallas</th>
                <th>Llave de deduplicación</th>
              </tr>
            </thead>
            <tbody>
              {unit.contents.map((c) => (
                <tr key={c.dedupeKey}>
                  <td>{c.campaignName}</td>
                  <td>{c.articulos || '—'}</td>
                  <td>{formatCivilString(c.fechaInicio)}</td>
                  <td>{formatCivilString(c.fechaFin)}</td>
                  <td>{c.support}</td>
                  <td>{c.screenIds.length}</td>
                  <td>
                    <code>{c.dedupeKey}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          Pantallas físicas participantes: {unit.screenIds.length}. La
          deduplicación de contenidos es por{' '}
          <strong>Campaña + ARTICULOS</strong>; <code>TIPO DE PASES</code> y
          circuito no dividen el conteo.
        </p>

        <div className="modal__actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
