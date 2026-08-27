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

      <div className="digital-subhead">
        <span className="dashboard-eyebrow">Distribución</span>
        <h3>Cómo se reparte la operación</h3>
      </div>
      <div className="digital-dist">
        <ChecksCard pending={data.pendingByCheck} active={data.activeItems} />
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

/**
 * Fila de ranking: etiqueta + valor sobre una barra de proporción. El color de
 * la barra toma el tono de su contexto (`--tone`): acento para los desgloses,
 * semántico (success/warning) en la tarjeta de controles.
 */
function RankRow({
  label,
  value,
  share,
  tone,
  sub,
  dot = false,
}: {
  label: string;
  value: number;
  share: number;
  tone?: Extract<DigitalTone, 'success' | 'warning'>;
  sub?: string;
  dot?: boolean;
}) {
  const width = Math.max(0, Math.min(100, share));
  return (
    <li className={`digital-rank${tone ? ` digital-rank--${tone}` : ''}`}>
      <div className="digital-rank__top">
        <span className="digital-rank__label" title={label}>
          {dot && <span className="digital-rank__dot" aria-hidden="true" />}
          {label}
        </span>
        <span className="digital-rank__value">
          {value}
          {sub && <small>{sub}</small>}
        </span>
      </div>
      <span className="digital-rank__track" aria-hidden="true">
        <span className="digital-rank__fill" style={{ width: `${width}%` }} />
      </span>
    </li>
  );
}

/** Avance de los tres controles del seguimiento digital (completados/activas). */
function ChecksCard({
  pending,
  active,
}: {
  pending: Record<string, number>;
  active: number;
}) {
  return (
    <article
      className="digital-panel-card digital-panel-card--controls"
      aria-label="Controles completados"
    >
      <div className="digital-panel-card__head">
        <span className="digital-panel-card__icon" aria-hidden="true">
          <Icon name="check-circle" size={18} />
        </span>
        <h3>Controles completados</h3>
        <span className="digital-panel-card__pill">{active}</span>
      </div>
      <ul className="digital-ranks">
        {Object.keys(CHECK_LABELS).map((key) => {
          const done = active - (pending[key] ?? 0);
          const tone = active === 0 || done < active ? 'warning' : 'success';
          return (
            <RankRow
              key={key}
              label={CHECK_LABELS[key] ?? key}
              value={done}
              sub={`/ ${active}`}
              share={active ? (done / active) * 100 : 0}
              tone={active === 0 ? undefined : tone}
              dot
            />
          );
        })}
      </ul>
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
    <article className="digital-panel-card">
      <div className="digital-panel-card__head">
        <span className="digital-panel-card__icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h3>{title}</h3>
        {total > 0 && <span className="digital-panel-card__pill">{total}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="digital-panel-card__empty">Sin datos en el periodo.</p>
      ) : (
        <ul className="digital-ranks">
          {rows.map(([key, value]) => (
            <RankRow
              key={key}
              label={key}
              value={value}
              share={max ? (value / max) * 100 : 0}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
