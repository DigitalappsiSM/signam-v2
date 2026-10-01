import { OdooAnalyticsPanels } from './OdooAnalyticsPanels';
import { downloadOdooWorkbook } from './odooIncidentExport';
import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import {
  incidentSla,
  mexicoMonth,
  summarizeIncidents,
  type OdooOverview,
} from '@/domain/odooIncidents';
import { getOdooOverview, odooErrorMessage } from '@/services/odooIncidents';
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
  includeAll = true,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  includeAll?: boolean;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeAll && <option value="">Todos</option>}
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
  const [slaKind, setSlaKind] = useState('Resolución');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'overview' | 'performance' | 'tickets'>(
    'overview',
  );
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
      .catch((cause: unknown) => {
        if (active) setError(odooErrorMessage(cause));
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
  }, [
    month,
    retailer,
    store,
    category,
    modality,
    requester,
    assignee,
    sla,
    slaKind,
  ]);
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
          (!sla ||
            (slaKind === 'Global'
              ? ticket.sla
              : incidentSla(
                  ticket,
                  slaKind === 'Resolución' ? 'resolution' : 'response',
                )) === sla),
      ),
    [
      tickets,
      retailer,
      store,
      category,
      modality,
      requester,
      assignee,
      sla,
      slaKind,
    ],
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
      <header className="odoo-hero">
        <div>
          <span className="odoo-eyebrow">OPERACIÓN / DIGITAL SIGNAGE</span>
          <h1>
            Análisis de incidencias <span>Odoo</span>
          </h1>
          <p>El pulso de tu operación: atención, tiempos y cumplimiento SLA.</p>
          <div className="odoo-hero-meta">
            <span
              className={`odoo-connection ${error ? 'is-error' : data ? 'is-connected' : ''}`}
            >
              <Icon
                name={
                  error ? 'alert-triangle' : data ? 'check-circle' : 'clock'
                }
              />
              {loading
                ? 'Consultando Odoo'
                : error
                  ? 'Consulta no disponible'
                  : data
                    ? 'Datos de Odoo'
                    : 'Selecciona un mes'}
            </span>
            <span>4 retailers · Soporte · Contenido · Cámaras</span>
          </div>
        </div>
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
                  'Tipo de SLA': slaKind,
                  'Resultado SLA': sla,
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
      </header>
      <section
        className="odoo-filter-panel"
        aria-label="Filtros de incidencias"
      >
        <div className="odoo-section-heading">
          <div>
            <Icon name="filter" />
            <h2>Explora tu operación</h2>
          </div>
          <button
            className="odoo-reset"
            onClick={() => {
              setRetailer('');
              setStore('');
              setCategory('');
              setModality('');
              setRequester('');
              setAssignee('');
              setSla('');
              setSlaKind('Resolución');
            }}
          >
            Limpiar filtros
          </button>
        </div>
        <div className="odoo-filters">
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
            includeAll={false}
            label="Tipo de SLA"
            value={slaKind}
            options={['Resolución', 'Primera respuesta', 'Global']}
            onChange={setSlaKind}
          />
          <Filter
            label="Resultado SLA"
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
        </div>
      </section>
      {loading && (
        <div className="odoo-state odoo-loading" role="status">
          <span className="odoo-spinner" aria-hidden="true" />
          <div>
            <strong>Preparando el análisis</strong>
            <p>Consultando tickets y resultados de SLA en Odoo…</p>
          </div>
        </div>
      )}
      {error && (
        <section className="odoo-state odoo-error" role="alert">
          <div className="odoo-state-icon">
            <Icon name="alert-triangle" />
          </div>
          <div>
            <span className="odoo-eyebrow">CONEXIÓN CON ODOO</span>
            <h2>No pudimos cargar las incidencias</h2>
            <p>{error}</p>
            <small>
              Los indicadores estarán disponibles al completar la consulta.
            </small>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Reintentar conexión
          </button>
        </section>
      )}
      {!data && (
        <section
          className="odoo-kpis odoo-sla-kpis odoo-kpis-pending"
          aria-label="Indicadores pendientes"
        >
          {[
            'Tickets del periodo',
            'SLA de resolución',
            'SLA de primera respuesta',
            'SLA global',
            'Primera respuesta',
            'Tiempo de resolución',
          ].map((label) => (
            <article
              key={label}
              className={
                label === 'SLA de resolución' ? 'odoo-primary-sla' : undefined
              }
            >
              <span>{label}</span>
              <strong>—</strong>
              <small>
                {loading ? 'Consultando datos…' : 'Pendiente de consulta'}
              </small>
            </article>
          ))}
        </section>
      )}
      {exportError && <p role="alert">{exportError}</p>}
      {data && (
        <>
          <p className="odoo-updated">
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
            className="odoo-kpis odoo-sla-kpis"
            aria-label="Indicadores de incidencias"
          >
            {[
              [
                'Tickets',
                String(summary.total),
                `${summary.open} abiertos · ${summary.closed} resueltos`,
              ],
              ...(
                [
                  ['SLA de resolución', summary.resolutionSla],
                  ['SLA de primera respuesta', summary.responseSla],
                ] as const
              ).map(([label, stats]) => [
                label,
                stats.compliance === null
                  ? 'Sin dato'
                  : `${stats.compliance.toFixed(1)}%`,
                `${stats.passed} cumplidos / ${stats.evaluated} evaluados · ${stats.failed} incumplidos · ${stats.ongoing} en curso · ${stats.missing} sin dato`,
              ]),
              [
                'SLA global',
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
              <article
                key={label}
                className={
                  label === 'SLA de resolución' ? 'odoo-primary-sla' : undefined
                }
              >
                <div className="odoo-kpi-icon">
                  <Icon
                    name={
                      label === 'Tickets'
                        ? 'activity'
                        : label?.startsWith('SLA')
                          ? 'shield'
                          : 'clock'
                    }
                  />
                </div>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </article>
            ))}
          </section>
          <details className="odoo-method">
            <summary>Cómo se calculan estos indicadores</summary>
            <p>
              Resolución y primera respuesta se evalúan por separado según sus
              políticas de Odoo. Una respuesta tardía no penaliza la resolución.
              SLA global conserva todas las políticas. El porcentaje es
              cumplidos / (cumplidos + incumplidos) de cada tipo; las horas son
              las reportadas por Odoo. Cancelados, SLA en curso y valores sin
              dato no entran al porcentaje. No se recalculan calendarios ni
              pausas.
            </p>
          </details>
          <nav className="odoo-tabs" aria-label="Vistas del análisis">
            {(
              [
                ['overview', 'Resumen ejecutivo', 'dashboard'],
                ['performance', 'Tiempos y equipos', 'clock'],
                ['tickets', 'Detalle de tickets', 'activity'],
              ] as const
            ).map(([value, label, icon]) => (
              <button
                key={value}
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setTab(value)}
              >
                <Icon name={icon} />
                {label}
                {value === 'tickets' && <span>{visible.length}</span>}
              </button>
            ))}
          </nav>
          {tab !== 'tickets' && (
            <>
              <OdooAnalyticsPanels
                tickets={visible}
                month={month}
                reference={data.fetchedAt}
                view={tab}
              />
              {tab === 'overview' && (
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
                          <span>{stats.failed} SLA global incumplidos</span>
                        </div>
                      );
                    })}
                  </article>
                  <article className="odoo-panel">
                    <h2>Tiendas con más incidencias técnicas</h2>
                    <p className="text-muted">
                      Soporte y cámaras con tienda identificada. General y
                      contenido quedan fuera del ranking de fallas.
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
                          <span>{value.failed} SLA global incumplidos</span>
                        </div>
                      ))
                    ) : (
                      <p>
                        No hay incidencias técnicas con tienda identificada para
                        estos filtros.
                      </p>
                    )}
                  </article>
                </section>
              )}
            </>
          )}
          {tab === 'tickets' && (
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
                        'SLA de resolución',
                        'SLA de primera respuesta',
                        'SLA global',
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
                            <a
                              href={ticket.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              #{ticket.id} · {ticket.title}
                            </a>
                            {ticket.createdAt && (
                              <small>
                                Creado: {localDate(ticket.createdAt)}
                              </small>
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
                          {(['resolution', 'response'] as const).map((kind) => {
                            const state = incidentSla(ticket, kind);
                            return (
                              <td key={kind}>
                                <span
                                  className={`odoo-sla-badge ${state === 'Incumplido' ? 'is-failed' : state === 'Cumplido' ? 'is-passed' : ''}`}
                                >
                                  {state}
                                </span>
                              </td>
                            );
                          })}
                          <td>
                            <span
                              className={`odoo-sla-badge ${ticket.sla === 'Incumplido' ? 'is-failed' : ticket.sla === 'Cumplido' ? 'is-passed' : ''}`}
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
          )}
        </>
      )}
    </div>
  );
}
