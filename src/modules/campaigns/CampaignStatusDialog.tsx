import { useMemo, useState } from 'react';
import type { StoredCampaign } from './campaignDiff';
import { campaignIdentity } from './campaignDiff';
import {
  CAMPAIGN_STATUSES,
  EFFECTIVE_STATUS_LABELS,
  OTHER_REASON_CODE,
  STATUS_REASONS,
  buildStatusReason,
  duplicateCandidates,
  duplicatesOf,
  effectiveCampaignStatus,
  formatStatusReason,
  needsAdmiraWithdrawal,
  storedStatus,
  validateStatusChange,
  type CampaignStatus,
  type EffectiveCampaignStatus,
} from './campaignStatus';
import { CampaignStatusBadge } from './CampaignStatusBadge';
import {
  changeCampaignStatus,
  TrackingError,
} from '@/services/campaignOperationalTracking';
import { normalizeTracking } from '@/modules/operational-tracking/trackingFactory';
import type { TrackingActor } from '@/modules/operational-tracking/trackingFactory';
import type {
  CampaignOperationalTracking,
  Classification,
} from '@/modules/operational-tracking/types';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import './CampaignStatus.css';

/** Qué ocurre en cada estado (texto de ayuda del diálogo). */
const STATUS_HELP: Record<CampaignStatus, string> = {
  active:
    'Vuelve a la operación normal: alertas, vencimientos, Dashboard, carga, baja ocupación, CSV y Quividi.',
  paused:
    'Sigue en la consolidación/CSV de Admira y en Quividi, pero sale de alertas y vencimientos, del resumen y la carga del Dashboard y de baja ocupación.',
  cancelled:
    'Sale de todo: seguimiento, Dashboard, carga, baja ocupación, consolidación/CSV y Quividi. Sus checks se conservan para cuando se reactive.',
  duplicate:
    'Es copia de otra campaña de SIGNAM: sale de todo (seguimiento, Dashboard, carga, baja ocupación, CSV y Quividi) y queda enlazada a la original.',
};

