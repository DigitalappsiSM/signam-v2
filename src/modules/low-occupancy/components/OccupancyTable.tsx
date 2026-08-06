import { LevelBadge, RatioBadge } from './LevelBadge';
import type { OccupancyUnit } from '../types';

/** Tabla de unidades evaluadas (tienda + normalización + resolución). */
export function OccupancyTable({
  units,
  onSelect,
}: {
  units: OccupancyUnit[];
  onSelect: (unit: OccupancyUnit) => void;
}) {
  if (units.length === 0) {
    return (
      <div className="card">
        <p className="text-muted" style={{ margin: 0 }}>
          Ninguna unidad coincide con los filtros.
        </p>
      </div>
    );
  }

  return (
    <div className="diagnosis__table-wrap">
      <table className="catalog__table">
        <thead>
          <tr>
            <th># Tienda</th>
            <th>Centro</th>
            <th>Nombre de tienda</th>
            <th>Normalización</th>
            <th>Resolución</th>
            <th># Proveedores</th>
            <th>Nivel</th>
            <th>Ratio</th>
            <th aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.key}>
              <td>{u.storeNumber}</td>
              <td>{u.centros || '—'}</td>
              <td>{u.storeName || '—'}</td>
              <td>{u.normalization}</td>
              <td>{u.resolution || '—'}</td>
              <td>{u.providerCount}</td>
              <td>
                <LevelBadge level={u.level} />
              </td>
              <td>
                <RatioBadge ratio={u.recommendedRatio} />
              </td>
              <td>
                <button
                  className="icon-btn"
                  title={`Ver detalle de la tienda ${u.storeNumber} ${u.normalization} ${u.resolution}`}
                  aria-label={`Ver detalle de la tienda ${u.storeNumber} ${u.normalization} ${u.resolution}`}
                  onClick={() => onSelect(u)}
                >
                  👁️
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
