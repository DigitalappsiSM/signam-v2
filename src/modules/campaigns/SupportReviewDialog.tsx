import { useMemo, useState } from 'react';
import type { AdmiraScreen } from '@/domain';
import type { EkonAssignment } from '@/domain/ekon';
import { saveSupportOverride } from '@/services/campaignSupportOverrides';
import type { StoredCampaign } from './campaignDiff';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import {
  buildEkonSupports,
  calendarFingerprint,
  detectSupportDiscrepancies,
  ekonFingerprint,
  type CampaignSupportOverride,
  type SupportOverrideDecision,
  type SupportReviewState,
  SUPPORT_REVIEW_LABELS,
} from './supportOverride';

const DECISION_LABELS: Record<SupportOverrideDecision, string> = {
  ekon: 'Usar Ekon',
  calendar: 'Mantener calendario',
};

function formatStamp(at: number): string {
  return new Date(at).toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

/**
 * Confirmación Calendario ↔ Ekon de una campaña: muestra las tiendas cuyo
 * soporte difiere, cómo quedaría «Usar Ekon» (con selector cuando el circuito
 * admite varios soportes en esa tienda) y el historial. Motivo obligatorio.
 */
export function SupportReviewDialog({
  campaign,
  state,
  assignments,
  ekonNumber,
  screens,
  override,
  canConfirm,
  actor,
  onSaved,
  onClose,
}: {
  /** La campaña tal como viene del CALENDARIO (sin confirmaciones aplicadas). */
  campaign: StoredCampaign;
  state: SupportReviewState;
  assignments: readonly EkonAssignment[] | undefined;
  ekonNumber: number | null;
  screens: readonly AdmiraScreen[];
  override: CampaignSupportOverride | undefined;
  canConfirm: boolean;
  actor: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => assignments ?? [], [assignments]);
  const discrepancies = useMemo(
    () => detectSupportDiscrepancies(campaign, rows),
    [campaign, rows],
  );
  const preview = useMemo(
    () => buildEkonSupports(campaign, rows, screens, choices),
    [campaign, rows, screens, choices],
  );
  const history = [...(override?.history ?? [])].reverse();

  const ekonBlocked =
    preview.pending.length > 0
      ? 'Elige el soporte de cada tienda marcada antes de usar Ekon.'
      : preview.supports.length === 0
        ? 'Ekon no trae tiendas para esta vigencia.'
        : null;

  async function save(decision: SupportOverrideDecision) {
    setSaving(true);
    setError(null);
    try {
      await saveSupportOverride(
        {
          campaignId: campaign.id,
          campaignName: campaign.name,
          decision,
          supports: decision === 'ekon' ? preview.supports : [],
          reason,
          ekonNumber,
          calendarFingerprint: calendarFingerprint(campaign),
          ekonFingerprint: ekonFingerprint(campaign, rows),
        },
        actor,
      );
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
      setSaving(false);
    }
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="support-review-title"
    >
      <div
        className="modal__backdrop"
        aria-hidden="true"
        onClick={() => {
          if (!saving) onClose();
        }}
      />
      <div className="modal__card campaign-status" style={{ maxWidth: 760 }}>
        <h2 className="modal__title" id="support-review-title">
          Soportes de “{campaign.name}”: Calendario vs Ekon
        </h2>
        <p className="text-muted" style={{ marginTop: 0 }}>
          Ekon {ekonNumber ?? '—'} · {formatCivilString(campaign.fechaInicio)} –{' '}
          {formatCivilString(campaign.fechaFin)}
          {state !== 'none' && (
            <>
              {' '}
              ·{' '}
              <span
                className={
                  state === 'confirmed'
                    ? 'badge badge-info'
                    : 'badge badge-warning'
                }
              >
                {SUPPORT_REVIEW_LABELS[state]}
              </span>
            </>
          )}
        </p>

        {override && (
          <p className="campaign-status__reason">
            <strong>Decisión vigente:</strong>{' '}
            {DECISION_LABELS[override.decision]} · {override.reason}
          </p>
        )}

        {!assignments ? (
          <p className="text-muted">
            Asignaciones Ekon no disponibles todavía (cargando o sin acceso a
            Ekon).
          </p>
        ) : discrepancies.length === 0 ? (
          <p className="text-muted">
            El calendario y Ekon coinciden tienda por tienda.
          </p>
        ) : (
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Tienda</th>
                <th>Calendario Liverpool</th>
                <th>Ekon</th>
              </tr>
            </thead>
            <tbody>
              {discrepancies.map((d) => (
                <tr key={d.storeNumber}>
                  <td>
                    #{d.storeNumber}{' '}
                    {d.ekon.names[0] ?? d.liverpool.names[0] ?? ''}
                  </td>
                  <td>{d.liverpool.supports.join(', ') || '— (no está)'}</td>
                  <td>{d.ekon.circuits.join(', ') || '— (no está)'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {assignments && (
          <section className="campaign-status__form">
            <h3 style={{ margin: '0.5rem 0' }}>Si se usa Ekon quedaría</h3>
            {preview.supports.length === 0 && preview.pending.length === 0 ? (
              <p className="text-muted">
                Ekon no trae tiendas para esta vigencia.
              </p>
            ) : (
              <ul>
                {preview.supports.map((s) => (
                  <li key={s.support}>
                    <strong>{s.support}</strong>:{' '}
                    {s.stores.length === 0
                      ? 'sin lista de tiendas (se conserva del calendario)'
                      : s.stores
                          .map((st) => `${st.numero} ${st.nombre ?? ''}`.trim())
                          .join(' · ')}
                  </li>
                ))}
              </ul>
            )}
            {preview.pending.map((p) => (
              <label key={p.key} className="campaign-status__field">
                <span>
                  #{p.storeNumber} {p.storeName} · {p.circuit}: ¿qué soporte?
                </span>
                <select
                  value={choices[p.key] ?? ''}
                  disabled={saving || !canConfirm}
                  onChange={(e) =>
                    setChoices((c) => ({ ...c, [p.key]: e.target.value }))
                  }
                >
                  <option value="">— Selecciona —</option>
                  {p.candidates.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ))}

            {canConfirm && (
              <label className="campaign-status__field">
                <span>Motivo</span>
                <textarea
                  rows={2}
                  value={reason}
                  disabled={saving}
                  placeholder="Ej. el calendario trae Mupi y se pautó en Banner (Ekon correcto)"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            {error && (
              <div className="catalog__error" role="alert">
                {error}
              </div>
            )}
          </section>
        )}

        <section className="campaign-status__history">
          <h3>Historial</h3>
          {history.length === 0 ? (
            <p className="text-muted">Sin confirmaciones.</p>
          ) : (
            <ul>
              {history.map((h) => (
                <li key={h.at}>
                  <p>
                    <strong>{DECISION_LABELS[h.decision]}</strong> · {h.reason}
                    {h.decision === 'ekon' && h.supports.length > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        {h.supports
                          .map((s) => `${s.support} (${s.stores.length})`)
                          .join(', ')}
                      </>
                    )}
                  </p>
                  <small className="text-muted">
                    {h.by || 'usuario desconocido'} · {formatStamp(h.at)}
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
            {canConfirm ? 'Cancelar' : 'Cerrar'}
          </button>
          {canConfirm && assignments && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void save('calendar')}
                disabled={saving || reason.trim() === ''}
                title={
                  reason.trim() === '' ? 'El motivo es obligatorio' : undefined
                }
              >
                Mantener calendario
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void save('ekon')}
                disabled={
                  saving || reason.trim() === '' || ekonBlocked !== null
                }
                title={
                  reason.trim() === ''
                    ? 'El motivo es obligatorio'
                    : (ekonBlocked ?? undefined)
                }
                aria-busy={saving}
              >
                {saving ? 'Guardando…' : 'Usar Ekon'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
