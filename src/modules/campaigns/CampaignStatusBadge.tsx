import {
  EFFECTIVE_STATUS_LABELS,
  type EffectiveCampaignStatus,
} from './campaignStatus';

const BADGE_CLASS: Record<EffectiveCampaignStatus, string> = {
  active: 'badge-success',
  paused: 'badge-warning',
  cancelled: 'badge-danger',
  duplicate: 'badge-info',
  withdrawn: 'badge-muted',
};

/** Etiqueta del estado de una campaña (texto + color de refuerzo). */
export function CampaignStatusBadge({
  status,
  title,
}: {
  status: EffectiveCampaignStatus;
  title?: string;
}) {
  return (
    <span
      className={`badge ${BADGE_CLASS[status]} campaign-status-badge`}
      title={title}
    >
      {EFFECTIVE_STATUS_LABELS[status]}
    </span>
  );
}
