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
} from '@/services/campaignOperationalTracking';
import type {
  CampaignOperationalTracking,
  CheckKey,
  Classification,
} from './types';
import { todayCivil, formatDdMmYyyy, formatCivilString } from './businessDays';
import { type WitnessStatus } from './operationalStatus';
import { STATUS_META } from './statusMeta';
import {
  buildTrackingRows,
  effectiveChecks,
  type TrackingRow,
  type Timeframe,
} from './trackingModel';
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
  const [timeFilter, setTimeFilter] = useState<'all' | Timeframe>('all');
  const [params] = useSearchParams();
  const highlightKey = params.get('campana');

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
    const busyKey = `${row.campaign.nameKey}:${key}`;
    if (busy.has(busyKey)) return;
    // Se permite marcar aunque la clasificación esté pendiente; se usa
    // Institucional como valor inicial editable (nunca se asume Proveedor).
    const classification: Classification =
      row.classification === 'unknown' ? 'institutional' : row.classification;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await updateCheck({
        campaignNameKey: row.campaign.nameKey,
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
    const busyKey = `${row.campaign.nameKey}:classification`;
    if (busy.has(busyKey)) return;
    setActionError(null);
    setBusyKey(busyKey, true);
    try {
      const updated = await updateClassification({
        campaignNameKey: row.campaign.nameKey,
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
                {CHECK_COLUMNS.map((col) => (
                  <th key={col.key} title={col.label} className="ot-check-col">
                    {col.short}
                  </th>
                ))}
                <th>Estado general</th>
                <th>Próx. vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const checks = effectiveChecks(r);
                const highlighted = r.campaign.nameKey === highlightKey;
                return (
                  <tr
                    key={r.campaign.id}
                    className={highlighted ? 'ot-row--highlight' : undefined}
                  >
                    <td>{r.campaign.name}</td>
                    <td>
                      <select
                        className="ot-class-select"
                        aria-label={`Clasificación de ${r.campaign.name}`}
                        value={
                          r.classification === 'unknown' ? '' : r.classification
                        }
                        disabled={
                          !canWrite ||
                          busy.has(`${r.campaign.nameKey}:classification`)
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
                      const cellBusy = busy.has(
                        `${r.campaign.nameKey}:${col.key}`,
                      );
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
                        {STATUS_META[r.overall].icon}{' '}
                        {STATUS_META[r.overall].label}
                      </span>
                    </td>
                    <td>
                      {r.nextDeadline ? formatDdMmYyyy(r.nextDeadline) : '—'}
                    </td>
                  </tr>
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
