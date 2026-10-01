import { OdooAnalyticsPanels } from './OdooAnalyticsPanels';
import { downloadOdooWorkbook } from './odooIncidentExport';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import {
  mexicoMonth,
  summarizeIncidents,
  type OdooOverview,
} from '@/domain/odooIncidents';
import { getOdooOverview } from '@/services/odooIncidents';
import './OdooIncidentsPage.css';

const CATEGORIES = [
  'Soporte',
  'Contenido',
  'Cámaras',
  'General',
  'Sin clasificar',
];
const MODALITIES = ['Remoto', 'In situ', 'Mixta', 'Sin dato'];
const RETAILERS = ['Liverpool', 'Chedraui', 'La Comer', 'Farmacias San Pablo'];
const localDate = (value: string) =>
  new Date(value.replace(' ', 'T') + 'Z').toLocaleString('es-MX', {
    timeZone: 'America/Mexico_City',
  });
const hours = (value: number | null) =>
  value === null ? 'Sin dato' : `${value.toFixed(1)} h`;
function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
export function OdooIncidentsPage() {
  const [month, setMonth] = useState(mexicoMonth);
  const [data, setData] = useState<OdooOverview | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [retailer, setRetailer] = useState('');
  const [store, setStore] = useState('');
  const [category, setCategory] = useState('');
  const [modality, setModality] = useState('');
  const [requester, setRequester] = useState('');
  const [assignee, setAssignee] = useState('');
  const [sla, setSla] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setData(null);
    if (!month) {
      setLoading(false);
      return;
    }
    getOdooOverview(month)
      .then((result) => {
        if (active) setData(result);
      })
      .catch(() => {
        if (active)
          setError(
            'No se pudo consultar Odoo. Revisa la conexión y los permisos o vuelve a intentar.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [month, refresh]);
  useEffect(() => {
    setPage(1);
  }, [month, retailer, store, category, modality, requester, assignee, sla]);
  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const visible = useMemo(
    () =>
      tickets.filter(
        (ticket) =>
          (!retailer || ticket.retailer === retailer) &&
          (!store || (ticket.store ?? 'Sin tienda identificada') === store) &&
          (!category || ticket.category === category) &&
          (!modality || ticket.modality === modality) &&
          (!requester || ticket.requester === requester) &&
          (!assignee || ticket.assignee === assignee) &&
          (!sla || ticket.sla === sla),
      ),
    [tickets, retailer, store, category, modality, requester, assignee, sla],
  );
  const summary = summarizeIncidents(visible);
  const options = (field: 'store' | 'requester' | 'assignee') =>
    [
      ...new Set(
        tickets
          .filter((ticket) => !retailer || ticket.retailer === retailer)
          .map((ticket) => ticket[field] ?? 'Sin tienda identificada'),
      ),
    ].sort();
  const pages = Math.max(1, Math.ceil(visible.length / 25));
  const current = Math.min(page, pages);
  return (
    <div className="odoo-analysis">
      <PageHeader
        title="Análisis de incidencias Odoo · Digital Signage"
        description="Cumplimiento y atención por retailer, tienda y tipo de incidencia."
        actions={
          <div className="odoo-actions">
            <button
              className="btn btn-secondary"
              disabled={!data || loading || exporting}
              onClick={async () => {
                if (!data) return;
                setExporting(true);
                setExportError('');
                try {
                  await downloadOdooWorkbook(visible, month, data.fetchedAt, {
                    Retailer: retailer,
                    Tienda: store,
                    Categoría: category,
                    Atención: modality,
                    Solicitante: requester,
                    Responsable: assignee,
                    SLA: sla,
                  });
                } catch {
                  setExportError(
                    'No se pudo generar el Excel. Vuelve a intentar.',
                  );
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? 'Generando informe…' : 'Descargar informe Excel'}
            </button>
            <button
              className="btn btn-primary"
              disabled={loading || !month}
              onClick={() => setRefresh((value) => value + 1)}
            >
              Actualizar
            </button>
          </div>
        }
      />
      <section className="odoo-filters" aria-label="Filtros de incidencias">
        <label>
          Mes de creación
          <input
            aria-label="Mes de creación"
            type="month"
            min="2000-01"
            max="2099-12"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setStore('');
              setRequester('');
              setAssignee('');
            }}
          />
        </label>
        <Filter
          label="Retailer"
          value={retailer}
          options={RETAILERS}
          onChange={(value) => {
            setRetailer(value);
            setStore('');
            setRequester('');
            setAssignee('');
          }}
        />
        <Filter
          label="Tienda"
          value={store}
          options={options('store')}
          onChange={setStore}
        />
        <Filter
          label="Categoría"
          value={category}
          options={CATEGORIES}
          onChange={setCategory}
        />
        <Filter
          label="Atención"
          value={modality}
          options={MODALITIES}
          onChange={setModality}
        />
        <Filter
          label="Solicitante"
          value={requester}
          options={options('requester')}
          onChange={setRequester}
        />
        <Filter
          label="Responsable"
          value={assignee}
          options={options('assignee')}
          onChange={setAssignee}
        />
        <Filter
          label="SLA"
          value={sla}
          options={[
            'Cumplido',
            'Incumplido',
            'En curso',
            'Sin dato',
            'No aplica',
          ]}
          onChange={setSla}
        />
      </section>
      {loading && (
        <p role="status">Consultando tickets y resultados de SLA en Odoo…</p>
      )}
      {error && <p role="alert">{error}</p>}
      {exportError && <p role="alert">{exportError}</p>}
      {data && (
        <>
          <p className="text-muted">
            Actualizado:{' '}
            {new Date(data.fetchedAt).toLocaleString('es-MX', {
              timeZone: 'America/Mexico_City',
            })}
            . Tickets creados en el mes seleccionado (hora de Ciudad de México).
          </p>
          {data.warnings.map((warning) => (
            <p role="alert" key={warning}>
              {warning}
            </p>
          ))}
          {data.missingFields.length > 0 && (
            <p className="text-muted">
              Algunas métricas no están disponibles en esta instalación y se
              muestran como «Sin dato».
            </p>
          )}
          <section
            className="odoo-kpis"
            aria-label="Indicadores de incidencias"
          >
            {[
              [
                'Tickets',
                String(summary.total),
                `${summary.open} abiertos · ${summary.closed} resueltos`,
              ],
              [
                'Cumplimiento SLA',
                summary.compliance === null
                  ? 'Sin dato'
                  : `${summary.compliance.toFixed(1)}%`,
                `${summary.evaluated} tickets con resultado · ${summary.failed} incumplidos`,
              ],
              [
                'Primera respuesta',
                hours(summary.firstResponse.value),
                `${summary.firstResponse.count} tickets con dato`,
              ],
              [
                'Resolución',
                hours(summary.resolution.value),
                `${summary.resolution.count} resueltos con dato`,
              ],
            ].map(([label, value, detail]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </section>
          <p className="text-muted">
            SLA según las políticas y resultados registrados en Odoo; las horas
            son las reportadas por Odoo. Cancelados, SLA en curso y valores sin
            dato no entran al porcentaje. No se recalculan calendarios ni
            pausas.
          </p>
          <OdooAnalyticsPanels
            tickets={visible}
            month={month}
            reference={data.fetchedAt}
          />
          <section className="odoo-split">
            <article className="odoo-panel">
              <h2>Tickets por categoría</h2>
              {CATEGORIES.map((value) => {
                const group = visible.filter(
                  (ticket) => ticket.category === value,
                );
                const stats = summarizeIncidents(group);
                return (
                  <div className="odoo-breakdown" key={value}>
                    <span>{value}</span>
                    <strong>{group.length}</strong>
                    <span>{stats.failed} SLA incumplidos</span>
                  </div>
                );
              })}
            </article>
            <article className="odoo-panel">
              <h2>Tiendas con más incidencias técnicas</h2>
              <p className="text-muted">
                Soporte y cámaras con tienda identificada. General y contenido
                quedan fuera del ranking de fallas.
              </p>
              {summary.stores.length ? (
                summary.stores.slice(0, 10).map((value) => (
                  <div
                    className="odoo-breakdown"
                    key={`${value.retailer}:${value.store}`}
                  >
                    <span>
                      {value.retailer} · {value.store}
                    </span>
                    <strong>{value.tickets}</strong>
                    <span>{value.failed} SLA incumplidos</span>
                  </div>
                ))
              ) : (
                <p>
                  No hay incidencias técnicas con tienda identificada para estos
                  filtros.
                </p>
              )}
            </article>
          </section>
          <section className="odoo-panel">
            <h2>Detalle de tickets</h2>
            <p>
              {visible.length} tickets · Página {current} de {pages}
            </p>
            <div className="odoo-table">
              <table>
                <thead>
                  <tr>
                    {[
                      'Ticket',
                      'Retailer / tienda',
                      'Categoría / atención',
                      'Solicitante / responsable',
                      'Estado',
                      'SLA',
                      'Respuesta',
                      'Resolución',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible
                    .slice((current - 1) * 25, current * 25)
                    .map((ticket) => (
                      <tr key={ticket.id}>
                        <td>
                          <a href={ticket.url} target="_blank" rel="noreferrer">
                            #{ticket.id} · {ticket.title}
                          </a>
                          {ticket.createdAt && (
                            <small>Creado: {localDate(ticket.createdAt)}</small>
                          )}
                        </td>
                        <td>
                          {ticket.retailer}
                          <small>
                            {ticket.store ?? 'Sin tienda identificada'}
                          </small>
                        </td>
                        <td>
                          {ticket.category}
                          <small>{ticket.modality}</small>
                          <details>
                            <summary>Etiquetas</summary>
                            {ticket.tags.join(' · ') || 'Sin etiquetas'}
                          </details>
                        </td>
                        <td>
                          {ticket.requester}
                          <small>{ticket.assignee}</small>
                        </td>
                        <td>{ticket.stage}</td>
                        <td>
                          <span
                            className={
                              ticket.sla === 'Incumplido' ? 'odoo-failed' : ''
                            }
                          >
                            {ticket.sla}
                          </span>
                          <details>
                            <summary>Políticas</summary>
                            {ticket.policies.length
                              ? ticket.policies.map((policy, index) => (
                                  <p key={index}>
                                    {policy.name || 'Política SLA'}:{' '}
                                    {policy.status === 'failed'
                                      ? 'Incumplido'
                                      : policy.status === 'reached'
                                        ? 'Cumplido'
                                        : policy.status === 'ongoing'
                                          ? 'En curso'
                                          : 'Sin dato'}
                                    {policy.deadline && (
                                      <small>
                                        Límite: {localDate(policy.deadline)}
                                      </small>
                                    )}
                                  </p>
                                ))
                              : 'Sin políticas disponibles'}
                          </details>
                        </td>
                        <td>{hours(ticket.firstResponseHours)}</td>
                        <td>{hours(ticket.resolutionHours)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!visible.length && <p>No hay tickets para estos filtros.</p>}
            <div className="odoo-pagination">
              <button
                className="btn"
                disabled={current <= 1}
                onClick={() => setPage(current - 1)}
              >
                Anterior
              </button>
              <button
                className="btn"
                disabled={current >= pages}
                onClick={() => setPage(current + 1)}
              >
                Siguiente
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
