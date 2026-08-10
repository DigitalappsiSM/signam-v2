import { hasRatioRows } from '../occupancyCsv';
import { formatIsoDdMmYyyy } from '../occupancyComparison';
import type {
  GroupComparison,
  OccupancyComparison,
} from '../occupancyComparison';
import type { OccupancyExportGroup, OccupancyUnit } from '../types';
import { ComparisonBadge } from './ComparisonBadge';

/** Total de pantallas físicas (informativo) de un conjunto de unidades. */
function pantallasOf(units: OccupancyUnit[]): number {
  return units.reduce((total, u) => total + u.screenIds.length, 0);
}

/**
 * Exportaciones por combinación de soporte normalizado + resolución. Cada grupo
 * ofrece hasta dos CSV (Ratio 1 y Ratio 3) y un acceso a las alertas de cero
 * proveedores. Cada tarjeta indica además si el resultado **cambió respecto al
 * día anterior** (estado general y por sección) para evitar cargar archivos
 * idénticos en Admira. El número de **pantallas** es informativo y no coincide
 * necesariamente con las filas deduplicadas del CSV. Los botones se deshabilitan
 * cuando no hay filas (no se descargan archivos vacíos).
 */
export function OccupancyExportGroups({
  groups,
  canExport,
  comparison,
  onDownload,
  onViewZero,
  onViewChanges,
}: {
  groups: OccupancyExportGroup[];
  canExport: boolean;
  comparison: OccupancyComparison;
  onDownload: (group: OccupancyExportGroup, ratio: 1 | 3) => void;
  onViewZero: (group: OccupancyExportGroup) => void;
  onViewChanges: (comparison: GroupComparison) => void;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-muted">No hay grupos exportables para esta fecha.</p>
    );
  }

  const comparedLabel = formatIsoDdMmYyyy(comparison.previousDate);

  return (
    <section
      className="occ-groups"
      aria-label="Exportaciones por soporte y resolución"
    >
      {groups.map((g) => {
        const r1 = hasRatioRows(g, 1);
        const r3 = hasRatioRows(g, 3);
        const cmp = comparison.groups.get(g.key);
        return (
          <article key={g.key} className="occ-group card">
            <header className="occ-group__head">
              <h3 className="occ-group__title">
                {g.normalization} · {g.resolution || 'sin resolución'}
              </h3>
              {cmp && (
                <span className="occ-group__diff">
                  <ComparisonBadge status={cmp.overall} />
                  <span className="text-muted occ-group__vs">
                    vs {comparedLabel}
                  </span>
                </span>
              )}
            </header>
            <ul className="occ-group__rows">
              <li>
                <span>
                  <span className="occ-ratio occ-ratio--r1">Ratio 1</span>{' '}
                  {g.ratio1Units.length} centros · {pantallasOf(g.ratio1Units)}{' '}
                  pantallas
                  {cmp && (
                    <>
                      {' '}
                      <ComparisonBadge status={cmp.ratio1.status} small />
                    </>
                  )}
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
                  {g.ratio3Units.length} centros · {pantallasOf(g.ratio3Units)}{' '}
                  pantallas
                  {cmp && (
                    <>
                      {' '}
                      <ComparisonBadge status={cmp.ratio3.status} small />
                    </>
                  )}
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
                  {g.zeroUnits.length} centros · {pantallasOf(g.zeroUnits)}{' '}
                  pantallas
                  {cmp && (
                    <>
                      {' '}
                      <ComparisonBadge status={cmp.zero.status} small />
                    </>
                  )}
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
            {cmp?.hasChanges && (
              <button
                className="btn btn-secondary occ-group__changes"
                onClick={() => onViewChanges(cmp)}
              >
                Ver cambios del día
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
