import type {
  StoreOccupancy,
  StoreSupportOccupancy,
  SupportOccupancy,
} from '../occupancyModel';

const MAX_COLS = 8;
const MAX_ROWS = 12;

function level(peak: number): 0 | 1 | 2 | 3 | 4 {
  if (peak <= 0) return 0;
  if (peak === 1) return 1;
  if (peak === 2) return 2;
  if (peak === 3) return 3;
  return 4;
}

/**
 * Matriz tienda × soporte. El color indica **intensidad relativa** del pico de
 * campañas simultáneas dentro de la vista (0 vacío … 4 muy alto); no representa
 * capacidad ni saturación. Cada celda con carga abre el detalle.
 */
export function StoreSupportMatrix({
  supports,
  stores,
  matrix,
  onSelect,
}: {
  supports: SupportOccupancy[];
  stores: StoreOccupancy[];
  matrix: StoreSupportOccupancy[];
  onSelect: (c: StoreSupportOccupancy) => void;
}) {
  const cols = supports.slice(0, MAX_COLS);
  const rows = stores.slice(0, MAX_ROWS);
  const byKey = new Map(
    matrix.map((c) => [`${c.storeNumber}|${c.supportKey}`, c]),
  );

  if (rows.length === 0 || cols.length === 0) {
    return (
      <div className="occ-matrix-wrap">
        <p className="occ-empty" style={{ padding: '0.85rem' }}>
          Sin datos para construir la matriz en este periodo.
        </p>
      </div>
    );
  }

  return (
    <div className="occ-matrix-wrap">
      <table className="occ-matrix">
        <caption className="visually-hidden">
          Pico de campañas simultáneas por tienda y soporte. El color indica
          intensidad relativa, no capacidad.
        </caption>
        <thead>
          <tr>
            <th className="occ-matrix__rowhead" scope="col">
              Tienda
            </th>
            {cols.map((c) => (
              <th key={c.supportKey} scope="col" title={c.supportName}>
                {c.supportName}
              </th>
            ))}
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.storeNumber}>
              <th className="occ-matrix__rowhead" scope="row">
                {row.storeName}{' '}
                <span className="text-muted">· {row.storeNumber}</span>
              </th>
              {cols.map((col) => {
                const cell = byKey.get(`${row.storeNumber}|${col.supportKey}`);
                const peak = cell?.peakConcurrentCampaigns ?? 0;
                return (
                  <td key={col.supportKey}>
                    <button
                      type="button"
                      className={`occ-cell occ-cell--l${level(peak)}`}
                      disabled={!cell}
                      onClick={() => cell && onSelect(cell)}
                      aria-label={
                        cell
                          ? `${row.storeName}, ${col.supportName}: pico ${peak} campañas simultáneas, ${cell.distinctCampaigns} distintas. Ver detalle.`
                          : `${row.storeName}, ${col.supportName}: sin carga`
                      }
                    >
                      {peak > 0 ? peak : '·'}
                    </button>
                  </td>
                );
              })}
              <td>
                <strong>{row.peakConcurrentCampaigns}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
