import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { isFirebaseConfigured } from '@/services/firebase';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import { listCampaigns } from '@/services/campaigns';
import {
  listEkonLinks,
  ekonNumberForCampaign,
} from '@/services/campaignEkonLinks';
import { listActiveAssignmentsByEkonNumber } from '@/services/ekonAssignments';
import { hasCompletedBatch as hasCompletedBatchQuery } from '@/services/ekonImports';
import {
  reconciliationStatusLabel,
  type EkonAssignment,
  type ReconciliationStatus,
} from '@/domain/ekon';
import {
  buildReconciliationRows,
  filterReconciliationRows,
  summarizeReconciliation,
  type ReconciliationRow,
} from './reconciliationView';

/** Conciliación Ekon ↔ Liverpool para campañas con vínculo manual. */
export function ReconciliationPage() {
  const configured = isFirebaseConfigured();
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasBatch, setHasBatch] = useState(true);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ReconciliationStatus | 'all'>('all');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [detail, setDetail] = useState<ReconciliationRow | null>(null);

  useEffect(() => {
    if (!configured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [campaigns, links, completed] = await Promise.all([
          listCampaigns(),
          listEkonLinks(),
          hasCompletedBatchQuery(),
        ]);
        // Números Ekon vinculados (únicos) → asignaciones vigentes por número.
        const numbers = new Set<string>();
        for (const campaign of campaigns) {
          const n = ekonNumberForCampaign(campaign, links);
          if (n !== null) numbers.add(String(n));
        }
        const byNumber = new Map<string, EkonAssignment[]>();
        await Promise.all(
          [...numbers].map(async (n) => {
            byNumber.set(n, await listActiveAssignmentsByEkonNumber(n));
          }),
        );
        if (cancelled) return;
        setHasBatch(completed);
        setRows(buildReconciliationRows(campaigns, links, byNumber));
      } catch {
        if (!cancelled)
          setError('No se pudieron cargar los datos de conciliación.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const filtered = useMemo(
    () => filterReconciliationRows(rows, { text, status, onlyIssues }),
    [rows, text, status, onlyIssues],
  );
  const summary = useMemo(() => summarizeReconciliation(rows), [rows]);

  return (
    <>
      <PageHeader
        title="Conciliación"
        description="Compara cada campaña Liverpool vinculada manualmente con sus asignaciones Ekon vigentes: número, tipo, periodos, circuito y tiendas. Explica diferencias sin modificar ninguna fuente."
      />

      {!configured && (
        <div className="catalog__notice" role="status">
          Firebase no está configurado (modo degradado): no hay datos de
          conciliación.
        </div>
      )}
      {configured && !hasBatch && (
        <div className="catalog__notice" role="status">
          Aún no hay ninguna importación Ekon completada. Importa un archivo
          Ekon para conciliar.
        </div>
      )}
      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}
      {loading && <p className="text-muted">Cargando conciliación…</p>}

      {!loading && configured && (
        <>
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <dl className="import__summary">
              <div>
                <dt>Conciliadas</dt>
                <dd>
                  <strong>{summary.conciliadas}</strong>
                </dd>
              </div>
              <div>
                <dt>Con advertencias</dt>
                <dd>{summary.advertencias}</dd>
              </div>
              <div>
                <dt>Con error</dt>
                <dd>{summary.error}</dd>
              </div>
              <div>
                <dt>Vinculadas</dt>
                <dd>{rows.length}</dd>
              </div>
            </dl>
          </div>

          <div
            className="card"
            style={{
              marginBottom: '1.25rem',
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <input
              className="catalog__search"
              placeholder="Buscar campaña, número Ekon o producto…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Buscar"
            />
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as ReconciliationStatus | 'all')
              }
              aria-label="Estado de conciliación"
            >
              <option value="all">Todos los estados</option>
              <option value="conciliada">Conciliada</option>
              <option value="conciliada-con-advertencias">
                Con advertencias
              </option>
              <option value="sin-campana-ekon">Sin campaña Ekon</option>
              <option value="periodo-no-cubierto">Periodo no cubierto</option>
              <option value="circuito-no-compatible">
                Circuito no compatible
              </option>
              <option value="diferencia-tiendas">Diferencia de tiendas</option>
              <option value="centro-administrativo">
                Centro Administrativo
              </option>
              <option value="cambio-pendiente">Cambio pendiente</option>
            </select>
            <label
              style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}
            >
              <input
                type="checkbox"
                checked={onlyIssues}
                onChange={(e) => setOnlyIssues(e.target.checked)}
              />
              Solo con incidencias
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="card">
              <p className="text-muted" style={{ margin: 0 }}>
                No hay campañas con vínculo manual Ekon. Vincula una campaña en
                la sección Campañas para conciliarla aquí.
              </p>
            </div>
          ) : (
            <div className="card">
              <div className="diagnosis__table-wrap">
                <table className="catalog__table">
                  <thead>
                    <tr>
                      <th>Campaña</th>
                      <th>Ekon</th>
                      <th>Estado</th>
                      <th>Ratio</th>
                      <th>Cobertura</th>
                      <th>Tiendas</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => (
                      <tr key={row.campaign.id}>
                        <td>{row.campaign.name}</td>
                        <td>{row.ekonNumber}</td>
                        <td>
                          <span
                            className={`badge ${statusTone(row.result.status)}`}
                          >
                            {reconciliationStatusLabel(row.result.status)}
                          </span>
                        </td>
                        <td>
                          {row.result.ratio
                            ? row.result.ratio.toUpperCase()
                            : '—'}
                        </td>
                        <td>{coverageLabel(row.result.coverage)}</td>
                        <td>
                          {row.result.administrativeScope
                            ? 'No aplica'
                            : `${row.result.stores.common.length} ✓ / ${row.result.stores.ekonOnly.length + row.result.stores.liverpoolOnly.length} Δ`}
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setDetail(row)}
                          >
                            Ver
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {detail && (
            <DetailPanel row={detail} onClose={() => setDetail(null)} />
          )}
        </>
      )}
    </>
  );
}

