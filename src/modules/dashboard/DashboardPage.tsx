import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Icon } from '@/components/Icon';
import { NAV_ROUTES } from '@/app/routes';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import {
  buildTrackingRows,
  criticalAlerts,
  effectiveChecks,
  isFullyTracked,
  rowSeverity,
  type TrackingRow,
} from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import {
  todayCivil,
  parseCampaignDate,
  calendarDaysUntil,
  formatDdMmYyyy,
  formatCivilString,
} from '@/modules/operational-tracking/businessDays';
import {
  buildOccupancyDashboard,
  presetRange,
  type DateRange,
  type RangePreset,
  type OccupancyClassification,
  type Owner,
  type SupportOccupancy,
  type StoreOccupancy,
  type StoreSupportOccupancy,
  type OccupancyCampaign,
} from './occupancyModel';
import {
  OccupancyFilters,
  type OccupancyFilterValues,
} from './components/OccupancyFilters';
import { SupportOccupancyChart } from './components/SupportOccupancyChart';
import { StoreOccupancyChart } from './components/StoreOccupancyChart';
import { StoreSupportMatrix } from './components/StoreSupportMatrix';
import { OccupancyDetailPanel } from './components/OccupancyDetailPanel';
import { DailyLoadChart } from './components/DailyLoadChart';
import { ClassificationDonut } from './components/ClassificationDonut';
import { useTheme } from '@/app/theme';
import '@/modules/operational-tracking/OperationalTrackingPage.css';
import './DashboardPage.css';

function trackingLink(row: TrackingRow): string {
  // Enlaza por identidad para resaltar el "flight" correcto en Seguimiento.
  return `/seguimiento?campana=${encodeURIComponent(row.identity)}`;
}

function isoDay(d: Date | null): string {
  return d ? formatDdMmYyyy(d) : '—';
}

type Selection =
  | { kind: 'support'; item: SupportOccupancy }
  | { kind: 'store'; item: StoreOccupancy }
  | { kind: 'cell'; item: StoreSupportOccupancy };

interface DetailData {
  title: string;
  subtitle?: string;
  stats: { label: string; value: string | number }[];
  campaigns: OccupancyCampaign[];
}

function selectionToDetail(sel: Selection): DetailData {
  if (sel.kind === 'support') {
    const s = sel.item;
    return {
      title: s.supportName,
      subtitle: s.owner === 'instore-media' ? 'InStore Media' : 'Liverpool',
      stats: [
        { label: 'Pico simultáneo', value: s.peakConcurrentCampaigns },
        { label: 'Campañas', value: s.distinctCampaigns },
        { label: 'Tiendas', value: s.distinctStores },
        { label: 'Pantallas', value: s.physicalScreens },
        { label: 'Días-campaña', value: s.campaignDays },
      ],
      campaigns: s.campaigns,
    };
  }
  if (sel.kind === 'store') {
    const s = sel.item;
    return {
      title: `${s.storeName} · ${s.storeNumber}`,
      stats: [
        { label: 'Pico simultáneo', value: s.peakConcurrentCampaigns },
        { label: 'Campañas', value: s.distinctCampaigns },
        { label: 'Soportes', value: s.distinctSupports },
        { label: 'Pantallas', value: s.physicalScreens },
        { label: 'Días-campaña', value: s.campaignDays },
      ],
      campaigns: s.campaigns,
    };
  }
  const c = sel.item;
  return {
    title: `${c.storeName} · ${c.supportName}`,
    subtitle: `Tienda ${c.storeNumber}`,
    stats: [
      { label: 'Pico simultáneo', value: c.peakConcurrentCampaigns },
      { label: 'Campañas', value: c.distinctCampaigns },
      { label: 'Pantallas', value: c.screenIds.length },
      { label: 'Días-campaña', value: c.campaignDays },
    ],
    campaigns: c.campaigns,
  };
}

