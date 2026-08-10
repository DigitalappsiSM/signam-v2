import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  listOperationalTracking,
  updateCheck,
  updateClassification,
  markAllChecks,
  addComment,
  TrackingError,
} from '@/services/campaignOperationalTracking';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
} from './types';
import {
  todayCivil,
  formatDdMmYyyy,
  formatCivilString,
  parseCampaignDate,
  defaultTrackingWindow,
} from './businessDays';
import {
  campaignIntersectsPeriod,
  hasPeriodFilter,
  periodError,
} from '@/modules/campaigns/dateFilter';
import { type WitnessStatus } from './operationalStatus';
import { STATUS_META } from './statusMeta';
import { Icon } from '@/components/Icon';
import {
  buildTrackingRows,
  effectiveChecks,
  rowSeverity,
  type TrackingRow,
} from './trackingModel';
import { SortableTh } from '@/components/SortableTh';
import { nextSortState, sortRows, type SortState } from '@/lib/tableSort';
import './OperationalTrackingPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

/** Columnas de indicadores editables (en orden). */
const CHECK_COLUMNS: { key: CheckKey; label: string; short: string }[] = [
  { key: 'linkDownload', label: 'Link de descarga', short: 'Link' },
  {
    key: 'liverpoolValidation',
    label: 'Validación Liverpool',
    short: 'Validación',
  },
  { key: 'csmProgramming', label: 'Programación CSM', short: 'CSM' },
  { key: 'witnessStart', label: 'T Arranque', short: 'T Arr.' },
  { key: 'witnessComplete', label: 'T Completos', short: 'T Comp.' },
];

