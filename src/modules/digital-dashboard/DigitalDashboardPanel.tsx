import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { buildDigitalDashboard } from '@/domain/digital-operations';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import { listDigitalTracking } from '@/services/digitalOperationalTracking';
import '../digital-import/digital.css';

type Metrics = ReturnType<typeof buildDigitalDashboard>;

type DigitalTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/** Etiquetas legibles para las claves crudas que devuelve el agregado. */
const CHECK_LABELS: Record<string, string> = {
  downloadLink: 'Link de descarga',
  retailerValidation: 'Validación de cadena',
  cmsProgramming: 'Programación CMS',
};
const PLACEMENT_LABELS: Record<string, string> = {
  fixation: 'Fijación / retirada',
  continuous: 'Continua',
};

const relabel =
  (map: Record<string, string>) =>
  (values: Record<string, number>): Record<string, number> =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [map[k] ?? k, v]),
    );

export function DigitalDashboardPanel() {
  const [data, setData] = useState<Metrics | null>(null);
  useEffect(() => {
    void Promise.all([
      listDigitalOperationalItems(),
      listDigitalTracking(),
    ]).then(
      ([i, t]) => setData(buildDigitalDashboard(i, t)),
      () => setData(buildDigitalDashboard([], [])),
    );
  }, []);
  if (!data) return null;

  const progressPct = Math.round(data.averageProgress * 100);
  const progressTone: DigitalTone =
    data.activeItems === 0
      ? 'neutral'
      : progressPct >= 67
        ? 'success'
        : progressPct >= 34
          ? 'warning'
          : 'danger';

  const kpis: KpiDef[] = [
    {
      icon: 'activity',
      value: data.activeItems,
      label: 'Colocaciones activas',
      status: 'En operación',
      tone: 'info',
    },
    {
      icon: 'megaphone',
      value: data.distinctCampaigns,
      label: 'Campañas distintas',
      status: 'En periodo',
      tone: 'info',
    },
    {
      icon: 'check-circle',
      value: `${progressPct}%`,
      label: 'Avance promedio',
      status: 'Tres controles',
      tone: progressTone,
      progress: data.averageProgress,
    },
    {
      icon: 'monitor',
      value: data.totalCenters,
      label: 'Centros reportados',
      status: 'Acumulado',
      tone: 'neutral',
    },
    {
      icon: 'dashboard',
      value: data.totalSupports,
      label: 'Soportes reportados',
      status: 'Acumulado',
      tone: 'neutral',
    },
    {
      icon: 'ban',
      value: data.cancelledItems,
      label: 'Canceladas',
      status: data.cancelledItems > 0 ? 'Excluidas' : 'Ninguna',
      tone: data.cancelledItems > 0 ? 'warning' : 'neutral',
    },
  ];

  return (
    <section
      className="dashboard-section digital-dashboard"
      aria-labelledby="digital-dashboard"
    >
      <div className="dashboard-section__head">
        <div>
          <span className="dashboard-eyebrow">Fuente independiente</span>
          <h2 id="digital-dashboard">Operación Digital multirretailer</h2>
          <p className="dashboard-section__description">
            Métricas exclusivas de La Comer y Chedraui; no se mezclan con la
            operación Liverpool.
          </p>
        </div>
      </div>

      <div className="digital-kpis">
        {kpis.map((kpi) => (
          <KpiTile key={kpi.label} {...kpi} />
        ))}
      </div>

      <ChecksCard pending={data.pendingByCheck} active={data.activeItems} />

      <div className="digital-panels">
        <Breakdown title="Por retailer" icon="users" values={data.byRetailer} />
        <Breakdown title="Por soporte" icon="monitor" values={data.bySupport} />
        <Breakdown
          title="Por catorcena"
          icon="calendar"
          values={data.byPeriod}
        />
        <Breakdown
          title="Fijación / continua"
          icon="clock"
          values={relabel(PLACEMENT_LABELS)(data.byPlacementMode)}
        />
        <Breakdown
          title="Cliente / anunciante"
          icon="megaphone"
          values={data.byClientAdvertiser}
        />
      </div>
    </section>
  );
}

interface KpiDef {
  icon: IconName;
  value: string | number;
  label: string;
  status: string;
  tone: DigitalTone;
  /** Barra opcional 0..1 (p. ej. avance promedio). */
  progress?: number;
}

function KpiTile({ icon, value, label, status, tone, progress }: KpiDef) {
  return (
    <article className={`digital-kpi digital-kpi--${tone}`}>
      <div className="digital-kpi__top">
        <span className="digital-kpi__icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span className="digital-kpi__status">
          <span className="digital-kpi__status-dot" aria-hidden="true" />
          {status}
        </span>
      </div>
      <div>
        <div className="digital-kpi__value">{value}</div>
        <div className="digital-kpi__label">{label}</div>
      </div>
      {progress !== undefined && (
        <progress
          className="digital-kpi__progress"
          max={100}
          value={Math.round(progress * 100)}
          aria-label={`${label}: ${Math.round(progress * 100)}%`}
        >
          {Math.round(progress * 100)}%
        </progress>
      )}
    </article>
  );
}

/** Tres controles del seguimiento digital y cuántas colocaciones los deben. */
function ChecksCard({
  pending,
  active,
}: {
  pending: Record<string, number>;
  active: number;
}) {
  const keys = Object.keys(CHECK_LABELS);
  return (
    <article className="digital-checks-card" aria-label="Controles pendientes">
      <div className="digital-breakdown__head">
        <span className="digital-breakdown__icon" aria-hidden="true">
          <Icon name="check-circle" size={16} />
        </span>
        <h3>Controles pendientes</h3>
      </div>
      <div className="digital-checks-grid">
        {keys.map((key) => {
          const count = pending[key] ?? 0;
          const done = active - count;
          const tone: DigitalTone =
            active === 0 ? 'neutral' : count > 0 ? 'warning' : 'success';
          return (
            <div key={key} className={`digital-check digital-check--${tone}`}>
              <span className="digital-check__value">{count}</span>
              <span className="digital-check__label">{CHECK_LABELS[key]}</span>
              <span className="digital-check__hint">
                {active === 0
                  ? 'Sin colocaciones activas'
                  : count === 0
                    ? 'Todas completas'
                    : `${done} de ${active} completas`}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Desglose con barras de proporción, ordenado de mayor a menor. */
function Breakdown({
  title,
  icon,
  values,
}: {
  title: string;
  icon: IconName;
  values: Record<string, number>;
}) {
  const rows = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  const max = rows.reduce((m, [, v]) => Math.max(m, v), 0);
  return (
    <article className="digital-breakdown">
      <div className="digital-breakdown__head">
        <span className="digital-breakdown__icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <h3>{title}</h3>
        {total > 0 && <span className="digital-breakdown__total">{total}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="digital-breakdown__empty">Sin datos en el periodo.</p>
      ) : (
        <ul className="digital-breakdown__rows">
          {rows.map(([key, value]) => (
            <li className="digital-breakdown__row" key={key}>
              <span className="digital-breakdown__label" title={key}>
                {key}
              </span>
              <span className="digital-breakdown__bar" aria-hidden="true">
                <span
                  className="digital-breakdown__fill"
                  style={{ width: `${max ? (value / max) * 100 : 0}%` }}
                />
              </span>
              <span className="digital-breakdown__count">{value}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
