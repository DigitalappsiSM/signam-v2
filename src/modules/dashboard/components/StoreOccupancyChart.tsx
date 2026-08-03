import type { StoreOccupancy } from '../occupancyModel';
import { ClassificationBar, ClassificationLegend } from './ClassificationBar';

/** Diez tiendas con mayor pico de campañas simultáneas (barras apiladas). */
export function StoreOccupancyChart({
  stores,
  onSelect,
}: {
  stores: StoreOccupancy[];
  onSelect: (s: StoreOccupancy) => void;
}) {
  const top = stores.slice(0, 10);
  const max = Math.max(1, ...top.map((s) => s.distinctCampaigns));
  return (
    <section className="occ-chart" aria-label="Tiendas con mayor carga">
      <h3 className="occ-chart__title">Tiendas con mayor carga</h3>
      <ClassificationLegend />
      {top.length === 0 ? (
        <p className="occ-empty">Sin tiendas en el periodo.</p>
      ) : (
        top.map((s) => (
          <button
            key={s.storeNumber}
            type="button"
            className="occ-bar-row"
            onClick={() => onSelect(s)}
            aria-label={`${s.storeName}, tienda ${s.storeNumber}. Pico ${s.peakConcurrentCampaigns} campañas simultáneas, ${s.distinctCampaigns} distintas, ${s.distinctSupports} soportes, ${s.physicalScreens} pantallas, ${s.campaignDays} días-campaña. Ver detalle.`}
          >
            <div className="occ-bar-row__head">
              <span className="occ-bar-row__name">
                {s.storeName}{' '}
                <span className="text-muted">· {s.storeNumber}</span>
              </span>
              <span className="occ-bar-row__peak">
                pico <strong>{s.peakConcurrentCampaigns}</strong>
              </span>
            </div>
            <ClassificationBar
              breakdown={s.classification}
              total={s.distinctCampaigns}
              max={max}
            />
            <div className="occ-bar-row__meta">
              <span>{s.distinctCampaigns} campañas</span>
              <span>{s.distinctSupports} soportes</span>
              <span>{s.physicalScreens} pantallas</span>
              <span>{s.campaignDays} días-campaña</span>
            </div>
          </button>
        ))
      )}
    </section>
  );
}
