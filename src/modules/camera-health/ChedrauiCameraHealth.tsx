import { useCallback, useEffect, useState } from 'react';
import { FilterBar, FilterSearch, FilterSelect } from '@/components/filters';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { PageHeader } from '@/components/PageHeader';
import {
  createChedrauiCameraHealthTicket,
  getChedrauiCameraHealth,
  type ChedrauiHealthOverview,
} from '@/services/quividi';
import { CameraHealthTable } from './CameraHealthTable';
import {
  cameraHealthStatusTone,
  formatHealthDate,
  normalizeCameraHealthSearch,
} from './cameraHealthView';

const SUPPORT = 'MUPI DIGITAL';
const STATUS_LABELS = {
  normal: 'Normal',
  no_measurement: 'Sin medición',
  partial_measurement: 'Medición parcial',
  no_ots: 'Sin OTS',
  unavailable: 'Medición no disponible',
  out_of_scope: 'Fuera de alcance',
};
const STATUS_ORDER = [
  'no_measurement',
  'partial_measurement',
  'no_ots',
  'unavailable',
  'out_of_scope',
  'normal',
];
const NUMBER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

function incidentStart(
  history: ChedrauiHealthOverview['history'],
  snapshotIndex: number,
  locationId: number,
  latestDate: string,
) {
  const dayMs = 86_400_000;
  let previous = Date.parse(latestDate) + dayMs;
  let from = latestDate;
  let days = 0;
  for (const snapshot of history.slice(snapshotIndex)) {
    const status = snapshot.measurement?.[locationId]?.status;
    const date = snapshot.measurementDate;
    if (
      !date ||
      !status ||
      status === 'normal' ||
      Date.parse(date) !== previous - dayMs
    )
      break;
    from = date;
    previous = Date.parse(date);
    days++;
  }
  return { from, days };
}

function ticketUrl(ticketId: number, teamId: number | null) {
  const base = 'https://in-storemedia.odoo.com';
  return teamId
    ? `${base}/odoo/helpdesk/${teamId}/tickets/${ticketId}`
    : `${base}/web#id=${ticketId}&model=helpdesk.ticket&view_type=form`;
}

