import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
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
import '@/modules/operational-tracking/OperationalTrackingPage.css';

function trackingLink(row: TrackingRow): string {
  return `/seguimiento?campana=${encodeURIComponent(row.campaign.nameKey)}`;
}

function isoDay(d: Date | null): string {
  return d ? formatDdMmYyyy(d) : '—';
}

/** Panel inicial: resumen operativo, alertas y puntos de entrada a los módulos. */
export function DashboardPage() {
  const modules = NAV_ROUTES.filter((r) => r.path !== '/');
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [tracking, setTracking] = useState<CampaignOperationalTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [c, s, t] = await Promise.all([
          listCampaigns(),
          listScreens(),
          listOperationalTracking(),
        ]);
        if (!active) return;
        setCampaigns(c);
        setScreens(s);
        setTracking(t);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const today = useMemo(() => todayCivil(), []);
  const rows = useMemo(
    () => buildTrackingRows(campaigns, screens, tracking, today),
    [campaigns, screens, tracking, today],
  );

  const view = useMemo(() => {
    const active = rows.filter((r) => r.timeframe === 'active');
    const withAlerts = active.filter((r) => criticalAlerts(r).length > 0);
    const full = active.filter(isFullyTracked);
    const overduePending = active.filter(
      (r) => r.startStatus === 'overdue' || r.completeStatus === 'overdue',
    );
    const onTrack = active.filter(
      (r) => criticalAlerts(r).length === 0 && !isFullyTracked(r),
    );

    // B. Alertas críticas (activas + terminadas con pendientes).
    const alerts = rows
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
    const upcomingDue = rows
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
    const upcomingStarts = rows
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

    const finishedPending = rows.filter(
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

  return (
    <>
      <PageHeader
        title="Panel SIGNAM V2"
        description="Resumen operativo de campañas: estados, alertas críticas y próximos vencimientos."
      />

      {!loading && !failed && campaigns.length > 0 && (
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

      {failed && (
        <div className="import__note">
          No se pudo cargar el resumen operativo. Revisa tu conexión y vuelve a
          intentar.
        </div>
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
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">
              {route.icon}
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
