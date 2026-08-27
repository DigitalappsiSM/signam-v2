import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { SortableTh } from '@/components/SortableTh';
import {
  digitalProgress,
  type DigitalCheckKey,
  type DigitalOperationalItem,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';
import { nextSortState, sortRows, type SortState } from '@/lib/tableSort';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import {
  appendDigitalComment,
  listDigitalTracking,
  setDigitalCheck,
  setDigitalLifecycle,
} from '@/services/digitalOperationalTracking';
import {
  digitalPeriodKey,
  digitalPeriodOptions,
  digitalProgressStatus,
  formatDigitalDate,
  normalizeDigitalSearch,
  surroundingPeriodIds,
  type DigitalProgressStatus,
} from './digitalOperationsView';
import './DigitalOperationsPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

const CHECK_COLUMNS: Array<{
  key: DigitalCheckKey;
  label: string;
  short: string;
}> = [
  { key: 'downloadLink', label: 'Link de descarga', short: 'Link' },
  {
    key: 'retailerValidation',
    label: 'Validación de cadena',
    short: 'Validación',
  },
  { key: 'cmsProgramming', label: 'Programación CMS', short: 'CMS' },
];

const PROGRESS_META: Record<
  DigitalProgressStatus,
  {
    label: string;
    cls: string;
    icon: 'minus' | 'activity' | 'check-circle' | 'ban';
  }
> = {
  'not-started': {
    label: 'Sin iniciar',
    cls: 'do-status--pending',
    icon: 'minus',
  },
  'in-progress': {
    label: 'En curso',
    cls: 'do-status--progress',
    icon: 'activity',
  },
  complete: {
    label: 'Completa',
    cls: 'do-status--complete',
    icon: 'check-circle',
  },
  cancelled: {
    label: 'Cancelada',
    cls: 'do-status--cancelled',
    icon: 'ban',
  },
};

interface DigitalRow {
  item: DigitalOperationalItem;
  tracking: DigitalOperationalTracking;
  progressStatus: DigitalProgressStatus;
  progress: number | null;
}

function todayCivil(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCommentStamp(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.toLocaleDateString('es-MX')} · ${hh}:${mm}`;
}

function checkTitle(
  tracking: DigitalOperationalTracking,
  key: DigitalCheckKey,
  label: string,
): string {
  const check = tracking.checks[key];
  if (!check.completed || !check.updatedByEmail) return label;
  return `${label}: ${check.updatedByEmail} · ${formatCommentStamp(check.updatedAt)}`;
}

function cancellationInfo(tracking: DigitalOperationalTracking): string {
  const base = tracking.updatedByEmail
    ? `Cancelada por ${tracking.updatedByEmail} · ${formatCommentStamp(tracking.updatedAt)}`
    : 'Cancelada';
  return tracking.cancellationReason
    ? `${base} · Motivo: ${tracking.cancellationReason}`
    : base;
}

export function DigitalOperationsPage() {
  const { user } = useAuth();
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' };
  const editable = !!user && can(user.role, 'digitalOperations.track');
  const [items, setItems] = useState<DigitalOperationalItem[]>([]);
  const [tracking, setTracking] = useState<DigitalOperationalTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [retailer, setRetailer] = useState('');
  const [support, setSupport] = useState('');
  const [period, setPeriod] = useState<'window' | 'all' | string>('window');
  const [placementMode, setPlacementMode] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [sourceState, setSourceState] = useState('');
  const [progressStatus, setProgressStatus] = useState('');
  const [party, setParty] = useState('');
  const [sort, setSort] = useState<SortState>({
    key: 'period',
    dir: 'asc',
  });
  const [dialog, setDialog] = useState<{
    row: DigitalRow;
    mode: 'cancel' | 'reactivate';
  } | null>(null);
  const [reasonDraft, setReasonDraft] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextItems, nextTracking] = await Promise.all([
        listDigitalOperationalItems(),
        listDigitalTracking(),
      ]);
      setItems(nextItems);
      setTracking(nextTracking);
    } catch {
      setError('No se pudo cargar la Operación Digital.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const trackingById = useMemo(
    () => new Map(tracking.map((entry) => [entry.id, entry])),
    [tracking],
  );
  const rows = useMemo<DigitalRow[]>(
    () =>
      items.flatMap((item) => {
        const itemTracking = trackingById.get(item.id);
        return itemTracking
          ? [
              {
                item,
                tracking: itemTracking,
                progressStatus: digitalProgressStatus(itemTracking),
                progress: digitalProgress(itemTracking),
              },
            ]
          : [];
      }),
    [items, trackingById],
  );
  const missingTrackingCount = items.length - rows.length;
  const periods = useMemo(() => digitalPeriodOptions(items), [items]);
  const defaultPeriodIds = useMemo(
    () => surroundingPeriodIds(periods, todayCivil()),
    [periods],
  );
  const retailers = useMemo(
    () =>
      [
        ...new Map(
          items.map((item) => [item.retailerCode, item.retailerLabel]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], 'es')),
    [items],
  );
  const supports = useMemo(
    () =>
      [
        ...new Map(items.map((item) => [item.supportCode, item.supportLabel])),
      ].sort((a, b) => a[1].localeCompare(b[1], 'es')),
    [items],
  );
  const sources = useMemo(
    () => [...new Set(items.map((item) => item.source))].sort(),
    [items],
  );
  const parties = useMemo(
    () =>
      [...new Set(items.flatMap((item) => [item.client, item.advertiser]))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, 'es')),
    [items],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeDigitalSearch(query);
    return rows.filter(
      ({ item, tracking: itemTracking, progressStatus: status }) => {
        const searchable = normalizeDigitalSearch(
          [
            item.campaignNumber,
            item.creativityId,
            item.creativityTitle,
            item.client,
            item.advertiser,
            item.product,
          ].join(' '),
        );
        return (
          (!normalizedQuery || searchable.includes(normalizedQuery)) &&
          (!source || item.source === source) &&
          (!retailer || item.retailerCode === retailer) &&
          (!support || item.supportCode === support) &&
          (period === 'all' ||
            (period === 'window'
              ? defaultPeriodIds.has(digitalPeriodKey(item))
              : digitalPeriodKey(item) === period)) &&
          (!placementMode || item.placementMode === placementMode) &&
          (!lifecycle || itemTracking.lifecycleStatus === lifecycle) &&
          (!sourceState ||
            (item.active ? 'active' : 'inactive') === sourceState) &&
          (!progressStatus || status === progressStatus) &&
          (!party || item.client === party || item.advertiser === party)
        );
      },
    );
  }, [
    rows,
    query,
    source,
    retailer,
    support,
    period,
    defaultPeriodIds,
    placementMode,
    lifecycle,
    sourceState,
    progressStatus,
    party,
  ]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        campaign: (row) => row.item.campaignNumber,
        retailer: (row) => row.item.retailerLabel,
        period: (row) => row.item.periodStart,
        fixation: (row) => row.item.fixationStart,
        mode: (row) => row.item.placementMode,
        support: (row) => row.item.supportLabel,
        volume: (row) => row.item.centers,
        progress: (row) => row.progress ?? -1,
      }),
    [filtered, sort],
  );

  function patchTracking(updated: DigitalOperationalTracking) {
    setTracking((current) => {
      const index = current.findIndex((entry) => entry.id === updated.id);
      if (index < 0) return [...current, updated];
      const next = [...current];
      next[index] = updated;
      return next;
    });
  }

  function setBusyKey(key: string, value: boolean) {
    setBusy((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function changeCheck(
    row: DigitalRow,
    key: DigitalCheckKey,
    value: boolean,
  ) {
    const busyKey = `${row.item.id}:${key}`;
    if (!editable || busy.has(busyKey)) return;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      patchTracking(await setDigitalCheck(row.item.id, key, value, actor));
    } catch {
      const label = CHECK_COLUMNS.find((column) => column.key === key)?.label;
      setActionError(`No se pudo actualizar “${label}”.`);
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  async function submitComment(row: DigitalRow) {
    const text = (commentDrafts[row.item.id] ?? '').trim();
    const busyKey = `${row.item.id}:comment`;
    if (!editable || !text || busy.has(busyKey)) return;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      patchTracking(await appendDigitalComment(row.item.id, text, actor));
      setCommentDrafts((current) => ({ ...current, [row.item.id]: '' }));
    } catch {
      setActionError(
        `No se pudo agregar el comentario de la campaña ${row.item.campaignNumber}.`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  async function confirmLifecycle() {
    if (!dialog || !editable) return;
    const { row, mode } = dialog;
    const busyKey = `${row.item.id}:lifecycle`;
    if (busy.has(busyKey)) return;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      patchTracking(
        await setDigitalLifecycle(
          row.item.id,
          mode === 'cancel',
          mode === 'cancel' ? reasonDraft : '',
          actor,
        ),
      );
      setDialog(null);
      setReasonDraft('');
    } catch {
      setActionError(
        mode === 'cancel'
          ? `No se pudo cancelar la campaña ${row.item.campaignNumber}.`
          : `No se pudo reactivar la campaña ${row.item.campaignNumber}.`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  function resetFilters() {
    setQuery('');
    setSource('');
    setRetailer('');
    setSupport('');
    setPeriod('window');
    setPlacementMode('');
    setLifecycle('');
    setSourceState('');
    setProgressStatus('');
    setParty('');
  }

  const onSort = (key: string) =>
    setSort((current) => nextSortState(current, key));

  return (
    <>
      <PageHeader
        title="Operación Digital"
        description="Seguimiento multirretailer con tres indicadores: link, validación de cadena y programación CMS. Sin testigos ni Admira."
        actions={
          <button className="btn btn-secondary" onClick={() => void load()}>
            Actualizar
          </button>
        }
      />

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}
      {actionError && (
        <div className="catalog__error" role="alert">
          {actionError}
        </div>
      )}
      {missingTrackingCount > 0 && !loading && (
        <div className="do-warning" role="status">
          {missingTrackingCount} elemento{missingTrackingCount === 1 ? '' : 's'}{' '}
          sin seguimiento asociado. Actualiza la importación para completar su
          inicialización.
        </div>
      )}

      <div className="catalog__filters do-filters">
        <input
          className="catalog__search"
          type="search"
          aria-label="Buscar campaña o creatividad"
          placeholder="Campaña o creatividad…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="do-filter">
          <span className="text-muted">Fuente</span>
          <select
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="">Todas</option>
            {sources.map((entry) => (
              <option key={entry} value={entry}>
                EKON · Seguimiento Campañas
              </option>
            ))}
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Retailer</span>
          <select
            value={retailer}
            onChange={(event) => setRetailer(event.target.value)}
          >
            <option value="">Todos</option>
            {retailers.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Soporte</span>
          <select
            value={support}
            onChange={(event) => setSupport(event.target.value)}
          >
            <option value="">Todos</option>
            {supports.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Catorcena</span>
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="window">Anterior + actual + siguiente</option>
            <option value="all">Todas</option>
            {periods.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label} · {formatDigitalDate(entry.start)}–
                {formatDigitalDate(entry.end)}
              </option>
            ))}
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Modo</span>
          <select
            value={placementMode}
            onChange={(event) => setPlacementMode(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="fixation">Fijación</option>
            <option value="continuous">Continua</option>
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Estado operativo</span>
          <select
            value={lifecycle}
            onChange={(event) => setLifecycle(event.target.value)}
          >
            <option value="">Activas y canceladas</option>
            <option value="active">Activas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Estado de fuente</span>
          <select
            value={sourceState}
            onChange={(event) => setSourceState(event.target.value)}
          >
            <option value="">Vigentes e inactivos</option>
            <option value="active">Vigentes</option>
            <option value="inactive">Inactivos</option>
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Avance</span>
          <select
            value={progressStatus}
            onChange={(event) => setProgressStatus(event.target.value)}
          >
            <option value="">Todos</option>
            <option value="not-started">Sin iniciar</option>
            <option value="in-progress">En curso</option>
            <option value="complete">Completa</option>
            <option value="cancelled">Cancelada</option>
          </select>
        </label>
        <label className="do-filter">
          <span className="text-muted">Cliente / anunciante</span>
          <select
            value={party}
            onChange={(event) => setParty(event.target.value)}
          >
            <option value="">Todos</option>
            {parties.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={resetFilters}
        >
          Restablecer
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setPeriod('all')}
        >
          Ver todo
        </button>
        <span className="text-muted do-count">
          {filtered.length} de {rows.length} operaciones
        </span>
      </div>

      {loading ? (
        <p className="text-muted">Cargando…</p>
      ) : items.length === 0 ? (
        <div className="card">
          <p className="text-muted do-empty">
            Aún no hay operaciones digitales. Importa primero el archivo de
            Seguimiento Campañas.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted do-empty">
            Ninguna operación coincide con los filtros.
          </p>
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table do-table">
            <thead>
              <tr>
                <SortableTh
                  label="Campaña"
                  sortKey="campaign"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Retailer"
                  sortKey="retailer"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Catorcena"
                  sortKey="period"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Fijación / retirada"
                  sortKey="fixation"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Modo"
                  sortKey="mode"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Soporte"
                  sortKey="support"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Centros / soportes"
                  sortKey="volume"
                  sort={sort}
                  onSort={onSort}
                  align="center"
                />
                {CHECK_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className="do-check-col"
                    title={column.label}
                  >
                    {column.short}
                  </th>
                ))}
                <SortableTh
                  label="Avance"
                  sortKey="progress"
                  sort={sort}
                  onSort={onSort}
                />
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const { item, tracking: itemTracking } = row;
                const cancelled = itemTracking.lifecycleStatus === 'cancelled';
                const isExpanded = expanded.has(item.id);
                const comments = itemTracking.comments;
                const meta = PROGRESS_META[row.progressStatus];
                const lifecycleBusy = busy.has(`${item.id}:lifecycle`);
                const commentBusy = busy.has(`${item.id}:comment`);
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={
                        [
                          cancelled ? 'do-row--cancelled' : '',
                          !item.active ? 'do-row--inactive' : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      <td>
                        <div className="do-campaign">
                          <span className="do-campaign__name">
                            {item.campaignNumber}
                          </span>
                          <span className="do-campaign__creativity">
                            {item.creativityId ||
                              item.creativityTitle ||
                              'Sin creatividad'}
                          </span>
                          {!item.active && (
                            <span className="do-badge do-badge--inactive">
                              <Icon name="minus" size={12} />
                              Inactiva en fuente
                            </span>
                          )}
                          {cancelled && (
                            <span
                              className="do-badge do-status--cancelled"
                              title={cancellationInfo(itemTracking)}
                            >
                              <Icon name="ban" size={12} />
                              Cancelada
                            </span>
                          )}
                        </div>
                      </td>
                      <td>{item.retailerLabel}</td>
                      <td>{item.periodLabel}</td>
                      <td>
                        <span className="do-date-range">
                          {formatDigitalDate(item.fixationStart)}
                          <span className="text-muted">al</span>
                          {formatDigitalDate(item.fixationEnd)}
                        </span>
                      </td>
                      <td>
                        {item.placementMode === 'fixation'
                          ? 'Fijación'
                          : 'Continua'}
                      </td>
                      <td>{item.supportLabel}</td>
                      <td className="do-volume">
                        {item.centers} / {item.supports}
                      </td>
                      {CHECK_COLUMNS.map((column) => {
                        if (cancelled) {
                          return (
                            <td key={column.key} className="do-check-cell">
                              <span className="do-na">No aplica</span>
                            </td>
                          );
                        }
                        const cellBusy = busy.has(`${item.id}:${column.key}`);
                        return (
                          <td key={column.key} className="do-check-cell">
                            <input
                              type="checkbox"
                              className="do-checkbox"
                              checked={
                                itemTracking.checks[column.key].completed
                              }
                              disabled={!editable || cellBusy}
                              aria-label={`${column.label} de ${item.campaignNumber}`}
                              title={checkTitle(
                                itemTracking,
                                column.key,
                                column.label,
                              )}
                              onChange={(event) =>
                                void changeCheck(
                                  row,
                                  column.key,
                                  event.target.checked,
                                )
                              }
                            />
                          </td>
                        );
                      })}
                      <td>
                        <div className="do-progress">
                          <span className={`do-badge ${meta.cls}`}>
                            <Icon name={meta.icon} size={13} />
                            {meta.label}
                          </span>
                          {row.progress != null && (
                            <span className="text-muted">
                              {Math.round(row.progress * 100)}%
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="do-actions-cell">
                        {editable &&
                          (cancelled ? (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={lifecycleBusy}
                              onClick={() => {
                                setDialog({ row, mode: 'reactivate' });
                                setReasonDraft('');
                              }}
                            >
                              Reactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              disabled={lifecycleBusy}
                              onClick={() => {
                                setDialog({ row, mode: 'cancel' });
                                setReasonDraft('');
                              }}
                            >
                              Cancelar
                            </button>
                          ))}
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-expanded={isExpanded}
                          aria-label={`Detalle y comentarios de ${item.campaignNumber}`}
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            })
                          }
                        >
                          Detalle · {comments.length}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="do-detail-row">
                        <td colSpan={12}>
                          <div className="do-detail">
                            <div className="do-detail__grid">
                              <div>
                                <span>Cliente</span>
                                <strong>{item.client || '—'}</strong>
                              </div>
                              <div>
                                <span>Anunciante</span>
                                <strong>{item.advertiser || '—'}</strong>
                              </div>
                              <div>
                                <span>Producto</span>
                                <strong>{item.product || '—'}</strong>
                              </div>
                              <div>
                                <span>Creatividad</span>
                                <strong>
                                  {item.creativityId || '—'} ·{' '}
                                  {item.creativityTitle || 'Sin título'}
                                </strong>
                              </div>
                              <div>
                                <span>Estado creatividad</span>
                                <strong>{item.creativityStatus || '—'}</strong>
                              </div>
                              <div>
                                <span>CMS</span>
                                <strong>
                                  {item.cmsName || 'No informado'}
                                </strong>
                              </div>
                              <div>
                                <span>Fuente</span>
                                <strong>EKON · Seguimiento Campañas</strong>
                              </div>
                              <div>
                                <span>Estado de fuente</span>
                                <strong>
                                  {item.active ? 'Vigente' : 'Inactiva'}
                                </strong>
                              </div>
                            </div>
                            <section className="do-comments">
                              <h3>Comentarios · {item.campaignNumber}</h3>
                              {comments.length === 0 ? (
                                <p className="text-muted do-comments__empty">
                                  Aún no hay comentarios.
                                </p>
                              ) : (
                                <ul className="do-comments__list">
                                  {comments.map((comment) => (
                                    <li key={comment.id} className="do-comment">
                                      <div className="do-comment__meta">
                                        <span>{comment.createdByEmail}</span>
                                        <span>
                                          {formatCommentStamp(
                                            comment.createdAt,
                                          )}
                                        </span>
                                      </div>
                                      <p>{comment.text}</p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {editable && (
                                <div className="do-comments__form">
                                  <textarea
                                    rows={2}
                                    placeholder="Escribe un comentario…"
                                    aria-label={`Nuevo comentario para ${item.campaignNumber}`}
                                    value={commentDrafts[item.id] ?? ''}
                                    disabled={commentBusy}
                                    onChange={(event) =>
                                      setCommentDrafts((current) => ({
                                        ...current,
                                        [item.id]: event.target.value,
                                      }))
                                    }
                                  />
                                  <button
                                    className="btn btn-primary"
                                    type="button"
                                    disabled={
                                      commentBusy ||
                                      !(commentDrafts[item.id] ?? '').trim()
                                    }
                                    onClick={() => void submitComment(row)}
                                  >
                                    Agregar
                                  </button>
                                </div>
                              )}
                            </section>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!editable && !loading && items.length > 0 && (
        <p className="text-muted">Solo lectura (rol sin permiso de edición).</p>
      )}

      {dialog && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="do-lifecycle-title"
        >
          <div
            className="modal__backdrop"
            aria-hidden="true"
            onClick={() => {
              if (!busy.has(`${dialog.row.item.id}:lifecycle`)) {
                setDialog(null);
              }
            }}
          />
          <div className="modal__card">
            <h2 className="modal__title" id="do-lifecycle-title">
              {dialog.mode === 'cancel'
                ? `Cancelar campaña ${dialog.row.item.campaignNumber}`
                : `Reactivar campaña ${dialog.row.item.campaignNumber}`}
            </h2>
            {dialog.mode === 'cancel' ? (
              <>
                <p>
                  Los tres indicadores mostrarán <strong>No aplica</strong> y la
                  operación quedará fuera del avance. Sus valores y comentarios
                  se conservarán.
                </p>
                <label className="do-reason" htmlFor="do-reason-input">
                  <span className="text-muted">Motivo (opcional)</span>
                  <textarea
                    id="do-reason-input"
                    rows={3}
                    placeholder="Escribe un motivo…"
                    value={reasonDraft}
                    disabled={busy.has(`${dialog.row.item.id}:lifecycle`)}
                    onChange={(event) => setReasonDraft(event.target.value)}
                  />
                </label>
              </>
            ) : (
              <p>
                La operación volverá a estar activa y recuperará exactamente los
                tres indicadores que tenía antes de cancelarse.
              </p>
            )}
            <div className="modal__actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy.has(`${dialog.row.item.id}:lifecycle`)}
                onClick={() => setDialog(null)}
              >
                Volver
              </button>
              <button
                type="button"
                className={
                  dialog.mode === 'cancel'
                    ? 'btn btn-danger'
                    : 'btn btn-primary'
                }
                disabled={busy.has(`${dialog.row.item.id}:lifecycle`)}
                onClick={() => void confirmLifecycle()}
              >
                {busy.has(`${dialog.row.item.id}:lifecycle`)
                  ? 'Guardando…'
                  : dialog.mode === 'cancel'
                    ? 'Confirmar cancelación'
                    : 'Confirmar reactivación'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
