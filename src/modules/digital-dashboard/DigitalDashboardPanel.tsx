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
    <section aria-labelledby="digital-dashboard">
      <h2 id="digital-dashboard">Operación Digital Signage multirretailer</h2>
      <p>
        Sección aislada: métricas exclusivas de las colecciones{' '}
        <code>digital*</code>.
      </p>
      <div className="digital-grid">
        <article className="digital-card">
          <strong>{data.activeItems}</strong>Activas
        </article>
        <article className="digital-card">
          <strong>{data.cancelledItems}</strong>Canceladas
        </article>
        <article className="digital-card">
          <strong>{Math.round(data.averageProgress * 100)}%</strong>Avance
          promedio
        </article>
        <article className="digital-card">
          <strong>{data.distinctCampaigns}</strong>Campañas
        </article>
        <article className="digital-card">
          <strong>{data.totalCenters}</strong>Centros reportados
        </article>
        <article className="digital-card">
          <strong>{data.totalSupports}</strong>Soportes reportados
        </article>
      </div>
      <div className="digital-grid">
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
