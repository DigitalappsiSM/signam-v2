import { useState, type FormEvent } from 'react';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreenOriginal } from '@/domain';
import { validateQuividiLocation } from '@/services/quividi';
import { emptyOriginal } from './screenFactory';
import './CatalogPage.css';

/**
 * Estado de un slot de cámara Quividi (Location ID + alias + validación).
 * Casi todas las pantallas solo usan el primer slot; el segundo existe para el
 * caso real de un PC que opera 2 flujos de video (2 Location ID) representado
 * por una sola fila de catálogo (p. ej. Toreo, Satélite, Mitikah, Delta).
 */
interface QuividiSlotState {
  cameraName: string;
  setCameraName: (value: string) => void;
  locationIdText: string;
  setLocationIdText: (value: string) => void;
  validatedLocationId: number | null;
  setValidatedLocationId: (value: number | null) => void;
  validating: boolean;
  setValidating: (value: boolean) => void;
  error: string | null;
  setError: (value: string | null) => void;
  notice: string | null;
  setNotice: (value: string | null) => void;
}

function useQuividiSlot(
  initialCameraName: string,
  initialLocationId: number | null,
): QuividiSlotState {
  const [cameraName, setCameraName] = useState(initialCameraName);
  const [locationIdText, setLocationIdText] = useState(
    initialLocationId == null ? '' : String(initialLocationId),
  );
  const [validatedLocationId, setValidatedLocationId] = useState<number | null>(
    initialLocationId,
  );
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    initialLocationId && initialCameraName
      ? 'ID ' + initialLocationId + ' · ' + initialCameraName
      : null,
  );

  return {
    cameraName,
    setCameraName,
    locationIdText,
    setLocationIdText,
    validatedLocationId,
    setValidatedLocationId,
    validating,
    setValidating,
    error,
    setError,
    notice,
    setNotice,
  };
}

