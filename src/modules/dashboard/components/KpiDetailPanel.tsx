import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  criticalAlerts,
  type TrackingRow,
} from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import { CLASSIFICATION_LABEL } from '../occupancyModel';

/**
 * Enlace al registro exacto del flight en Seguimiento operativo. Usa la
 * identidad canónica (no el nombre) porque pueden existir campañas homónimas
 * con flights distintos.
 */
function trackingLink(row: TrackingRow): string {
  return `/seguimiento?campana=${encodeURIComponent(row.identity)}`;
}

/**
 * Motivo o estado operativo mostrado para cada campaña del detalle. Si tiene
 * alertas críticas, se listan sus incidencias reales; si no, el estado global.
 */
function reasonFor(row: TrackingRow): string {
  const alerts = criticalAlerts(row);
  if (alerts.length > 0) return alerts.map((a) => a.label).join(' · ');
  return STATUS_META[row.overall].label;
}

/** Etiqueta legible de la clasificación de la campaña (texto, no solo color). */
function classificationLabel(row: TrackingRow): string {
  return CLASSIFICATION_LABEL[row.classification];
}

/**
 * Panel de detalle de una tarjeta KPI: lista las campañas que componen la cifra,
 * su motivo/estado operativo y un enlace al seguimiento de cada una. Reactivo a
 * los filtros globales (recibe las filas ya recalculadas).
 */
export function KpiDetailPanel({
  title,
  periodLabel,
  rows,
  onClose,
}: {
  title: string;
  periodLabel: string;
  rows: TrackingRow[];
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
    <section
      className="kpi-detail"
      role="region"
      aria-label={`Detalle de la tarjeta ${title}`}
    >
      <div className="kpi-detail__head">
        <div>
          <span className="dashboard-eyebrow">Detalle de tarjeta</span>
          <h3 className="kpi-detail__title">{title}</h3>
          <p className="kpi-detail__meta">
            {rows.length} {rows.length === 1 ? 'campaña' : 'campañas'} · Periodo{' '}
            {periodLabel}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="kpi-detail__close"
          onClick={onClose}
          aria-label="Cerrar detalle de la tarjeta"
        >
          ✕
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="kpi-detail__empty">
          Ninguna campaña coincide con esta tarjeta y los filtros actuales.
        </p>
      ) : (
        <ul className="kpi-detail__list">
          {rows.map((row) => (
            <li key={row.campaign.id} className="kpi-detail__item">
              <div className="kpi-detail__item-top">
                <Link to={trackingLink(row)}>{row.campaign.name}</Link>
                <span className={`occ-chip occ-chip--${row.classification}`}>
                  {classificationLabel(row)}
                </span>
              </div>
              <div className="kpi-detail__reason">{reasonFor(row)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
