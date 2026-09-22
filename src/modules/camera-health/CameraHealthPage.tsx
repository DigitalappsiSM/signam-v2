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
import type { QuividiCameraHealthOverview } from '@/domain';
import { getQuividiCameraHealthOverview } from '@/services/quividi';
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

export function CameraHealthPage() {
  const [overview, setOverview] = useState<QuividiCameraHealthOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CameraHealthFilter>('all');

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

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getQuividiCameraHealthOverview());
    } catch {
      setError(
        'No se pudo cargar la salud de cámaras. Verifica el despliegue de las funciones Quividi.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows = useMemo(
    () =>
      overview ? filterCameraHealthRows(overview.cameras, search, filter) : [],
    [overview, search, filter],
  );

  return (
    <div className="camera-health">
      <PageHeader
        title="Salud de cámaras"
        description="Estado operativo Quividi por cámara a partir del último día completo. El histórico se usa para continuidad y recuperación, no para generar alertas retroactivas."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => void reload()}
            disabled={loading}
          >
            {loading ? 'Actualizando…' : 'Actualizar vista'}
          </button>
        }
      />

      {error && (
        <div className="camera-health__error" role="alert">
          {error}
        </div>
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
              La vista no vuelve a consultar Quividi; muestra el último cálculo
              automático disponible.
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