export function ChedrauiCameraHealth() {
  const [overview, setOverview] = useState<ChedrauiHealthOverview | null>(null);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<number | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    setError('');
    setRefreshing(true);
    try {
      setOverview(await getChedrauiCameraHealth(refresh));
      if (refresh) setDate('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo consultar la red de Chedraui.',
      );
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function createTicket(locationId: number) {
    setCreating(locationId);
    setError('');
    try {
      const { ticketId } = await createChedrauiCameraHealthTicket(locationId);
      setOverview(
        (current) =>
          current && {
            ...current,
            tickets: {
              ...current.tickets,
              [locationId]: {
                recoveredTicketId: null,
                teamId: null,
                lastSeen: null,
                observedAt: 0,
                ...current.tickets?.[locationId],
                ticketId,
                creating: false,
              },
            },
          },
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo crear el ticket en Odoo.',
      );
    } finally {
      setCreating(null);
    }
  }

  const history = overview?.history ?? [];
  const snapshotIndex = Math.max(
    0,
    history.findIndex((item) => item.date === date),
  );
  const snapshot = history[snapshotIndex];
  const latest = snapshotIndex === 0;
  const query = normalizeCameraHealthSearch(search);
  const locations = snapshot?.cameras.map(({ locationId }) => locationId) ?? [];
  const rows =
    snapshot?.cameras
      .map((camera) => {
        const monitored =
          camera.inNetwork &&
          locations.indexOf(camera.locationId) ===
            locations.lastIndexOf(camera.locationId);
        const measurement = monitored
          ? snapshot.measurement?.[camera.locationId]
          : undefined;
        const status = !monitored
          ? 'out_of_scope'
          : (measurement?.status ?? 'unavailable');
        const label = STATUS_LABELS[status];
        return { camera, measurement, status, label };
      })
      .filter(
        ({ camera, status, label }) =>
          (filter === 'all' || status === filter) &&
          normalizeCameraHealthSearch(
            [
              camera.storeKey,
              camera.player,
              camera.boxId,
              camera.locationName,
              camera.locationId,
              SUPPORT,
              label,
            ].join(' '),
          ).includes(query),
      )
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
      ) ?? [];

  return (
    <div className="camera-health">
      <PageHeader
        title="Salud de cámaras · Chedraui OUT"
        description="Medición del último día completo y comunicación de las cámaras vinculadas a Quividi en la red 3365."
        actions={
          <div className="camera-health__actions">
            <button
              className="btn btn-secondary"
              disabled={refreshing || creating !== null}
              onClick={() => void load()}
            >
              Actualizar vista
            </button>
            {overview?.canRefresh && (
              <button
                className="btn btn-primary"
                disabled={refreshing || creating !== null}
                onClick={() => void load(true)}
              >
                {refreshing ? 'Actualizando…' : 'Actualizar desde Quividi'}
              </button>
            )}
          </div>
        }
      />
      {(error || overview?.measurementWarning) && (
        <div className="camera-health__error" role="alert">
          {error || overview?.measurementWarning}
        </div>
      )}
      {loading && (
        <LoadingOverlay variant="process" title="Cargando salud de cámaras…" />
      )}
      {snapshot && (
        <>
          <FilterBar
            label="Filtros de salud de cámaras"
            onClear={() => {
              setDate('');
              setSearch('');
              setFilter('all');
            }}
          >
            <FilterSelect label="Lectura" value={date} onChange={setDate}>
              <option value="">Última lectura</option>
              {history.slice(1).map((item) => (
                <option key={item.date} value={item.date}>
                  {formatHealthDate(item.measurementDate ?? item.date)}
                </option>
              ))}
            </FilterSelect>
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
              onChange={setFilter}
            >
              <option value="all">Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
          <CameraHealthTable>
            {rows.map(({ camera, measurement, status, label }) => {
              const ticket = latest
                ? overview?.tickets?.[camera.locationId]
                : undefined;
              const id = ticket?.ticketId ?? ticket?.recoveredTicketId ?? null;
              const from =
                measurement && status !== 'normal' && snapshot.measurementDate
                  ? incidentStart(
                      history,
                      snapshotIndex,
                      camera.locationId,
                      snapshot.measurementDate,
                    )
                  : null;
              const canCreate =
                latest &&
                overview?.canCreateTicket &&
                measurement &&
                snapshot.measurementDate === overview.currentMeasurementDate &&
                status !== 'normal' &&
                !ticket?.ticketId &&
                !ticket?.creating;
              const lastSeen =
                ticket && ticket.observedAt > snapshot.observedAt
                  ? (ticket.lastSeen ?? camera.lastSeen)
                  : camera.lastSeen;
              const tone = measurement
                ? cameraHealthStatusTone({
                    monitored: true,
                    currentStatus: measurement.status,
                  })
                : 'muted';
              const reference = `${camera.boxId} · Cámara ${camera.camera}`;
              return (
                <tr key={reference}>
                  <td>
                    <strong>{camera.storeKey || '—'}</strong>
                    <span>{camera.player}</span>
                  </td>
                  <td>{SUPPORT}</td>
                  <td>
                    <strong>ID {camera.locationId}</strong>
                    <span title={camera.locationName ?? reference}>
                      {camera.locationName ?? reference}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        'camera-health__status camera-health__status--' + tone
                      }
                    >
                      {label}
                    </span>
                    {from && <small>{from.days} día(s)</small>}
                    <small>
                      {camera.inNetwork
                        ? lastSeen
                          ? 'Última señal: ' + lastSeen.replace('T', ' ')
                          : 'Sin señal registrada'
                        : 'Location ID fuera de la red'}
                    </small>
                  </td>
                  <td>{formatHealthDate(from?.from ?? null)}</td>
                  <td>
                    {measurement ? (
                      <>
                        <strong>
                          {measurement.coreMeasuredHours}/
                          {measurement.expectedCoreHours} h
                        </strong>
                        <span>{measurement.coreOtsHours} h con OTS</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {measurement ? NUMBER.format(measurement.coreOts) : '—'}
                  </td>
                  <td>
                    {formatHealthDate(
                      measurement ? (snapshot.measurementDate ?? null) : null,
                    )}
                  </td>
                  <td>
                    <strong>
                      {id && ticket ? (
                        <a
                          href={ticketUrl(id, ticket.teamId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Abrir ticket en Odoo"
                        >
                          {ticket.ticketId
                            ? 'Ticket #' + id
                            : 'Recuperado · #' + id}
                        </a>
                      ) : !latest ? (
                        '—'
                      ) : ticket?.creating ? (
                        'Sincronizando ticket…'
                      ) : canCreate ? (
                        'Pendiente de decisión'
                      ) : (
                        'Sin ticket'
                      )}
                    </strong>
                    <span title={reference}>{reference}</span>
                    {canCreate && (
                      <button
                        className="btn btn-primary"
                        disabled={creating !== null || refreshing}
                        onClick={() => void createTicket(camera.locationId)}
                      >
                        {creating === camera.locationId
                          ? 'Enviando…'
                          : 'Crear ticket'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </CameraHealthTable>
          {rows.length === 0 && (
            <div className="camera-health__empty">
              No hay cámaras que coincidan con los filtros.
            </div>
          )}
        </>
      )}
      {!loading && !snapshot && !error && (
        <div className="card">
          El historial empieza con la primera lectura de Quividi.
        </div>
      )}
    </div>
  );
}