function formatStamp(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${d.getFullYear()} · ${hh}:${mi}`;
}

export interface CampaignStatusDialogProps {
  campaign: StoredCampaign;
  tracking: CampaignOperationalTracking | null;
  /** Todas las campañas cargadas (para elegir la original de un duplicado). */
  campaigns: readonly StoredCampaign[];
  statuses: ReadonlyMap<string, EffectiveCampaignStatus>;
  trackingList: readonly CampaignOperationalTracking[];
  /** Clasificación con la que crear el seguimiento si aún no existe. */
  classification: Classification;
  linkValid: boolean;
  canWrite: boolean;
  actor: TrackingActor;
  onSaved: (tracking: CampaignOperationalTracking) => void;
  onClose: () => void;
}

/**
 * Consulta y cambio del estado de una campaña, con motivo obligatorio (catálogo
 * + «Otro» con texto libre), original del duplicado, aviso de retiro manual en
 * Admira e historial completo.
 */
export function CampaignStatusDialog({
  campaign,
  tracking,
  campaigns,
  statuses,
  trackingList,
  classification,
  linkValid,
  canWrite,
  actor,
  onSaved,
  onClose,
}: CampaignStatusDialogProps) {
  const normalized = tracking ? normalizeTracking(tracking) : null;
  const current = storedStatus(normalized);
  const effective = effectiveCampaignStatus(campaign, normalized);
  const withdrawn = effective === 'withdrawn';
  const editable = canWrite && !withdrawn;

  const targets = CAMPAIGN_STATUSES.filter((s) => s !== current);
  const [to, setTo] = useState<CampaignStatus>(targets[0] ?? 'active');
  const [reasonCode, setReasonCode] = useState('');
  const [detail, setDetail] = useState('');
  const [originQuery, setOriginQuery] = useState('');
  const [originId, setOriginId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () => duplicateCandidates(campaign, campaigns, statuses),
    [campaign, campaigns, statuses],
  );
  const visibleCandidates = useMemo(() => {
    const q = originQuery.trim().toLowerCase();
    const list = q
      ? candidates.filter((c) => c.name.toLowerCase().includes(q))
      : candidates;
    return list.slice(0, 200);
  }, [candidates, originQuery]);
  const referencedBy = useMemo(
    () => duplicatesOf(campaign.id, trackingList),
    [campaign.id, trackingList],
  );

  const validation = validateStatusChange({
    campaign,
    current,
    to,
    reasonCode,
    reasonDetail: detail,
    duplicateOfCampaignId: to === 'duplicate' ? originId : null,
    candidates,
    referencedBy,
  });
  const admiraWarning = needsAdmiraWithdrawal(current, to, normalized);
  const history = [...(normalized?.statusHistory ?? [])].reverse();
  const origin =
    current === 'duplicate' && normalized?.duplicateOfCampaignId
      ? (campaigns.find((c) => c.id === normalized.duplicateOfCampaignId)
          ?.name ??
        normalized.duplicateOfCampaignName ??
        normalized.duplicateOfCampaignId)
      : null;

  function pickTarget(next: CampaignStatus) {
    setTo(next);
    setReasonCode('');
    setError(null);
  }

  async function save() {
    if (!editable || saving || validation) return;
    const reason = buildStatusReason(to, reasonCode, detail);
    if (!reason) return;
    const originCampaign =
      to === 'duplicate' ? campaigns.find((c) => c.id === originId) : null;
    setSaving(true);
    setError(null);
    try {
      const updated = await changeCampaignStatus({
        campaignId: campaign.id,
        campaignNameKey: campaignIdentity(campaign),
        campaignName: campaign.name,
        change: {
          to,
          reason,
          duplicateOf: originCampaign
            ? {
                campaignId: originCampaign.id,
                campaignName: originCampaign.name,
              }
            : null,
        },
        classification,
        linkValid,
        actor,
      });
      onSaved(updated);
    } catch (e) {
      setError(
        e instanceof TrackingError
          ? e.message
          : `No se pudo cambiar el estado de "${campaign.name}".`,
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-status-title"
    >
      <div
        className="modal__backdrop"
        aria-hidden="true"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div className="modal__card campaign-status">
        <h2 className="modal__title" id="campaign-status-title">
          Estado de “{campaign.name}”
        </h2>

        <div className="campaign-status__current">
          <CampaignStatusBadge status={effective} />
          <span className="text-muted">
            {formatCivilString(campaign.fechaInicio)} –{' '}
            {formatCivilString(campaign.fechaFin)}
          </span>
        </div>
        {normalized?.statusReason && current !== 'active' && (
          <p className="campaign-status__reason">
            <strong>Motivo:</strong>{' '}
            {formatStatusReason(normalized.statusReason)}
            {origin && (
              <>
                {' '}
                · <strong>Original:</strong> {origin}
              </>
            )}
          </p>
        )}
        {withdrawn && (
          <p className="campaign-status__note">
            Liverpool la quitó de su calendario: el estado lo pone la
            importación y no se edita a mano. Si la vuelve a subir, se reactiva
            sola.
          </p>
        )}

        {editable && (
          <section className="campaign-status__form">
            <fieldset className="campaign-status__targets">
              <legend>Nuevo estado</legend>
              {targets.map((s) => (
                <label key={s} className="campaign-status__target">
                  <input
                    type="radio"
                    name="campaign-status-to"
                    value={s}
                    checked={to === s}
                    disabled={saving}
                    onChange={() => pickTarget(s)}
                  />
                  <span>
                    <strong>
                      {s === 'active'
                        ? 'Reactivar'
                        : EFFECTIVE_STATUS_LABELS[s]}
                    </strong>
                    <small className="text-muted">{STATUS_HELP[s]}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <label className="campaign-status__field">
              <span>
                {to === 'active' ? 'Motivo de la reactivación' : 'Motivo'}
              </span>
              <select
                value={reasonCode}
                disabled={saving}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                <option value="">— Selecciona —</option>
                {STATUS_REASONS[to].map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {reasonCode !== '' && (
              <label className="campaign-status__field">
                <span>
                  {reasonCode === OTHER_REASON_CODE
                    ? 'Describe el motivo'
                    : 'Detalle (opcional)'}
                </span>
                <textarea
                  rows={3}
                  value={detail}
                  disabled={saving}
                  placeholder={
                    reasonCode === OTHER_REASON_CODE
                      ? 'Escribe el motivo…'
                      : 'Información adicional… (opcional)'
                  }
                  onChange={(e) => setDetail(e.target.value)}
                />
              </label>
            )}

            {to === 'duplicate' && (
              <div className="campaign-status__field">
                <span>Campaña original</span>
                <input
                  type="search"
                  placeholder="Buscar campaña…"
                  aria-label="Buscar campaña original"
                  value={originQuery}
                  disabled={saving}
                  onChange={(e) => setOriginQuery(e.target.value)}
                />
                <select
                  size={6}
                  aria-label="Campaña original"
                  value={originId ?? ''}
                  disabled={saving}
                  onChange={(e) => setOriginId(e.target.value || null)}
                >
                  {visibleCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {formatCivilString(c.fechaInicio)} –{' '}
                      {formatCivilString(c.fechaFin)}
                    </option>
                  ))}
                </select>
                {candidates.length === 0 && (
                  <small className="text-muted">
                    No hay campañas vigentes que puedan ser la original.
                  </small>
                )}
              </div>
            )}

            {admiraWarning && (
              <div className="occ-warning" role="status">
                <span aria-hidden="true">⚠️</span>
                <span>
                  Esta campaña ya tiene marcada la{' '}
                  <strong>Programación CSM</strong>. SIGNAM la saca de los CSV,
                  pero <strong>no puede desprogramarla en Admira</strong>:
                  retírala manualmente en Admira.
                </span>
              </div>
            )}

            {error && (
              <div className="catalog__error" role="alert">
                {error}
              </div>
            )}
          </section>
        )}

        <section className="campaign-status__history">
          <h3>Historial de estados</h3>
          {history.length === 0 ? (
            <p className="text-muted">Sin cambios de estado.</p>
          ) : (
            <ul>
              {history.map((event) => (
                <li key={event.id}>
                  <p>
                    {EFFECTIVE_STATUS_LABELS[event.from]} →{' '}
                    <strong>{EFFECTIVE_STATUS_LABELS[event.to]}</strong> ·{' '}
                    {formatStatusReason(event.reason)}
                    {event.duplicateOfCampaignName && (
                      <> · Original: {event.duplicateOfCampaignName}</>
                    )}
                  </p>
                  <small className="text-muted">
                    {event.byEmail || 'usuario desconocido'} ·{' '}
                    {formatStamp(event.at)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            {editable ? 'Cancelar' : 'Cerrar'}
          </button>
          {editable && (
            <button
              type="button"
              className={
                to === 'active' || to === 'paused'
                  ? 'btn btn-primary'
                  : 'btn btn-danger'
              }
              onClick={() => void save()}
              disabled={saving || validation !== null}
              title={validation ?? undefined}
              aria-busy={saving}
            >
              {saving
                ? 'Guardando…'
                : to === 'active'
                  ? 'Confirmar reactivación'
                  : `Marcar como ${EFFECTIVE_STATUS_LABELS[to].toLowerCase()}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
