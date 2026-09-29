import { useMemo, useState } from 'react';
import type { AdmiraScreen } from '@/domain';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import type { StoredCampaign } from './campaignDiff';
import {
  MANUAL_CAMPAIGN_TIPOS,
  buildManualCampaign,
  findManualDuplicates,
  manualSupportOptions,
  validateManualCampaign,
  type ManualCampaignInput,
  type ManualCampaignSupportInput,
} from './manualCampaign';
import {
  createManualCampaign,
  updateManualCampaign,
} from '@/services/campaigns';
import {
  campaignToManualInput,
  hasMarkedWitnesses,
} from './manualCampaignEdit';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import { isMupiPendonSupport } from '@/modules/consolidation/instoreEkon';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';

/**
 * Alta (o edición, con `editing`) de una campaña **manual** (sampling, proveedor…) que Liverpool no sube a
 * su calendario. Es una campaña normal de SIGNAM: consolida, genera CSV y tiene
 * seguimiento operativo completo desde su creación. Si Liverpool la sube
 * después, la importación propone adoptarla en lugar de duplicarla.
 */
export function ManualCampaignModal({
  screens,
  campaigns,
  actor,
  editing,
  tracking,
  onCreated,
  onClose,
}: {
  screens: AdmiraScreen[];
  campaigns: StoredCampaign[];
  actor: Actor;
  /** Campaña manual a editar; sin ella el modal da de alta una nueva. */
  editing?: StoredCampaign;
  /** Seguimiento de la campaña editada (para avisar si ya hay testigos). */
  tracking?: CampaignOperationalTracking | null;
  onCreated: () => Promise<void> | void;
  onClose: () => void;
}) {
  const initial = useMemo(
    () => (editing ? campaignToManualInput(editing) : null),
    [editing],
  );
  const options = useMemo(() => {
    const fromCatalog = manualSupportOptions(screens);
    // Al editar, un soporte guardado que el catálogo ya no tiene activo debe
    // seguir visible para poder quitarlo o conservarlo a propósito.
    const known = new Set(fromCatalog.map((o) => o.support));
    const extra = (initial?.supports ?? [])
      .filter((s) => !known.has(s.support))
      .map((s) => ({ support: s.support, stores: s.stores }));
    return [...fromCatalog, ...extra];
  }, [screens, initial]);
  const [name, setName] = useState(initial?.name ?? '');
  const [tipo, setTipo] = useState(initial?.tipo ?? '');
  const [fechaInicio, setFechaInicio] = useState(initial?.fechaInicio ?? '');
  const [fechaFin, setFechaFin] = useState(initial?.fechaFin ?? '');
  const [link, setLink] = useState(initial?.link ?? '');
  const [supports, setSupports] = useState<ManualCampaignSupportInput[]>(
    initial?.supports ?? [],
  );
  const [reason, setReason] = useState('');
  const [storeFilter, setStoreFilter] = useState('');
  const [confirmedSimilar, setConfirmedSimilar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input: ManualCampaignInput = {
    vendidoPor: initial?.vendidoPor,
    name,
    tipo,
    fechaInicio,
    fechaFin,
    link,
    supports,
  };
  const errors = validateManualCampaign(input);
  const duplicates = useMemo(
    () =>
      errors.length === 0
        ? findManualDuplicates(
            buildManualCampaign(input),
            editing ? campaigns.filter((c) => c.id !== editing.id) : campaigns,
          )
        : { blocking: [], warnings: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [errors.length, name, tipo, fechaInicio, fechaFin, supports, campaigns],
  );
  const blocked = duplicates.blocking.length > 0;
  const needsConfirm = duplicates.warnings.length > 0 && !confirmedSimilar;
  const reasonMissing = !!editing && reason.trim() === '';
  const canSave =
    errors.length === 0 &&
    !blocked &&
    !needsConfirm &&
    !reasonMissing &&
    !saving;
  const witnessWarning =
    !!editing && hasMarkedWitnesses(tracking) && errors.length === 0;

  function toggleSupport(support: string) {
    setSupports((prev) =>
      prev.some((s) => s.support === support)
        ? prev.filter((s) => s.support !== support)
        : [
            ...prev,
            {
              support,
              // En Mupi/Pendón no se preselecciona nada: Ekon solo entra si la
              // persona lo elige.
              scope: isMupiPendonSupport(support) ? 'pending' : 'all',
              stores: [],
            },
          ],
    );
  }

  function patchSupport(
    support: string,
    patch: Partial<ManualCampaignSupportInput>,
  ) {
    setSupports((prev) =>
      prev.map((s) => (s.support === support ? { ...s, ...patch } : s)),
    );
  }

  function toggleStore(support: string, numero: string, nombre: string) {
    setSupports((prev) =>
      prev.map((s) => {
        if (s.support !== support) return s;
        const has = s.stores.some((st) => st.numero === numero);
        return {
          ...s,
          stores: has
            ? s.stores.filter((st) => st.numero !== numero)
            : [...s.stores, { numero, nombre }],
        };
      }),
    );
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateManualCampaign({
          campaignId: editing.id,
          campaign: { ...buildManualCampaign(input), row: editing.row },
          reason,
          actor,
        });
      } else {
        await createManualCampaign(buildManualCampaign(input), actor);
      }
      await onCreated();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : editing
            ? 'No se pudo guardar la edición.'
            : 'No se pudo crear la campaña manual.',
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={
        editing
          ? `Editar campaña manual ${editing.name}`
          : 'Nueva campaña manual'
      }
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="modal__card campaign-correction"
        style={{ maxWidth: 820 }}
      >
        <h2 className="modal__title">
          {editing ? `Editar ${editing.name}` : 'Nueva campaña manual'}
        </h2>
        {editing && (
          <p className="text-muted campaign-correction__intro">
            Cambia nombre, tipo, vigencia, soportes o tiendas. La campaña
            conserva su seguimiento y su número Ekon. Cada edición queda en el
            historial con su motivo.
          </p>
        )}
        {!editing && (
          <p className="text-muted campaign-correction__intro">
            Para campañas que Liverpool no sube a su calendario (samplings,
            proveedor). Se opera igual que cualquier campaña: consolida, genera
            CSV y tiene seguimiento con testigos y aprobaciones. Si Liverpool la
            sube después, SIGNAM te propondrá vincularla y no se duplicará.
          </p>
        )}

        <div className="campaign-correction__grid">
          <label>
            <span>Nombre de la campaña</span>
            <input
              className="catalog__search"
              value={name}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            <span>Tipo de campaña</span>
            <select
              className="catalog__search"
              value={tipo}
              disabled={saving}
              onChange={(e) => setTipo(e.target.value)}
            >
              <option value="">— Selecciona —</option>
              {MANUAL_CAMPAIGN_TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Fecha de inicio</span>
            <input
              className="catalog__search"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={fechaInicio}
              disabled={saving}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </label>
          <label>
            <span>Fecha de fin</span>
            <input
              className="catalog__search"
              type="date"
              min="2000-01-01"
              max="2100-12-31"
              value={fechaFin}
              disabled={saving}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>Link de descarga (opcional)</span>
            <input
              className="catalog__search"
              type="url"
              value={link}
              disabled={saving}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
        </div>

        <h3 style={{ marginBottom: '0.4rem' }}>Soportes y tiendas</h3>
        {options.length === 0 && (
          <p className="text-muted">
            El catálogo no tiene soportes activos mapeados al calendario.
          </p>
        )}
        <div className="manual-campaign__supports">
          {options.map((option) => {
            const selected = supports.find((s) => s.support === option.support);
            return (
              <div key={option.support} className="manual-campaign__support">
                <label>
                  <input
                    type="checkbox"
                    checked={!!selected}
                    disabled={saving}
                    onChange={() => toggleSupport(option.support)}
                  />{' '}
                  <strong>{option.support}</strong>{' '}
                  <span className="text-muted">
                    ({option.stores.length} tiendas)
                  </span>
                </label>
                {selected && (
                  <div className="manual-campaign__scope">
                    <label>
                      <input
                        type="radio"
                        name={`scope-${option.support}`}
                        checked={selected.scope === 'all'}
                        onChange={() =>
                          patchSupport(option.support, {
                            scope: 'all',
                            stores: [],
                          })
                        }
                      />{' '}
                      Todas las tiendas del soporte
                    </label>
                    {isMupiPendonSupport(option.support) && (
                      <label>
                        <input
                          type="radio"
                          name={`scope-${option.support}`}
                          checked={selected.scope === 'ekon'}
                          onChange={() =>
                            patchSupport(option.support, {
                              scope: 'ekon',
                              stores: [],
                            })
                          }
                        />{' '}
                        Sin detalle: usar las tiendas de la campaña en Ekon
                      </label>
                    )}
                    <label>
                      <input
                        type="radio"
                        name={`scope-${option.support}`}
                        checked={selected.scope === 'selected'}
                        onChange={() =>
                          patchSupport(option.support, { scope: 'selected' })
                        }
                      />{' '}
                      Tiendas específicas ({selected.stores.length})
                    </label>
                    {selected.scope === 'selected' && (
                      <>
                        <input
                          className="catalog__search"
                          placeholder="Filtrar tiendas por número o nombre…"
                          aria-label={`Filtrar tiendas de ${option.support}`}
                          value={storeFilter}
                          onChange={(e) => setStoreFilter(e.target.value)}
                        />
                        <div className="manual-campaign__stores">
                          {option.stores
                            .filter((st) =>
                              `${st.numero} ${st.nombre}`
                                .toLowerCase()
                                .includes(storeFilter.trim().toLowerCase()),
                            )
                            .map((st) => (
                              <label key={st.numero}>
                                <input
                                  type="checkbox"
                                  checked={selected.stores.some(
                                    (x) => x.numero === st.numero,
                                  )}
                                  onChange={() =>
                                    toggleStore(
                                      option.support,
                                      st.numero,
                                      st.nombre,
                                    )
                                  }
                                />{' '}
                                {st.numero} · {st.nombre || 'sin nombre'}
                              </label>
                            ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {errors.length > 0 &&
        (name || tipo || fechaInicio || supports.length) ? (
          <ul className="text-muted" aria-label="Pendientes del formulario">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        {blocked && (
          <div className="catalog__error" role="alert">
            <strong>Ya existe esta campaña.</strong> Es posible que Liverpool ya
            la haya subido; crearla duplicaría su seguimiento y CSV:
            <ul>
              {duplicates.blocking.map(({ campaign }) => (
                <li key={campaign.id}>
                  {campaign.name} · {formatCivilString(campaign.fechaInicio)} –{' '}
                  {formatCivilString(campaign.fechaFin)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!blocked && duplicates.warnings.length > 0 && (
          <div className="occ-warning" role="status">
            <div>
              <strong>Se parece a campañas existentes:</strong>
              <ul>
                {duplicates.warnings.map(({ campaign, match }) => (
                  <li key={campaign.id}>
                    {campaign.name} · {formatCivilString(campaign.fechaInicio)}{' '}
                    – {formatCivilString(campaign.fechaFin)} (
                    {match.reasons.join(', ')})
                  </li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={confirmedSimilar}
                  onChange={(e) => setConfirmedSimilar(e.target.checked)}
                />{' '}
                Confirmo que es una campaña distinta
              </label>
            </div>
          </div>
        )}

        {witnessWarning && (
          <div className="occ-warning" role="status">
            Esta campaña ya tiene testigos marcados. Si cambias tiendas o
            fechas, SIGNAM no los revalida: revisa que sigan siendo correctos.
          </div>
        )}

        {editing && (
          <label className="campaign-correction__reason">
            <span>Motivo de la edición</span>
            <textarea
              rows={2}
              value={reason}
              disabled={saving}
              placeholder="Ej. Se asignaron tiendas equivocadas en el alta"
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}

        {error && (
          <div className="catalog__error" role="alert">
            {error}
          </div>
        )}

        <div className="modal__actions">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={!canSave}
            aria-busy={saving}
          >
            {saving
              ? editing
                ? 'Guardando…'
                : 'Creando…'
              : editing
                ? 'Guardar edición'
                : 'Crear campaña manual'}
          </button>
        </div>
      </div>
    </div>
  );
}
