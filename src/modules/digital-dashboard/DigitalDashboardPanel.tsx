import { useEffect, useState } from 'react';
import { buildDigitalDashboard } from '@/domain/digital-operations';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import { listDigitalTracking } from '@/services/digitalOperationalTracking';
import '../digital-import/digital.css';
type Metrics = ReturnType<typeof buildDigitalDashboard>;
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
      <div className="digital-grid digital-grid--metrics">
        <Metric value={data.activeItems} label="Activas" tone="info" />
        <Metric value={data.cancelledItems} label="Canceladas" tone="neutral" />
        <Metric
          value={`${Math.round(data.averageProgress * 100)}%`}
          label="Avance promedio"
          tone="info"
        />
        <Metric value={data.distinctCampaigns} label="Campañas" tone="info" />
        <Metric value={data.totalCenters} label="Centros reportados" />
        <Metric value={data.totalSupports} label="Soportes reportados" />
      </div>
      <div className="digital-grid digital-grid--breakdowns">
        <Breakdown title="Por retailer" values={data.byRetailer} />
        <Breakdown title="Por soporte" values={data.bySupport} />
        <Breakdown title="Por catorcena" values={data.byPeriod} />
        <Breakdown title="Fijación / continua" values={data.byPlacementMode} />
        <Breakdown title="Pendientes" values={data.pendingByCheck} />
        <Breakdown
          title="Cliente / anunciante"
          values={data.byClientAdvertiser}
        />
      </div>
    </section>
  );
}

function Metric({
  value,
  label,
  tone = 'neutral',
}: {
  value: string | number;
  label: string;
  tone?: 'info' | 'neutral';
}) {
  return (
    <article
      className={`digital-card digital-card--metric digital-card--${tone}`}
    >
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function Breakdown({
  title,
  values,
}: {
  title: string;
  values: Record<string, number>;
}) {
  return (
    <article className="digital-card">
      <h3>{title}</h3>
      <div className="digital-bars">
        {Object.entries(values).map(([key, value]) => (
          <div className="digital-bar" key={key}>
            <span>{key}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}