/** Panel inicial: resumen operativo, alertas y puntos de entrada a los módulos. */
export function DashboardPage() {
  const modules = NAV_ROUTES.filter((r) => r.path !== '/');
  const { theme } = useTheme();
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [tracking, setTracking] = useState<CampaignOperationalTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setFailed(false);
    try {
      const [c, s, t] = await Promise.all([
        listCampaigns(),
        listScreens(),
        listOperationalTracking(),
      ]);
      // Conserva datos previos hasta tener la respuesta (no vacía la pantalla).
      setCampaigns(c);
      setScreens(s);
      setTracking(t);
      setLoadedAt(new Date());
      setLoadedOnce(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => todayCivil(), []);
  const rows = useMemo(
    () => buildTrackingRows(campaigns, screens, tracking, today),
    [campaigns, screens, tracking, today],
  );

  const view = useMemo(() => {
    // Las campañas canceladas se excluyen por completo del resumen operativo
    // (KPIs, alertas, vencimientos, inicios y terminadas con pendientes). Se
    // filtran explícitamente ANTES de calcular las secciones para que una
    // cancelada no acabe contada como "En curso sin atrasos" solo porque
    // `criticalAlerts()` devuelva un arreglo vacío. Siguen participando en la
    // sección de carga (que usa `campaigns`/`tracking`, no estas filas).
    const applicable = rows.filter((r) => r.lifecycleStatus !== 'cancelled');
    const active = applicable.filter((r) => r.timeframe === 'active');
    const withAlerts = active.filter((r) => criticalAlerts(r).length > 0);
    const full = active.filter(isFullyTracked);
    const overduePending = active.filter(
      (r) => r.startStatus === 'overdue' || r.completeStatus === 'overdue',
    );
    const onTrack = active.filter(
      (r) => criticalAlerts(r).length === 0 && !isFullyTracked(r),
    );

    // B. Alertas críticas (activas + terminadas con pendientes).
    const alerts = applicable
      .map((r) => ({ row: r, alerts: criticalAlerts(r) }))
      .filter((x) => x.alerts.length > 0)
      .sort((a, b) => {
        const s = rowSeverity(a.row) - rowSeverity(b.row);
        if (s !== 0) return s;
        const da = a.row.nextDeadline?.getTime() ?? Infinity;
        const db = b.row.nextDeadline?.getTime() ?? Infinity;
        return da - db;
      });

    // C. Próximos vencimientos (por vencer, no vencidos).
    const upcomingDue = applicable
      .filter(
        (r) =>
          r.startStatus === 'due-soon' ||
          r.startStatus === 'due-today' ||
          r.completeStatus === 'due-soon' ||
          r.completeStatus === 'due-today',
      )
      .sort(
        (a, b) =>
          (a.nextDeadline?.getTime() ?? Infinity) -
          (b.nextDeadline?.getTime() ?? Infinity),
      );

    // D. Próximos inicios (dentro de 7 días naturales).
    const upcomingStarts = applicable
      .filter((r) => {
        if (r.timeframe !== 'upcoming') return false;
        const start = parseCampaignDate(r.campaign.fechaInicio);
        if (!start) return false;
        const days = calendarDaysUntil(today, start);
        return days >= 0 && days <= 7;
      })
      .sort(
        (a, b) =>
          (parseCampaignDate(a.campaign.fechaInicio)?.getTime() ?? 0) -
          (parseCampaignDate(b.campaign.fechaInicio)?.getTime() ?? 0),
      );

    const finishedPending = applicable.filter(
      (r) => r.timeframe === 'finished' && criticalAlerts(r).length > 0,
    );

    return {
      active,
      withAlerts,
      full,
      overduePending,
      onTrack,
      alerts,
      upcomingDue,
      upcomingStarts,
      finishedPending,
    };
  }, [rows, today]);

  // --- Carga operativa (ocupación) -----------------------------------------
  const [params, setParams] = useSearchParams();
  const filters: OccupancyFilterValues = {
    preset: (params.get('periodo') as RangePreset) || 'today',
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    classification:
      (params.get('clasificacion') as OccupancyClassification | 'all') || 'all',
    owner: (params.get('propietario') as Owner | 'all') || 'all',
    support: params.get('soporte') ?? '',
    store: params.get('tienda') ?? '',
    search: params.get('q') ?? '',
  };
  const patchFilters = (patch: Partial<OccupancyFilterValues>) => {
    const next = { ...filters, ...patch };
    const p = new URLSearchParams();
    if (next.preset !== 'today') p.set('periodo', next.preset);
    if (next.preset === 'custom') {
      if (next.desde) p.set('desde', next.desde);
      if (next.hasta) p.set('hasta', next.hasta);
    }
    if (next.classification !== 'all')
      p.set('clasificacion', next.classification);
    if (next.owner !== 'all') p.set('propietario', next.owner);
    if (next.support) p.set('soporte', next.support);
    if (next.store) p.set('tienda', next.store);
    if (next.search) p.set('q', next.search);
    setParams(p, { replace: true });
  };

  const range: DateRange = useMemo(() => {
    if (filters.preset === 'custom') {
      const s = parseCampaignDate(filters.desde) ?? today;
      const e = parseCampaignDate(filters.hasta) ?? s;
      return s.getTime() <= e.getTime()
        ? { start: s, end: e }
        : { start: e, end: s };
    }
    return presetRange(filters.preset, today);
  }, [filters.preset, filters.desde, filters.hasta, today]);

  // Opciones de soporte/tienda: modelo del periodo sin filtros de tienda/soporte.
  const optionsModel = useMemo(
    () => buildOccupancyDashboard({ campaigns, screens, tracking, range }),
    [campaigns, screens, tracking, range],
  );
  const supportOptions = useMemo(
    () =>
      [...optionsModel.supports]
        .map((s) => ({ key: s.supportKey, name: s.supportName }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [optionsModel],
  );
  const storeOptions = useMemo(
    () =>
      [...optionsModel.stores]
        .map((s) => ({ number: s.storeNumber, name: s.storeName }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [optionsModel],
  );

  const occupancy = useMemo(
    () =>
      buildOccupancyDashboard({
        campaigns,
        screens,
        tracking,
        range,
        filters: {
          classification: filters.classification,
          owner: filters.owner,
          store: filters.store || null,
          support: filters.support || null,
          search: filters.search,
        },
      }),
    [
      campaigns,
      screens,
      tracking,
      range,
      filters.classification,
      filters.owner,
      filters.store,
      filters.support,
      filters.search,
    ],
  );

  const rowByKey = useMemo(() => {
    const m = new Map<string, TrackingRow>();
    for (const r of rows) m.set(r.campaign.nameKey, r);
    return m;
  }, [rows]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const detail = useMemo(
    () => (selection ? selectionToDetail(selection) : null),
    [selection],
  );

  return (
    <>
      <PageHeader
        title="Panel SIGNAM V2"
        description="Resumen operativo de campañas: estados, alertas críticas y próximos vencimientos."
      />

      {loading && !loadedOnce && (
        <p className="text-muted" role="status">
          Cargando resumen…
        </p>
      )}

      {failed && (
        <div className="import__note" role="alert">
          No se pudo cargar el resumen operativo. Revisa tu conexión y vuelve a
          intentar.
        </div>
      )}

      {loadedOnce && campaigns.length > 0 && (
        <>
          <section
            className="dash-summary"
            aria-label="Resumen de campañas activas"
          >
            <SummaryTile label="Activas" value={view.active.length} />
            <SummaryTile
              label="Seguimiento completo"
              value={view.full.length}
            />
            <SummaryTile
              label="En curso sin atrasos"
              value={view.onTrack.length}
            />
            <SummaryTile
              label="Con alertas"
              value={view.withAlerts.length}
              tone="warn"
            />
            <SummaryTile
              label="Vencidas con pendientes"
              value={view.overduePending.length}
              tone="danger"
            />
          </section>

          <div className="dash-grid">
            <AlertList
              title="Alertas críticas"
              empty="Sin alertas críticas."
              items={view.alerts.map((a) => ({
                row: a.row,
                text: a.alerts.map((x) => x.label).join(' · '),
              }))}
            />
            <AlertList
              title="Próximos vencimientos"
              empty="Nada por vencer pronto."
              items={view.upcomingDue.map((r) => ({
                row: r,
                text: `${STATUS_META[r.overall].label} · ${isoDay(r.nextDeadline)}`,
              }))}
            />
            <AlertList
              title="Próximos inicios (7 días)"
              empty="Sin inicios próximos."
              items={view.upcomingStarts.map((r) => {
                const c = effectiveChecks(r);
                const pend: string[] = [];
                if (r.linkStatus !== 'valid') pend.push('link');
                if (!c.liverpool) pend.push('validación');
                if (!c.csm) pend.push('CSM');
                return {
                  row: r,
                  text: `Inicia ${formatCivilString(r.campaign.fechaInicio)}${
                    pend.length ? ` · pendiente: ${pend.join(', ')}` : ''
                  }`,
                };
              })}
            />
            <AlertList
              title="Terminadas con pendientes"
              empty="Ninguna terminada con obligaciones pendientes."
              items={view.finishedPending.map((r) => ({
                row: r,
                text: criticalAlerts(r)
                  .map((x) => x.label)
                  .join(' · '),
              }))}
            />
          </div>
        </>
      )}

      {loadedOnce && (
        <section
          className="occ-section"
          aria-label="Carga por tienda y soporte"
        >
          <div className="occ-section__head">
            <h2 className="occ-section__title">Carga por tienda y soporte</h2>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
            >
              {loadedAt && (
                <span className="occ-updated">
                  Actualizado {formatDdMmYyyy(loadedAt)}{' '}
                  {String(loadedAt.getHours()).padStart(2, '0')}:
                  {String(loadedAt.getMinutes()).padStart(2, '0')}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void load()}
                disabled={refreshing}
                aria-busy={refreshing}
              >
                {refreshing ? 'Actualizando…' : 'Actualizar'}
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ margin: '0 0 0.25rem' }}>
            Carga operativa medida como{' '}
            <strong>pico de campañas simultáneas</strong> en el periodo. No
            representa un porcentaje de capacidad (aún no se modela capacidad
            máxima por pantalla).
          </p>

          <OccupancyFilters
            values={filters}
            onChange={patchFilters}
            supportOptions={supportOptions}
            storeOptions={storeOptions}
          />

          {campaigns.length === 0 ? (
            <p className="occ-empty">
              Aún no hay campañas. Importa el calendario para ver la carga.
            </p>
          ) : occupancy.totals.distinctCampaigns === 0 ? (
            <p className="occ-empty">
              Sin campañas en el periodo o filtros seleccionados.
            </p>
          ) : (
            <>
              <div className="occ-cards">
                <OccCard
                  label="Tienda con mayor carga"
                  value={occupancy.stores[0]?.storeName ?? '—'}
                  sub={
                    occupancy.stores[0]
                      ? `Pico ${occupancy.stores[0].peakConcurrentCampaigns} simultáneas`
                      : undefined
                  }
                />
                <OccCard
                  label="Soporte con mayor carga"
                  value={occupancy.supports[0]?.supportName ?? '—'}
                  sub={
                    occupancy.supports[0]
                      ? `Pico ${occupancy.supports[0].peakConcurrentCampaigns} simultáneas`
                      : undefined
                  }
                />
                <OccCard
                  label="Campañas activas en el periodo"
                  value={occupancy.totals.distinctCampaigns}
                  sub={`Pico global ${occupancy.totals.peakConcurrentCampaigns}`}
                />
                <OccCard
                  label="Tiendas utilizadas"
                  value={occupancy.totals.distinctStores}
                />
                <OccCard
                  label="Soportes utilizados"
                  value={occupancy.totals.distinctSupports}
                />
              </div>

              <div className="occ-visuals">
                <section
                  className="occ-panel"
                  aria-label="Campañas simultáneas por día"
                >
                  <h3 className="occ-chart__title">
                    Carga diaria (campañas simultáneas)
                  </h3>
                  <DailyLoadChart series={occupancy.series} theme={theme} />
                </section>
                <section
                  className="occ-panel occ-panel--narrow"
                  aria-label="Campañas por clasificación"
                >
                  <h3 className="occ-chart__title">Mezcla por clasificación</h3>
                  <ClassificationDonut
                    breakdown={occupancy.classificationTotals}
                    theme={theme}
                  />
                </section>
              </div>

              <div className="occ-charts">
                <SupportOccupancyChart
                  supports={occupancy.supports}
                  onSelect={(item) => setSelection({ kind: 'support', item })}
                />
                <StoreOccupancyChart
                  stores={occupancy.stores}
                  onSelect={(item) => setSelection({ kind: 'store', item })}
                />
              </div>

              <h3 style={{ fontSize: '1rem', margin: '1.25rem 0 0.25rem' }}>
                Matriz tienda × soporte
              </h3>
              <p
                className="text-muted"
                style={{ margin: '0 0 0.25rem', fontSize: '0.82rem' }}
              >
                El color indica intensidad relativa del pico dentro de la vista,
                no capacidad ni saturación.
              </p>
              <StoreSupportMatrix
                supports={occupancy.supports}
                stores={occupancy.stores}
                matrix={occupancy.matrix}
                onSelect={(item) => setSelection({ kind: 'cell', item })}
              />
            </>
          )}
        </section>
      )}

      {detail && (
        <OccupancyDetailPanel
          title={detail.title}
          subtitle={detail.subtitle}
          stats={detail.stats}
          campaigns={detail.campaigns}
          rowByKey={rowByKey}
          onClose={() => setSelection(null)}
        />
      )}

      <h2 style={{ fontSize: '1.1rem', margin: '1.5rem 0 0.75rem' }}>
        Módulos
      </h2>
      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        {modules.map((route) => (
          <Link
            key={route.path}
            to={route.path}
            className="card"
            style={{ color: 'inherit', display: 'block' }}
          >
            <div className="dash-module__icon" aria-hidden="true">
              <Icon name={route.icon} size={22} />
            </div>
            <h3 style={{ fontSize: '1.05rem', marginTop: '0.5rem' }}>
              {route.label}
            </h3>
            <p className="text-muted" style={{ margin: 0 }}>
              {route.description}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'warn' | 'danger';
}) {
  return (
    <div className={`dash-tile${tone ? ` dash-tile--${tone}` : ''}`}>
      <div className="dash-tile__value">{value}</div>
      <div className="dash-tile__label">{label}</div>
    </div>
  );
}

function OccCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="occ-card">
      <div className="occ-card__label">{label}</div>
      <div className="occ-card__value">{value}</div>
      {sub && <div className="occ-card__sub">{sub}</div>}
    </div>
  );
}

function AlertList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { row: TrackingRow; text: string }[];
}) {
  return (
    <section className="card dash-list" aria-label={title}>
      <h3 className="dash-list__title">
        {title} <span className="text-muted">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-muted" style={{ margin: 0 }}>
          {empty}
        </p>
      ) : (
        <ul className="dash-list__items">
          {items.slice(0, 12).map((it) => (
            <li key={it.row.campaign.id}>
              <Link to={trackingLink(it.row)}>{it.row.campaign.name}</Link>
              <span className="text-muted"> — {it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
