import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from '@/components/filters';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import type {
  QuividiCameraHealthOverview,
  QuividiCameraHealthRefreshStage,
} from '@/domain';
import {
  createQuividiCameraHealthTicket,
  getQuividiCameraHealthOverview,
  refreshQuividiCameraHealth,
} from '@/services/quividi';
import {
  cameraHealthStatusLabel,
  cameraHealthStatusTone,
  filterCameraHealthRows,
  formatHealthDate,
  type CameraHealthFilter,
} from './cameraHealthView';
import './CameraHealthPage.css';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-MX').format(Math.round(value));
}

function formatDateTime(value: number | null): string {
  if (!value) return 'Aún no registrada';
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'muted';
}) {
  return (
    <article className={'camera-health__metric camera-health__metric--' + tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

/** Etiquetas del filtro de estado (select y chip). */
const HEALTH_FILTER_LABELS: Record<
  Exclude<CameraHealthFilter, 'all'>,
  string
> = {
  alerts: 'Solo alertas activas',
  normal: 'Normal',
  no_measurement: 'Sin medición',
  partial_measurement: 'Medición parcial',
  no_ots: 'Sin OTS',
  out_of_scope: 'Fuera de alcance',
};

const REFRESH_STEPS: Array<{
  stage: Exclude<QuividiCameraHealthRefreshStage, 'completed' | 'error'>;
  label: string;
}> = [
  { stage: 'connecting', label: 'Conectando con Quividi' },
  { stage: 'syncing_catalog', label: 'Sincronizando catálogo' },
  { stage: 'analyzing', label: 'Analizando OTS y medición' },
  { stage: 'reconciling_alerts', label: 'Actualizando incidencias' },
  { stage: 'syncing_odoo', label: 'Sincronizando tickets Odoo' },
];

function refreshStepState(
  currentStage: QuividiCameraHealthRefreshStage | null,
  stepIndex: number,
): 'done' | 'active' | 'pending' {
  if (currentStage === 'completed') return 'done';
  const currentIndex = REFRESH_STEPS.findIndex(
    (step) => step.stage === currentStage,
  );
  if (currentIndex < 0) return stepIndex === 0 ? 'active' : 'pending';
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

export function CameraHealthPage() {
  const [overview, setOverview] = useState<QuividiCameraHealthOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CameraHealthFilter>('all');
  const [creatingTicketFor, setCreatingTicketFor] = useState<number | null>(
    null,
  );
  const [ticketError, setTicketError] = useState<string | null>(null);

  const filterChips = compactChips([
    search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(search),
      onRemove: () => setSearch(''),
    },
    filter !== 'all' && {
      key: 'filter',
      label: 'Estado',
      value: HEALTH_FILTER_LABELS[filter],
      onRemove: () => setFilter('all'),
    },
  ]);

  const reload = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      setOverview(await getQuividiCameraHealthOverview());
    } catch {
      setError(
        'No se pudo cargar la salud de cámaras. Verifica el despliegue de las funciones Quividi.',
      );
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const refreshRunning =
    refreshing || overview?.refresh.status === 'running';

  useEffect(() => {
    if (!refreshRunning) return;
    const timer = window.setInterval(() => {
      void reload(false);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [refreshRunning, reload]);

  useEffect(() => {
    const cooldownUntil = overview?.refresh.cooldownUntil ?? 0;
    if (cooldownUntil <= Date.now()) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [overview?.refresh.cooldownUntil]);

  const cooldownMs = Math.max(
    0,
    (overview?.refresh.cooldownUntil ?? 0) - clock,
  );
  const cooldownMinutes =
    cooldownMs > 0 ? Math.max(1, Math.ceil(cooldownMs / 60_000)) : 0;

  const forceRefresh = useCallback(async () => {
    setRefreshing(true);
    setRefreshError(null);
    setClock(Date.now());
    try {
      await refreshQuividiCameraHealth();
      await reload(false);
    } catch (reason) {
      setRefreshError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo actualizar la salud de cámaras desde Quividi.',
      );
      await reload(false);
    } finally {
      setRefreshing(false);
      setClock(Date.now());
    }
  }, [reload]);

  const createTicket = useCallback(
    async (locationId: number) => {
      setCreatingTicketFor(locationId);
      setTicketError(null);
      try {
        await createQuividiCameraHealthTicket(locationId);
        await reload(false);
      } catch (reason) {
        setTicketError(
          reason instanceof Error
            ? reason.message
            : 'No se pudo crear el ticket en Odoo.',
        );
      } finally {
        setCreatingTicketFor(null);
      }
    },
    [reload],
  );

  function ticketLabel(
    camera: QuividiCameraHealthOverview['cameras'][number],
  ): string {
    switch (camera.ticketStatus) {
      case 'created':
        return camera.ticketId ? 'Ticket #' + camera.ticketId : 'Ticket creado';
      case 'recovery_notified':
        return camera.ticketId
          ? 'Recuperado · #' + camera.ticketId
          : 'Recuperación notificada';
      case 'creating':
        return 'Creando ticket…';
      case 'error':
        return 'Error de ticket';
      case 'auto_pending':
        return 'Envío automático';
      case 'pending_decision':
        return 'Pendiente de decisión';
      case 'not_needed':
        return 'Sin ticket';
      default:
        return 'Punto sin configurar';
    }
  }

  const rows = useMemo(
    () =>
      overview ? filterCameraHealthRows(overview.cameras, search, filter) : [],
    [overview, search, filter],
  );

  const activeRefreshStage =
    overview?.refresh.status === 'running'
      ? overview.refresh.stage
      : refreshing
        ? 'connecting'
        : null;

  const refreshFailure =
    refreshError ??
    (overview?.refresh.status === 'error' ? overview.refresh.lastError : null);

  return (
    <div className="camera-health">
      <PageHeader
        title="Salud de cámaras"
        description="Estado operativo Quividi por cámara a partir del último día completo. El histórico se usa para continuidad y recuperación, no para generar alertas retroactivas."
        actions={
          <div className="camera-health__actions">
            <button
              className="btn btn-secondary"
              onClick={() => void reload(false)}
              disabled={loading || refreshRunning}
            >
              Actualizar vista
            </button>
            {overview?.refresh.canRefresh && (
              <button
                className="btn btn-primary"
                onClick={() => void forceRefresh()}
                disabled={refreshRunning || cooldownMs > 0}
              >
                {refreshRunning
                  ? 'Consultando Quividi…'
                  : cooldownMs > 0
                    ? 'Disponible en ' + cooldownMinutes + ' min'
                    : 'Actualizar desde Quividi'}
              </button>
            )}
          </div>
        }
      />

      {error && (
        <div className="camera-health__error" role="alert">
          {error}
        </div>
      )}
      {refreshFailure && (
        <div className="camera-health__error" role="alert">
          {refreshFailure}
        </div>
      )}
      {ticketError && (
        <div className="camera-health__error" role="alert">
          {ticketError}
        </div>
      )}

      {refreshRunning && (
        <section
          className="camera-health__refresh-progress"
          aria-live="polite"
          aria-label="Progreso de actualización desde Quividi"
        >
          <div className="camera-health__refresh-heading">
            <div>
              <span>Actualización en curso</span>
              <strong>Actualizando salud de cámaras…</strong>
            </div>
            <small>
              {overview?.refresh.startedByEmail
                ? 'Iniciada por ' + overview.refresh.startedByEmail
                : 'Iniciando consulta…'}
            </small>
          </div>
          <div className="camera-health__refresh-steps">
            {REFRESH_STEPS.map((step, index) => {
              const state = refreshStepState(activeRefreshStage, index);
              return (
                <div
                  key={step.stage}
                  className={
                    'camera-health__refresh-step camera-health__refresh-step--' +
                    state
                  }
                >
                  <span aria-hidden="true">
                    {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                  </span>
                  <strong>{step.label}</strong>
                </div>
              );
            })}
          </div>
          <p>
            Se vuelve a procesar el último día completo disponible. No se usa el
            día parcial en curso para generar alertas ni tickets.
          </p>
        </section>
      )}

      {loading && !overview ? (
        <LoadingOverlay
          variant="process"
          title="Cargando salud de cámaras…"
          description="Leyendo el último estado calculado por SIGNAM."
        />
      ) : overview ? (
        <>
          <div className="camera-health__meta">
            <span>
              Último día evaluado:{' '}
              <strong>{formatHealthDate(overview.latestDate)}</strong>
            </span>
            <span>
              Última automática:{' '}
              <strong>
                {formatDateTime(overview.refresh.lastAutomaticCompletedAt)}
              </strong>
            </span>
            <span>
              Última manual:{' '}
              <strong>
                {formatDateTime(overview.refresh.lastManualCompletedAt)}
              </strong>
              {overview.refresh.lastManualCompletedByEmail
                ? ' · ' + overview.refresh.lastManualCompletedByEmail
                : ''}
            </span>
          </div>

          <section
            className="camera-health__metrics"
            aria-label="Resumen de salud de cámaras"
          >
            <MetricCard
              label="Monitoreadas"
              value={overview.summary.monitored}
              detail="cámaras en alcance actual"
            />
            <MetricCard
              label="Normales"
              value={overview.summary.normal}
              detail="sin incidencia activa"
              tone="success"
            />
            <MetricCard
              label="Alertas activas"
              value={overview.summary.activeAlerts}
              detail="requieren revisión operativa"
              tone={overview.summary.activeAlerts > 0 ? 'warning' : 'success'}
            />
            <MetricCard
              label="Fuera de alcance"
              value={overview.summary.outOfScope}
              detail="ya no se monitorean"
              tone="muted"
            />
          </section>

          <FilterBar
            label="Filtros de salud de cámaras"
            chips={filterChips}
            onClear={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            <FilterSearch
              label="Buscar"
              placeholder="Buscar tienda, soporte, cámara o Location ID…"
              value={search}
              onChange={setSearch}
            />
            <FilterSelect
              label="Estado"
              value={filter}
              active={filter !== 'all'}
              onChange={(v) => setFilter(v as CameraHealthFilter)}
            >
              <option value="all">Todos los estados</option>
              {Object.entries(HEALTH_FILTER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>

          <div className="camera-health__table-wrap">
            <table className="camera-health__table">
              <thead>
                <tr>
                  <th>Tienda</th>
                  <th>Soporte</th>
                  <th>Cámara</th>
                  <th>Estado</th>
                  <th>Desde</th>
                  <th>Cobertura 11–22</th>
                  <th>OTS</th>
                  <th>Último día</th>
                  <th>Ticket Odoo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((camera) => {
                  const tone = cameraHealthStatusTone(camera);
                  return (
                    <tr key={camera.locationId}>
                      <td>
                        <strong>{camera.storeNumber || '—'}</strong>
                        <span>{camera.storeName || '—'}</span>
                      </td>
                      <td>{camera.support || '—'}</td>
                      <td>
                        <strong>ID {camera.locationId}</strong>
                        <span title={camera.locationName}>
                          {camera.locationName || '—'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            'camera-health__status camera-health__status--' +
                            tone
                          }
                        >
                          {cameraHealthStatusLabel(camera)}
                        </span>
                        {camera.consecutiveDays > 0 && camera.monitored && (
                          <small>{camera.consecutiveDays} día(s)</small>
                        )}
                      </td>
                      <td>{formatHealthDate(camera.startedDate)}</td>
                      <td>
                        <strong>
                          {camera.coreMeasuredHours}/{camera.expectedCoreHours}{' '}
                          h
                        </strong>
                        <span>{camera.coreOtsHours} h con OTS</span>
                      </td>
                      <td>{formatNumber(camera.coreOts)}</td>
                      <td>{formatHealthDate(camera.latestDate)}</td>
                      <td>
                        <strong>{ticketLabel(camera)}</strong>
                        {camera.measurementPointId && (
                          <span title={camera.measurementPointId}>
                            {camera.measurementPointId}
                          </span>
                        )}
                        {camera.ticketError && (
                          <small>{camera.ticketError}</small>
                        )}
                        {camera.canCreateTicket &&
                          camera.ticketStatus === 'pending_decision' && (
                            <button
                              className="btn btn-primary"
                              disabled={
                                refreshRunning ||
                                creatingTicketFor === camera.locationId
                              }
                              onClick={() =>
                                void createTicket(camera.locationId)
                              }
                            >
                              {creatingTicketFor === camera.locationId
                                ? 'Enviando…'
                                : 'Crear ticket'}
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="camera-health__empty">
                No hay cámaras que coincidan con los filtros.
              </div>
            )}
          </div>

          <section className="camera-health__recoveries">
            <div className="camera-health__section-title">
              <div>
                <span>Histórico reciente</span>
                <h2>Recuperaciones</h2>
              </div>
              <p>
                Incidencias que ya no están activas. No generan tickets
                retroactivos.
              </p>
            </div>

            {overview.recentRecoveries.length === 0 ? (
              <div className="camera-health__empty">
                Todavía no hay recuperaciones registradas.
              </div>
            ) : (
              <div className="camera-health__recovery-grid">
                {overview.recentRecoveries.map((recovery) => (
                  <article key={recovery.alertId}>
                    <div>
                      <strong>
                        {recovery.storeNumber} · {recovery.storeName}
                      </strong>
                      <span>
                        ID {recovery.locationId} · {recovery.locationName}
                      </span>
                    </div>
                    <span>{recovery.support}</span>
                    <small>
                      Incidencia {formatHealthDate(recovery.startedDate)} –{' '}
                      {formatHealthDate(recovery.lastAnomalousDate)}
                    </small>
                    <strong className="camera-health__recovered">
                      Recuperada {formatHealthDate(recovery.recoveredDate)}
                    </strong>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