function statusTone(status: ReconciliationStatus): string {
  if (status === 'conciliada' || status === 'centro-administrativo')
    return 'badge-success';
  if (
    status === 'conciliada-con-advertencias' ||
    status === 'diferencia-tiendas'
  )
    return 'badge-warning';
  return 'badge-danger';
}

function coverageLabel(coverage: string): string {
  switch (coverage) {
    case 'covered':
      return 'Cubierto';
    case 'partial':
      return 'Parcial';
    case 'uncovered':
      return 'Fuera';
    default:
      return '—';
  }
}

function DetailPanel({
  row,
  onClose,
}: {
  row: ReconciliationRow;
  onClose: () => void;
}) {
  const r = row.result;
  return (
    <div className="card" style={{ marginTop: '1.25rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h2 style={{ margin: 0 }}>{row.campaign.name}</h2>
        <button className="btn btn-secondary" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <p className="import__note">
        <strong>Número Ekon:</strong> {row.ekonNumber} ·{' '}
        <strong>Estado:</strong> {reconciliationStatusLabel(r.status)} ·{' '}
        <Link to="/campanas">Ir a la campaña</Link>
      </p>

      {r.administrativeScope && (
        <p className="badge badge-info">
          Alcance administrativo: Centro Administrativo · Conciliación de
          tiendas: No aplica
        </p>
      )}

      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <tbody>
            <tr>
              <th>Fechas Liverpool</th>
              <td>
                {formatCivilString(row.campaign.fechaInicio)} –{' '}
                {formatCivilString(row.campaign.fechaFin)}
              </td>
            </tr>
            <tr>
              <th>Cobertura Ekon</th>
              <td>{coverageLabel(r.coverage)}</td>
            </tr>
            <tr>
              <th>Ratio / testigos</th>
              <td>
                {r.ratio ? r.ratio.toUpperCase() : '—'} ·{' '}
                {r.requiresTestigos ? 'Requiere testigos' : 'Sin testigos'}
              </td>
            </tr>
            <tr>
              <th>Productos</th>
              <td>{r.productos.join(' · ') || '—'}</td>
            </tr>
            <tr>
              <th>Circuitos</th>
              <td>
                {r.circuitMatches
                  .map(
                    (c) =>
                      `${c.circuito}${c.compatible ? ` ✓ (${c.supports.join(', ')})` : ' ✗'}`,
                  )
                  .join(' · ') || '—'}
              </td>
            </tr>
            {r.stores.applies && (
              <tr>
                <th>Tiendas</th>
                <td>
                  Comunes: {r.stores.common.join(', ') || '—'}
                  <br />
                  Solo Ekon: {r.stores.ekonOnly.join(', ') || '—'}
                  <br />
                  Solo Liverpool: {r.stores.liverpoolOnly.join(', ') || '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {r.issues.length > 0 && (
        <ul className="text-muted">
          {r.issues.map((issue, i) => (
            <li key={i}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
