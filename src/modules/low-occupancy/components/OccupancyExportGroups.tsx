import { hasRatioRows } from '../occupancyCsv';
import type { OccupancyExportGroup } from '../types';

/**
 * Exportaciones por combinación de soporte normalizado + resolución. Cada grupo
 * ofrece hasta dos CSV (Ratio 1 y Ratio 3) y un acceso a las alertas de cero
 * proveedores. Los botones se deshabilitan cuando no hay filas (no se descargan
 * archivos vacíos).
 */
export function OccupancyExportGroups({
  groups,
  canExport,
  onDownload,
  onViewZero,
}: {
  groups: OccupancyExportGroup[];
  canExport: boolean;
  onDownload: (group: OccupancyExportGroup, ratio: 1 | 3) => void;
  onViewZero: (group: OccupancyExportGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-muted">No hay grupos exportables para esta fecha.</p>
    );
  }

  return (
    <section
      className="occ-groups"
      aria-label="Exportaciones por soporte y resolución"
    >
      {groups.map((g) => {
        const r1 = hasRatioRows(g, 1);
        const r3 = hasRatioRows(g, 3);
        return (
          <article key={g.key} className="occ-group card">
            <h3 className="occ-group__title">
              {g.normalization} · {g.resolution || 'sin resolución'}
            </h3>
            <ul className="occ-group__rows">
              <li>
                <span>
                  <span className="occ-ratio occ-ratio--r1">Ratio 1</span>{' '}
                  {g.ratio1Units.length} centros
                </span>
                {canExport ? (
                  <button
                    className="btn btn-secondary"
                    disabled={!r1}
                    onClick={() => onDownload(g, 1)}
                  >
                    {r1 ? 'Descargar CSV' : 'Sin pantallas para Ratio 1'}
                  </button>
                ) : (
                  <span className="text-muted">Sin permiso de exportación</span>
                )}
              </li>
              <li>
                <span>
                  <span className="occ-ratio occ-ratio--r3">Ratio 3</span>{' '}
                  {g.ratio3Units.length} centros
                </span>
                {canExport ? (
                  <button
                    className="btn btn-secondary"
                    disabled={!r3}
                    onClick={() => onDownload(g, 3)}
                  >
                    {r3 ? 'Descargar CSV' : 'Sin pantallas para Ratio 3'}
                  </button>
                ) : (
                  <span className="text-muted">Sin permiso de exportación</span>
                )}
              </li>
              <li>
                <span>
                  <span className="occ-badge occ-badge--sin-ocupacion">
                    Sin proveedores
                  </span>{' '}
                  {g.zeroUnits.length}
                </span>
                <button
                  className="btn btn-secondary"
                  disabled={g.zeroUnits.length === 0}
                  onClick={() => onViewZero(g)}
                >
                  Ver alertas
                </button>
              </li>
            </ul>
          </article>
        );
      })}
    </section>
  );
}
