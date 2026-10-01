import { Link } from 'react-router-dom';
import {
  CLASSIFICATION_LABEL,
  type OccupancyCampaign,
} from '../occupancyModel';
import type { TrackingRow } from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import { GlassDialog } from '../controlCenter/GlassDialog';
import { formatDdMmYyyy } from '@/modules/operational-tracking/businessDays';

function day(d: Date | null): string {
  return d ? formatDdMmYyyy(d) : '—';
}

/**
 * Detalle (drill-down) de una barra o celda de la carga operativa, en ventana
 * flotante translúcida como el resto del Panel.
 */
export function OccupancyDetailPanel({
  title,
  subtitle,
  stats,
  campaigns,
  rowByKey,
  onClose,
}: {
  title: string;
  subtitle?: string;
  stats: { label: string; value: string | number }[];
  campaigns: OccupancyCampaign[];
  rowByKey: Map<string, TrackingRow>;
  onClose: () => void;
}) {
  return (
    <GlassDialog
      title={title}
      subtitle={subtitle}
      icon="monitor"
      onClose={onClose}
    >
      <div className="occ-detail__stats">
        {stats.map((s) => (
          <span key={s.label}>
            {s.label}: <strong>{s.value}</strong>
          </span>
        ))}
      </div>

      {campaigns.length === 0 ? (
        <p className="occ-empty">Sin campañas en este conteo.</p>
      ) : (
        <ul className="occ-detail__list">
          {campaigns.map((c) => {
            const row = rowByKey.get(c.campaignNameKey);
            return (
              <li key={c.campaignNameKey} className="occ-campaign">
                <div className="occ-campaign__top">
                  <Link
                    to={`/seguimiento?campana=${encodeURIComponent(c.campaignNameKey)}`}
                  >
                    {c.campaignName}
                  </Link>
                  <span className={`occ-chip occ-chip--${c.classification}`}>
                    {CLASSIFICATION_LABEL[c.classification]}
                  </span>
                </div>
                <div className="occ-campaign__meta">
                  {day(c.startDate)} – {day(c.endDate)}
                  {row && (
                    <>
                      {' · '}
                      {STATUS_META[row.overall].label}
                      {row.nextDeadline
                        ? ` · vence ${formatDdMmYyyy(row.nextDeadline)}`
                        : ''}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GlassDialog>
  );
}
