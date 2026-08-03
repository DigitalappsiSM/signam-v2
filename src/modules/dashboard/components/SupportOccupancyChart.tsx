import type { SupportOccupancy } from '../occupancyModel';
import { ClassificationBar, ClassificationLegend } from './ClassificationBar';

/** Diez soportes con mayor pico de campañas simultáneas (barras apiladas). */
export function SupportOccupancyChart({
  supports,
  onSelect,
}: {
  supports: SupportOccupancy[];
  onSelect: (s: SupportOccupancy) => void;
}) {
  const top = supports.slice(0, 10);
  const max = Math.max(1, ...top.map((s) => s.distinctCampaigns));
  return (
    <section className="occ-chart" aria-label="Soportes con mayor carga">
      <h3 className="occ-chart__title">Soportes con mayor carga</h3>
      <ClassificationLegend />
      {top.length === 0 ? (
        <p className="occ-empty">Sin soportes en el periodo.</p>
      ) : (
        top.map((s) => (
          <button
            key={`${s.owner}:${s.supportKey}`}
            type="button"
            className="occ-bar-row"
            onClick={() => onSelect(s)}
            aria-label={`${s.supportName}. Pico ${s.peakConcurrentCampaigns} campañas simultáneas, ${s.distinctCampaigns} distintas, ${s.distinctStores} tiendas, ${s.physicalScreens} pantallas, ${s.campaignDays} días-campaña. Ver detalle.`}
          >
            <div className="occ-bar-row__head">
              <span className="occ-bar-row__name">
                {s.supportName}
                {s.owner === 'instore-media' && (
                  <span className="occ-owner-tag occ-owner-tag--instore-media">
                    InStore
                  </span>
                )}
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
              <span>{s.distinctStores} tiendas</span>
              <span>{s.physicalScreens} pantallas</span>
              <span>{s.campaignDays} días-campaña</span>
            </div>
          </button>
        ))
      )}
    </section>
  );
}
