import { Link } from 'react-router-dom';
import {
  criticalAlerts,
  type TrackingRow,
} from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import type { IconName } from '@/components/Icon';
import { CLASSIFICATION_LABEL } from '../occupancyModel';
import { GlassDialog } from '../controlCenter/GlassDialog';

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
 * Detalle de una tarjeta del semáforo en ventana flotante translúcida: lista las
 * campañas que componen la cifra, su motivo/estado operativo y un enlace al
 * seguimiento de cada una. No abre espacio debajo de la tarjeta. Reactivo a los
 * filtros globales (recibe las filas ya recalculadas).
 */
export function KpiDetailPanel({
  title,
  icon,
  tone,
  periodLabel,
  rows,
  onClose,
}: {
  title: string;
  icon: IconName;
  tone: 'info' | 'success' | 'warning' | 'danger';
  periodLabel: string;
  rows: TrackingRow[];
  onClose: () => void;
}) {
  return (
    <GlassDialog
      title={title}
      subtitle={`${rows.length} ${rows.length === 1 ? 'campaña' : 'campañas'} · Periodo ${periodLabel}`}
      icon={icon}
      tone={tone}
      onClose={onClose}
    >
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
    </GlassDialog>
  );
}
