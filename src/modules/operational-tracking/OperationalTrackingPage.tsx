import { useCallback, useEffect, useMemo, useState } from 'react';
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
  TrackingError,
  type UpdateCheckParams,
} from '@/services/campaignOperationalTracking';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
} from './types';
import { todayCivil, formatDdMmYyyy, formatCivilString } from './businessDays';
import { type WitnessStatus } from './operationalStatus';
import { STATUS_META, LINK_META } from './statusMeta';
import {
  buildTrackingRows,
  effectiveChecks,
  type TrackingRow,
  type Timeframe,
} from './trackingModel';
import './OperationalTrackingPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

/** Icono ✅/➖ para un check en la vista general. */
function CheckCell({ done, label }: { done: boolean; label: string }) {
  return (
    <td
      title={`${label}: ${done ? 'sí' : 'pendiente'}`}
      className="ot-check-cell"
    >
      <span aria-label={`${label}: ${done ? 'completado' : 'pendiente'}`}>
        {done ? '✅' : '➖'}
      </span>
    </td>
  );
}

function normalize(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function OperationalTrackingPage() {
  const { user } = useAuth();
  // Fase pre-lanzamiento: cualquier usuario autenticado puede editar el
  // seguimiento (igual que el resto de colecciones). El control por rol
  // (viewer solo lectura) se activará antes de liberar, cuando los custom
  // claims de rol estén provisionados; ver `permissions.ts` / `firestore.rules`.
  const canWrite = user != null;
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [trackingList, setTrackingList] = useState<
    CampaignOperationalTracking[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WitnessStatus>(
    'all',
  );
  const [classFilter, setClassFilter] = useState<
    'all' | Classification | 'unknown'
  >('all');
  const [timeFilter, setTimeFilter] = useState<'all' | Timeframe>('all');
  const [params, setParams] = useSearchParams();
  const [detailKey, setDetailKey] = useState<string | null>(
    params.get('campana'),
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

  const filtered = useMemo(() => {
    const q = normalize(search);
    return rows.filter((r) => {
      if (q && !normalize(r.campaign.name).includes(q)) return false;
      if (classFilter !== 'all' && r.classification !== classFilter)
        return false;
      if (timeFilter !== 'all' && r.timeframe !== timeFilter) return false;
      if (
        statusFilter !== 'all' &&
        r.startStatus !== statusFilter &&
        r.completeStatus !== statusFilter
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, classFilter, timeFilter, statusFilter]);

  const patchTracking = useCallback((t: CampaignOperationalTracking) => {
    setTrackingList((prev) => {
      const rest = prev.filter((x) => x.campaignNameKey !== t.campaignNameKey);
      return [...rest, t];
    });
  }, []);

  const detailRow = detailKey
    ? (rows.find((r) => r.campaign.nameKey === detailKey) ?? null)
    : null;

  function openDetail(nameKey: string | null) {
    setDetailKey(nameKey);
    const next = new URLSearchParams(params);
    if (nameKey) next.set('campana', nameKey);
    else next.delete('campana');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Seguimiento operativo"
        description="Estados, testigos, fechas límite y alertas por campaña. Los checks manuales son independientes del calendario importado y sobreviven a las reimportaciones."
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
        <label className="ot-filter">
          <span className="text-muted">Periodo</span>
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as 'all' | Timeframe)}
          >
            <option value="all">Todas</option>
            <option value="active">Activas</option>
            <option value="upcoming">Futuras</option>
            <option value="finished">Terminadas</option>
          </select>
        </label>
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          {filtered.length} de {campaigns.length} campañas
        </span>
      </div>

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
                <th>Campaña</th>
                <th>Clasificación</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Tiendas</th>
                <th>Objetivo 10%</th>
                <th title="Link de descarga">Link</th>
                <th title="Validación Liverpool">Validación</th>
                <th title="Programación CSM">CSM</th>
                <th title="T Arranque">T Arr.</th>
                <th title="T Completos">T Comp.</th>
                <th>Estado general</th>
                <th>Próx. vencimiento</th>
                <th aria-label="Detalle" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const checks = effectiveChecks(r);
                return (
                  <tr key={r.campaign.id}>
                    <td>{r.campaign.name}</td>
                    <td>
                      {r.classification === 'unknown' ? (
                        <span className="badge badge-warning">
                          Clasificación pendiente
                        </span>
                      ) : r.classification === 'institutional' ? (
                        'Institucional'
                      ) : (
                        'Proveedor'
                      )}
                    </td>
                    <td>{formatCivilString(r.campaign.fechaInicio)}</td>
                    <td>{formatCivilString(r.campaign.fechaFin)}</td>
                    <td>{r.distinctStores}</td>
                    <td>
                      {r.target} de {r.distinctStores}
                    </td>
                    <td
                      className="ot-check-cell"
                      title={LINK_META[r.linkStatus].label}
                    >
                      {LINK_META[r.linkStatus].icon}
                    </td>
                    <CheckCell
                      done={checks.liverpool}
                      label="Validación Liverpool"
                    />
                    <CheckCell done={checks.csm} label="Programación CSM" />
                    <CheckCell done={checks.witnessStart} label="T Arranque" />
                    <CheckCell
                      done={checks.witnessComplete}
                      label="T Completos"
                    />
                    <td>
                      <span
                        className={`ot-badge ${STATUS_META[r.overall].cls}`}
                      >
                        {STATUS_META[r.overall].icon}{' '}
                        {STATUS_META[r.overall].label}
                      </span>
                    </td>
                    <td>
                      {r.nextDeadline ? formatDdMmYyyy(r.nextDeadline) : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn"
                        title={`Ver detalle de ${r.campaign.name}`}
                        aria-label={`Ver detalle de ${r.campaign.name}`}
                        onClick={() => openDetail(r.campaign.nameKey)}
                      >
                        👁️
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detailRow && (
        <TrackingDetail
          row={detailRow}
          canWrite={canWrite}
          actor={actor}
          onClose={() => openDetail(null)}
          onChanged={patchTracking}
        />
      )}
    </>
  );
}

function TrackingDetail({
  row,
  canWrite,
  actor,
  onClose,
  onChanged,
}: {
  row: TrackingRow;
  canWrite: boolean;
  actor: { uid: string; email: string };
  onClose: () => void;
  onChanged: (t: CampaignOperationalTracking) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { campaign, tracking, classification } = row;

  async function toggle(key: CheckKey, completed: boolean) {
    if (!canWrite || busy) return;
    if (classification === 'unknown') {
      setErr('Primero define la clasificación de la campaña.');
      return;
    }
    setBusy(key);
    setErr(null);
    setMsg(null);
    try {
      const params: UpdateCheckParams = {
        campaignNameKey: campaign.nameKey,
        campaignName: campaign.name,
        key,
        completed,
        classification,
        actor,
      };
      const updated = await updateCheck(params);
      onChanged(updated);
      setMsg('Guardado.');
    } catch (e) {
      setErr(
        e instanceof TrackingError
          ? e.message
          : 'No se pudo guardar el cambio.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function classify(value: Classification) {
    if (!canWrite || busy) return;
    setBusy('classification');
    setErr(null);
    setMsg(null);
    try {
      const updated = await updateClassification({
        campaignNameKey: campaign.nameKey,
        campaignName: campaign.name,
        classification: value,
        actor,
      });
      onChanged(updated);
      setMsg('Clasificación guardada.');
    } catch {
      setErr('No se pudo guardar la clasificación.');
    } finally {
      setBusy(null);
    }
  }

  const linkStatus = row.linkStatus;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de seguimiento"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card" style={{ maxWidth: 720 }}>
        <h2 className="modal__title">{campaign.name}</h2>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {formatCivilString(campaign.fechaInicio)} –{' '}
          {formatCivilString(campaign.fechaFin)} · {row.distinctStores} tiendas
          · Objetivo de arranque: {row.target} de {row.distinctStores} tiendas
        </p>

        {err && (
          <p className="catalog__error" role="alert">
            {err}
          </p>
        )}
        {msg && !err && (
          <p className="text-muted" role="status">
            {msg}
          </p>
        )}

        <section className="ot-detail-block">
          <h3>Clasificación</h3>
          {classification === 'unknown' ? (
            <p className="ot-alert">
              <span className="badge badge-warning">Pendiente</span> Selecciona
              la clasificación operativa.
            </p>
          ) : (
            <p>
              {classification === 'institutional'
                ? 'Institucional'
                : 'Proveedor'}
              {tracking && (
                <span className="text-muted">
                  {' '}
                  · origen: {tracking.classificationSource}
                </span>
              )}
            </p>
          )}
          {canWrite && (
            <div className="ot-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== null}
                onClick={() => void classify('institutional')}
              >
                Institucional
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy !== null}
                onClick={() => void classify('provider')}
              >
                Proveedor
              </button>
            </div>
          )}
        </section>

        <section className="ot-detail-block">
          <h3>Indicadores</h3>
          <ul className="ot-checks">
            <li>
              <span>
                Link de descarga{' '}
                <span className="text-muted">(automático)</span>
              </span>
              <span>
                {LINK_META[linkStatus].icon} {LINK_META[linkStatus].label}
              </span>
            </li>
            <CheckRow
              label="Validación Liverpool"
              check={tracking?.liverpoolValidation ?? null}
              defaultChecked={classification === 'institutional'}
              status={null}
              busy={busy === 'liverpoolValidation'}
              canWrite={canWrite}
              onToggle={(v) => void toggle('liverpoolValidation', v)}
            />
            <CheckRow
              label="Programación CSM"
              check={tracking?.csmProgramming ?? null}
              defaultChecked={false}
              status={null}
              busy={busy === 'csmProgramming'}
              canWrite={canWrite}
              onToggle={(v) => void toggle('csmProgramming', v)}
            />
            <CheckRow
              label="T Arranque"
              check={tracking?.witnessStart ?? null}
              defaultChecked={false}
              status={row.startStatus}
              busy={busy === 'witnessStart'}
              canWrite={canWrite}
              onToggle={(v) => void toggle('witnessStart', v)}
            />
            <CheckRow
              label="T Completos"
              check={tracking?.witnessComplete ?? null}
              defaultChecked={false}
              status={row.completeStatus}
              busy={busy === 'witnessComplete'}
              canWrite={canWrite}
              onToggle={(v) => void toggle('witnessComplete', v)}
            />
          </ul>
          {!canWrite && (
            <p className="text-muted">
              Solo lectura (rol sin permiso de edición).
            </p>
          )}
        </section>

        <div className="modal__actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  label,
  check,
  defaultChecked,
  status,
  busy,
  canWrite,
  onToggle,
}: {
  label: string;
  check: CampaignOperationalTracking['liverpoolValidation'] | null;
  defaultChecked: boolean;
  status: WitnessStatus | null;
  busy: boolean;
  canWrite: boolean;
  onToggle: (completed: boolean) => void;
}) {
  const completed = check?.completed ?? defaultChecked;
  return (
    <li>
      <span>
        {label}
        {status && (
          <span className={`ot-badge ${STATUS_META[status].cls}`}>
            {STATUS_META[status].icon} {STATUS_META[status].label}
          </span>
        )}
        {check?.completedByEmail && (
          <span className="text-muted ot-who"> · {check.completedByEmail}</span>
        )}
      </span>
      <label className="ot-check-toggle">
        <input
          type="checkbox"
          checked={completed}
          disabled={!canWrite || busy}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`${label}: ${completed ? 'completado' : 'pendiente'}`}
        />
        <span>{busy ? 'Guardando…' : completed ? 'Sí' : 'No'}</span>
      </label>
    </li>
  );
}
