import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { isFirebaseConfigured } from '@/services/firebase';
import { listCampaigns } from '@/services/campaigns';
import {
  listEkonLinks,
  ekonNumberForCampaign,
} from '@/services/campaignEkonLinks';
import { listReconciliationAssignmentsByEkonNumber } from '@/services/ekonAssignments';
import { hasCompletedBatch as hasCompletedBatchQuery } from '@/services/ekonImports';
import {
  reconciliationStatusLabel,
  type EkonAssignment,
  type ReconciliationStatus,
} from '@/domain/ekon';
import {
  buildReconciliationRows,
  filterReconciliationRows,
  hasReconciliationIncidents,
  reconciliationIncidentCount,
  summarizeReconciliation,
  type ReconciliationRow,
} from './reconciliationView';
import { ReconciliationDetailModal } from './ReconciliationDetailModal';
import './ReconciliationPage.css';

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
            byNumber.set(n, await listReconciliationAssignmentsByEkonNumber(n));
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
    () =>
      filterReconciliationRows(rows, { text, status, onlyIssues }).sort(
        (a, b) =>
          Number(hasReconciliationIncidents(b)) -
          Number(hasReconciliationIncidents(a)),
      ),
    [rows, text, status, onlyIssues],
  );
  const summary = useMemo(() => summarizeReconciliation(rows), [rows]);
  const issueRows = useMemo(
    () => filtered.filter(hasReconciliationIncidents),
    [filtered],
  );
  const detailIssueIndex = detail
    ? issueRows.findIndex((row) => row.campaign.id === detail.campaign.id)
    : -1;

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
                <dt>Bloqueadas</dt>
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
              <option value="periodo-parcial">Periodo parcial</option>
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
                            : storeSummary(row)}
                        </td>
                        <td>
                          <button
                            className="btn btn-secondary"
                            onClick={() => setDetail(row)}
                          >
                            {reconciliationIncidentCount(row) > 0
                              ? `Revisar ${reconciliationIncidentCount(row)} incidencia${reconciliationIncidentCount(row) === 1 ? '' : 's'}`
                              : 'Ver detalle'}
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
            <ReconciliationDetailModal
              row={detail}
              onClose={() => setDetail(null)}
              hasPrevious={detailIssueIndex > 0}
              hasNext={
                detailIssueIndex >= 0 && detailIssueIndex < issueRows.length - 1
              }
              onPrevious={() => {
                if (detailIssueIndex > 0)
                  setDetail(issueRows[detailIssueIndex - 1]!);
              }}
              onNext={() => {
                if (
                  detailIssueIndex >= 0 &&
                  detailIssueIndex < issueRows.length - 1
                )
                  setDetail(issueRows[detailIssueIndex + 1]!);
              }}
            />
          )}
        </>
      )}
    </>
  );
}

function statusTone(status: ReconciliationStatus): string {
  if (status === 'conciliada' || status === 'centro-administrativo')
    return 'badge-success';
  if (status === 'conciliada-con-advertencias') return 'badge-warning';
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

function storeSummary(row: ReconciliationRow): string {
  if (!row.result.ekonExists) return 'Sin datos Ekon';
  if (!row.result.stores.applies) return 'Sin tiendas conciliables';
  const details = row.result.stores.details;
  const count = (status: string) =>
    details.filter((store) => store.status === status).length;
  return [
    `${count('matched')} conciliadas`,
    `${count('liverpool-only')} solo Liverpool`,
    `${count('ekon-only')} solo Ekon`,
    `${count('support-mismatch')} incompatibles`,
  ].join(' · ');
}
