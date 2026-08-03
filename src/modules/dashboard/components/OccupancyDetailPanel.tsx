import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  CLASSIFICATION_LABEL,
  type OccupancyCampaign,
} from '../occupancyModel';
import type { TrackingRow } from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import { formatDdMmYyyy } from '@/modules/operational-tracking/businessDays';

function day(d: Date | null): string {
  return d ? formatDdMmYyyy(d) : '—';
}

/** Panel lateral de detalle (drill-down) de una barra o celda seleccionada. */
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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="occ-detail__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="occ-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Detalle de ${title}`}
      >
        <div className="occ-detail__head">
          <div>
            <h3 className="occ-detail__title">{title}</h3>
            {subtitle && (
              <p className="text-muted" style={{ margin: 0 }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="occ-detail__close"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            ✕
          </button>
        </div>

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
      </aside>
    </>
  );
}