function parsedLocationId(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Formulario modal para crear o editar una pantalla del catálogo. Muestra los
 * 12 campos oficiales del maestro en su orden autoritativo, más los metadatos
 * SIGNAM de normalización Liverpool y hasta 2 vínculos Quividi.
 */
export function ScreenForm({
  title,
  initial,
  initialCalendarSupport = '',
  initialQuividiCameraName = '',
  initialQuividiLocationId = null,
  initialQuividiCameraName2 = '',
  initialQuividiLocationId2 = null,
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: AdmiraScreenOriginal;
  initialCalendarSupport?: string;
  initialQuividiCameraName?: string;
  initialQuividiLocationId?: number | null;
  initialQuividiCameraName2?: string;
  initialQuividiLocationId2?: number | null;
  submitting: boolean;
  onSubmit: (
    original: AdmiraScreenOriginal,
    calendarSupport: string,
    quividiCameraName: string,
    quividiLocationId: number | null,
    quividiCameraName2: string,
    quividiLocationId2: number | null,
  ) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AdmiraScreenOriginal>(
    initial ?? emptyOriginal(),
  );
  const [calendarSupport, setCalendarSupport] = useState(
    initialCalendarSupport,
  );
  const slot1 = useQuividiSlot(
    initialQuividiCameraName,
    initialQuividiLocationId,
  );
  const slot2 = useQuividiSlot(
    initialQuividiCameraName2,
    initialQuividiLocationId2,
  );

  const busy = submitting || slot1.validating || slot2.validating;

  async function validateSlot(
    slot: QuividiSlotState,
    label: string,
  ): Promise<{ id: number; name: string } | null> {
    const id = parsedLocationId(slot.locationIdText);
    if (id === null) {
      slot.setError(`El Location ID de ${label} debe ser un entero positivo.`);
      slot.setNotice(null);
      return null;
    }

    slot.setValidating(true);
    slot.setError(null);
    try {
      const location = await validateQuividiLocation(id);
      slot.setValidatedLocationId(location.id);
      slot.setCameraName(location.name);
      slot.setNotice(
        'Validada: ID ' +
          location.id +
          ' · ' +
          location.name +
          (location.active ? '' : ' · inactiva en Quividi'),
      );
      return { id: location.id, name: location.name };
    } catch {
      slot.setValidatedLocationId(null);
      slot.setNotice(null);
      slot.setError(
        'No se encontró ese Location ID en Quividi o no fue posible validarlo.',
      );
      return null;
    } finally {
      slot.setValidating(false);
    }
  }

  async function resolveSlot(
    slot: QuividiSlotState,
    label: string,
  ): Promise<{ name: string; id: number | null } | null> {
    const text = slot.locationIdText.trim();
    if (!text) return { name: slot.cameraName, id: null };

    const id = parsedLocationId(text);
    if (id === null) {
      slot.setError(`El Location ID de ${label} debe ser un entero positivo.`);
      return null;
    }

    let canonicalName = slot.cameraName;
    if (slot.validatedLocationId !== id) {
      const location = await validateSlot(slot, label);
      if (!location) return null;
      canonicalName = location.name;
    }
    return { name: canonicalName, id };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const resolved1 = await resolveSlot(slot1, 'la cámara 1');
    if (!resolved1) return;
    const resolved2 = await resolveSlot(slot2, 'la cámara 2');
    if (!resolved2) return;

    onSubmit(
      values,
      calendarSupport,
      resolved1.name,
      resolved1.id,
      resolved2.name,
      resolved2.id,
    );
  }

  function quividiFields(
    slot: QuividiSlotState,
    slotTitle: string,
    hint: string,
  ) {
    return (
      <div className="screen-form__quividi">
        <div className="screen-form__quividi-title">
          <strong>{slotTitle}</strong>
          <span>{hint}</span>
        </div>

        <div className="screen-form__quividi-row">
          <label className="screen-form__field">
            <span>QUIVIDI LOCATION ID</span>
            <input
              type="text"
              inputMode="numeric"
              value={slot.locationIdText}
              disabled={busy}
              placeholder="Ej. 184"
              onChange={(e) => {
                slot.setLocationIdText(e.target.value);
                slot.setValidatedLocationId(null);
                slot.setNotice(null);
                slot.setError(null);
              }}
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary screen-form__validate"
            disabled={busy || slot.locationIdText.trim() === ''}
            onClick={() => void validateSlot(slot, slotTitle)}
          >
            {slot.validating ? 'Validando…' : 'Validar en Quividi'}
          </button>
        </div>

        <label className="screen-form__field">
          <span>ALIAS / NOMBRE QUIVIDI</span>
          <input
            type="text"
            value={slot.cameraName}
            disabled={busy}
            readOnly={slot.locationIdText.trim() !== ''}
            placeholder="Ej. 7 - L SANTA FE- DERECHO"
            onChange={(e) => slot.setCameraName(e.target.value)}
          />
        </label>

        {slot.notice && (
          <div className="screen-form__validation screen-form__validation--ok">
            {slot.notice}
          </div>
        )}
        {slot.error && (
          <div
            className="screen-form__validation screen-form__validation--error"
            role="alert"
          >
            {slot.error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <form
        className="modal__card"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <h2 className="modal__title">{title}</h2>
        <div className="screen-form__grid">
          {ADMIRA_CATALOG_HEADERS.map((header) => (
            <label key={header} className="screen-form__field">
              <span>{header}</span>
              <input
                type="text"
                value={values[header]}
                disabled={busy}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [header]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>

        <label className="screen-form__field screen-form__meta-field">
          <span>NORMALIZACIÓN LIVERPOOL (mapeo al calendario)</span>
          <input
            type="text"
            value={calendarSupport}
            disabled={busy}
            placeholder="Ej. VIDEO WALL CRIUS"
            onChange={(e) => setCalendarSupport(e.target.value)}
          />
        </label>

        {quividiFields(
          slot1,
          'Vínculo Quividi',
          'El Location ID es la referencia estable; el alias se sincroniza al validarlo.',
        )}

        {quividiFields(
          slot2,
          'Vínculo Quividi (cámara 2)',
          'Solo cuando un mismo equipo opera 2 flujos de video con distinto Location ID (p. ej. un PC con 2 Box ID de Quividi). Déjalo vacío si esta pantalla solo tiene una cámara.',
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {submitting ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