function normalize(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Estado efectivo de un indicador dado, para pintar la casilla. */
function isDone(
  checks: ReturnType<typeof effectiveChecks>,
  key: CheckKey,
): boolean {
  switch (key) {
    case 'linkDownload':
      return checks.link;
    case 'liverpoolValidation':
      return checks.liverpool;
    case 'csmProgramming':
      return checks.csm;
    case 'witnessStart':
      return checks.witnessStart;
    case 'witnessComplete':
      return checks.witnessComplete;
  }
}

/** Fecha y hora corta (dd/mm/aaaa · HH:MM) para la bitácora de comentarios. */
function formatCommentStamp(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDdMmYyyy(d)} · ${hh}:${mm}`;
}

/** Texto de trazabilidad (quién/cuándo) para el tooltip de una casilla. */
function checkTitle(row: TrackingRow, key: CheckKey, label: string): string {
  const c = row.tracking ? row.tracking[key] : null;
  if (c?.completed && c.completedByEmail) {
    const when = c.completedAt ? formatDdMmYyyy(new Date(c.completedAt)) : '';
    return `${label}: ${c.completedByEmail}${when ? ` · ${when}` : ''}`;
  }
  return label;
}

export function OperationalTrackingPage() {
  const { user } = useAuth();
  // Fase pre-lanzamiento: cualquier usuario autenticado puede editar (el control
  // por rol se activará antes de liberar; ver permissions.ts / firestore.rules).
  const canWrite = user != null;
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [trackingList, setTrackingList] = useState<
    CampaignOperationalTracking[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WitnessStatus>(
    'all',
  );
  const [classFilter, setClassFilter] = useState<
    'all' | Classification | 'unknown'
  >('all');
  // Ventana por defecto: mes anterior + mes actual + mes siguiente.
  const defaultWindow = useMemo(() => defaultTrackingWindow(), []);
  const [desde, setDesde] = useState(defaultWindow.desde);
  const [hasta, setHasta] = useState(defaultWindow.hasta);
  const [params] = useSearchParams();
  const highlightKey = params.get('campana');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
    {},
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s, t] = await Promise.all([
        listCampaigns(),
        listScreens(),
        listOperationalTracking(),
      ]);
      c.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setCampaigns(c);
      setScreens(s);
      setTrackingList(t);
    } catch {
      setError('No se pudo cargar el seguimiento operativo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const today = useMemo(() => todayCivil(), []);

  const rows: TrackingRow[] = useMemo(
    () => buildTrackingRows(campaigns, screens, trackingList, today),
    [campaigns, screens, trackingList, today],
  );

  const perError = periodError(desde, hasta);

  // Fila abierta por deep link (`/seguimiento?campana=...`, p. ej. desde una
  // alerta del Panel). Debe respetarse aunque quede fuera de la ventana por
  // defecto: se exime del filtro temporal para que el enlace siempre aterrice.
  const isDeepLinked = useCallback(
    (r: TrackingRow) =>
      !!highlightKey &&
      (r.identity === highlightKey || r.campaign.nameKey === highlightKey),
    [highlightKey],
  );

  const filtered = useMemo(() => {
    if (perError) return [];
    const q = normalize(search);
    const d = parseCampaignDate(desde);
    const h = parseCampaignDate(hasta);
    return rows.filter((r) => {
      if (q && !normalize(r.campaign.name).includes(q)) return false;
      if (classFilter !== 'all' && r.classification !== classFilter)
        return false;
      // Filtro temporal por intersección de vigencia con el rango elegido.
      // Sin extremos (Ver todo) no filtra por fecha. La fila enlazada por
      // `?campana=` se exime para honrar los deep links del Panel.
      if (
        !isDeepLinked(r) &&
        !campaignIntersectsPeriod(
          r.campaign.fechaInicio,
          r.campaign.fechaFin,
          d,
          h,
        )
      ) {
        return false;
      }
      if (
        statusFilter !== 'all' &&
        r.startStatus !== statusFilter &&
        r.completeStatus !== statusFilter
      ) {
        return false;
      }
      return true;
    });
  }, [
    rows,
    search,
    classFilter,
    desde,
    hasta,
    perError,
    statusFilter,
    isDeepLinked,
  ]);

  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (r) => r.campaign.name,
        classification: (r) => r.classification,
        inicio: (r) =>
          parseCampaignDate(r.campaign.fechaInicio)?.getTime() ?? 0,
        fin: (r) => parseCampaignDate(r.campaign.fechaFin)?.getTime() ?? 0,
        tiendas: (r) => r.distinctStores,
        objetivo: (r) => r.target,
        estado: (r) => rowSeverity(r),
        vencimiento: (r) =>
          r.nextDeadline?.getTime() ?? Number.POSITIVE_INFINITY,
      }),
    [filtered, sort],
  );
  const onSort = (k: string) => setSort((s) => nextSortState(s, k));

  const patchTracking = useCallback((t: CampaignOperationalTracking) => {
    setTrackingList((prev) => [
      ...prev.filter((x) => x.campaignNameKey !== t.campaignNameKey),
      t,
    ]);
  }, []);

  const setBusyKey = useCallback((key: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  async function toggleCheck(
    row: TrackingRow,
    key: CheckKey,
    completed: boolean,
  ) {
    if (!canWrite) return;
    const busyKey = `${row.identity}:${key}`;
    if (busy.has(busyKey)) return;
    // Se permite marcar aunque la clasificación esté pendiente; se usa
    // Institucional como valor inicial editable (nunca se asume Proveedor).
    const classification: Classification =
      row.classification === 'unknown' ? 'institutional' : row.classification;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await updateCheck({
        campaignNameKey: row.identity,
        campaignName: row.campaign.name,
        key,
        completed,
        classification,
        linkValid: row.linkStatus === 'valid',
        actor,
      });
      patchTracking(updated);
    } catch (e) {
      setActionError(
        e instanceof TrackingError
          ? e.message
          : `No se pudo guardar el cambio en "${row.campaign.name}".`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  async function setRowClassification(row: TrackingRow, value: Classification) {
    if (!canWrite) return;
    const busyKey = `${row.identity}:classification`;
    if (busy.has(busyKey)) return;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await updateClassification({
        campaignNameKey: row.identity,
        campaignName: row.campaign.name,
        classification: value,
        linkValid: row.linkStatus === 'valid',
        actor,
      });
      patchTracking(updated);
    } catch {
      setActionError(
        `No se pudo guardar la clasificación de "${row.campaign.name}".`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  async function markAllForRow(row: TrackingRow) {
    if (!canWrite) return;
    const busyKey = `${row.identity}:markall`;
    if (busy.has(busyKey)) return;
    const classification: Classification =
      row.classification === 'unknown' ? 'institutional' : row.classification;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await markAllChecks({
        campaignNameKey: row.identity,
        campaignName: row.campaign.name,
        classification,
        linkValid: row.linkStatus === 'valid',
        actor,
      });
      patchTracking(updated);
    } catch (e) {
      setActionError(
        e instanceof TrackingError
          ? e.message
          : `No se pudieron marcar todos los indicadores de "${row.campaign.name}".`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  function toggleExpanded(nameKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nameKey)) next.delete(nameKey);
      else next.add(nameKey);
      return next;
    });
  }

  async function submitComment(row: TrackingRow) {
    if (!canWrite) return;
    const text = (commentDrafts[row.identity] ?? '').trim();
    if (!text) return;
    const busyKey = `${row.identity}:comment`;
    if (busy.has(busyKey)) return;
    const classification: Classification =
      row.classification === 'unknown' ? 'institutional' : row.classification;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await addComment({
        campaignNameKey: row.identity,
        campaignName: row.campaign.name,
        text,
        classification,
        linkValid: row.linkStatus === 'valid',
        actor,
      });
      patchTracking(updated);
      setCommentDrafts((prev) => ({ ...prev, [row.identity]: '' }));
    } catch {
      setActionError(
        `No se pudo guardar el comentario de "${row.campaign.name}".`,
      );
    } finally {
      setBusyKey(busyKey, false);
    }
  }

  return (
    <>
      <PageHeader
        title="Seguimiento operativo"
        description="Marca los indicadores directamente en la tabla. Los checks son independientes del calendario importado y sobreviven a las reimportaciones."
        actions={
          <button className="btn btn-secondary" onClick={() => void reload()}>
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

      <div className="catalog__filters">
        <input
          className="catalog__search"
          type="search"
          placeholder="Buscar campaña…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="ot-filter">
          <span className="text-muted">Estado</span>
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | WitnessStatus)
            }
          >
            <option value="all">Todos</option>
            {Object.keys(STATUS_META).map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s as WitnessStatus].label}
              </option>
            ))}
          </select>
        </label>
        <label className="ot-filter">
          <span className="text-muted">Clasificación</span>
          <select
            value={classFilter}
            onChange={(e) =>
              setClassFilter(
                e.target.value as 'all' | Classification | 'unknown',
              )
            }
          >
            <option value="all">Todas</option>
            <option value="institutional">Institucional</option>
            <option value="provider">Proveedor</option>
            <option value="unknown">Pendiente</option>
          </select>
        </label>
        <label className="campaign-date">
          <span className="text-muted">Desde</span>
          <input
            type="date"
            aria-label="Periodo desde"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label className="campaign-date">
          <span className="text-muted">Hasta</span>
          <input
            type="date"
            aria-label="Periodo hasta"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setDesde(defaultWindow.desde);
            setHasta(defaultWindow.hasta);
          }}
          title="Volver al periodo por defecto (mes anterior, actual y siguiente)"
        >
          Restablecer
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => {
            setDesde('');
            setHasta('');
          }}
          title="Quitar el filtro de fechas y mostrar todas las campañas"
        >
          Ver todo
        </button>
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          {filtered.length} de {campaigns.length} campañas
          {hasPeriodFilter(desde, hasta) ? '' : ' · todo el periodo'}
        </span>
      </div>

      {perError && (
        <div className="catalog__error" role="alert">
          {perError}
        </div>
      )}

      {loading ? (
        <p className="text-muted">Cargando…</p>
      ) : campaigns.length === 0 ? (
        <div className="import__note">
          Aún no hay campañas. Importa el calendario en{' '}
          <strong>Importar Calendario</strong>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Ninguna campaña coincide con los filtros.
          </p>
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table ot-table">
            <thead>
              <tr>
                <SortableTh
                  label="Campaña"
                  sortKey="name"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Clasificación"
                  sortKey="classification"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Inicio"
                  sortKey="inicio"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Fin"
                  sortKey="fin"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Tiendas"
                  sortKey="tiendas"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Objetivo 10%"
                  sortKey="objetivo"
                  sort={sort}
                  onSort={onSort}
                />
                {CHECK_COLUMNS.map((col) => (
                  <th key={col.key} title={col.label} className="ot-check-col">
                    {col.short}
                  </th>
                ))}
                <SortableTh
                  label="Estado general"
                  sortKey="estado"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Próx. vencimiento"
                  sortKey="vencimiento"
                  sort={sort}
                  onSort={onSort}
                />
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const checks = effectiveChecks(r);
                const highlighted =
                  r.identity === highlightKey ||
                  r.campaign.nameKey === highlightKey;
                const comments = r.tracking?.comments ?? [];
                const isExpanded = expanded.has(r.identity);
                const isFinished = r.timeframe === 'finished';
                const markAllBusy = busy.has(`${r.identity}:markall`);
                const commentBusy = busy.has(`${r.identity}:comment`);
                return (
                  <Fragment key={r.campaign.id}>
                    <tr
                      className={highlighted ? 'ot-row--highlight' : undefined}
                    >
                      <td>{r.campaign.name}</td>
                      <td>
                        <select
                          className="ot-class-select"
                          aria-label={`Clasificación de ${r.campaign.name}`}
                          value={
                            r.classification === 'unknown'
                              ? ''
                              : r.classification
                          }
                          disabled={
                            !canWrite ||
                            busy.has(`${r.identity}:classification`)
                          }
                          onChange={(e) =>
                            void setRowClassification(
                              r,
                              e.target.value as Classification,
                            )
                          }
                        >
                          {r.classification === 'unknown' && (
                            <option value="" disabled>
                              — Pendiente —
                            </option>
                          )}
                          <option value="institutional">Institucional</option>
                          <option value="provider">Proveedor</option>
                        </select>
                      </td>
                      <td>{formatCivilString(r.campaign.fechaInicio)}</td>
                      <td>{formatCivilString(r.campaign.fechaFin)}</td>
                      <td>{r.distinctStores}</td>
                      <td>
                        {r.target} de {r.distinctStores}
                      </td>
                      {CHECK_COLUMNS.map((col) => {
                        const done = isDone(checks, col.key);
                        const cellBusy = busy.has(`${r.identity}:${col.key}`);
                        return (
                          <td key={col.key} className="ot-check-cell">
                            <input
                              type="checkbox"
                              className="ot-checkbox"
                              checked={done}
                              disabled={!canWrite || cellBusy}
                              title={checkTitle(r, col.key, col.label)}
                              aria-label={`${col.label} de ${r.campaign.name}`}
                              onChange={(e) =>
                                void toggleCheck(r, col.key, e.target.checked)
                              }
                            />
                          </td>
                        );
                      })}
                      <td>
                        <span
                          className={`ot-badge ${STATUS_META[r.overall].cls}`}
                        >
                          <Icon name={STATUS_META[r.overall].icon} size={14} />
                          {STATUS_META[r.overall].label}
                        </span>
                      </td>
                      <td>
                        {r.nextDeadline ? formatDdMmYyyy(r.nextDeadline) : '—'}
                      </td>
                      <td className="ot-actions-cell">
                        {isFinished && (
                          <button
                            type="button"
                            className="btn btn-secondary ot-mark-all"
                            disabled={!canWrite || markAllBusy}
                            onClick={() => void markAllForRow(r)}
                            title="Marcar todos los indicadores de esta campaña terminada"
                          >
                            Marcar todas
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary ot-comments-toggle"
                          aria-expanded={isExpanded}
                          aria-label={`Comentarios de ${r.campaign.name}`}
                          onClick={() => toggleExpanded(r.identity)}
                          title="Ver/agregar comentarios"
                        >
                          💬 {comments.length}
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="ot-comments-row">
                        <td colSpan={CHECK_COLUMNS.length + 9}>
                          <div className="ot-comments">
                            <h4 className="ot-comments__title">
                              Comentarios · {r.campaign.name}
                            </h4>
                            {comments.length === 0 ? (
                              <p className="text-muted ot-comments__empty">
                                Aún no hay comentarios.
                              </p>
                            ) : (
                              <ul className="ot-comments__list">
                                {comments.map((cm) => (
                                  <li key={cm.id} className="ot-comment">
                                    <div className="ot-comment__meta">
                                      <span className="ot-comment__author">
                                        {cm.createdByEmail}
                                      </span>
                                      <span className="ot-comment__date">
                                        {formatCommentStamp(cm.createdAt)}
                                      </span>
                                    </div>
                                    <p className="ot-comment__text">
                                      {cm.text}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {canWrite && (
                              <div className="ot-comments__form">
                                <textarea
                                  className="ot-comments__input"
                                  rows={2}
                                  placeholder="Escribe un comentario…"
                                  aria-label={`Nuevo comentario para ${r.campaign.name}`}
                                  value={commentDrafts[r.identity] ?? ''}
                                  disabled={commentBusy}
                                  onChange={(e) =>
                                    setCommentDrafts((prev) => ({
                                      ...prev,
                                      [r.identity]: e.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={
                                    commentBusy ||
                                    !(commentDrafts[r.identity] ?? '').trim()
                                  }
                                  onClick={() => void submitComment(r)}
                                >
                                  Agregar
                                </button>
                              </div>
                            )}
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

      {!canWrite && !loading && (
        <p className="text-muted">Solo lectura (rol sin permiso de edición).</p>
      )}
    </>
  );
}
