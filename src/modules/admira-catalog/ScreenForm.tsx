import { useState, type FormEvent } from 'react';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreenOriginal } from '@/domain';
import { validateQuividiLocation } from '@/services/quividi';
import { emptyOriginal } from './screenFactory';
import './CatalogPage.css';

/**
 * Formulario modal para crear o editar una pantalla del catálogo. Muestra los
 * 12 campos oficiales del maestro en su orden autoritativo, más los metadatos
 * SIGNAM de normalización Liverpool y vínculo Quividi.
 */
export function ScreenForm({
  title,
  initial,
  initialCalendarSupport = '',
  initialQuividiCameraName = '',
  initialQuividiLocationId = null,
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: AdmiraScreenOriginal;
  initialCalendarSupport?: string;
  initialQuividiCameraName?: string;
  initialQuividiLocationId?: number | null;
  submitting: boolean;
  onSubmit: (
    original: AdmiraScreenOriginal,
    calendarSupport: string,
    quividiCameraName: string,
    quividiLocationId: number | null,
  ) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AdmiraScreenOriginal>(
    initial ?? emptyOriginal(),
  );
  const [calendarSupport, setCalendarSupport] = useState(
    initialCalendarSupport,
  );
  const [quividiCameraName, setQuividiCameraName] = useState(
    initialQuividiCameraName,
  );
  const [locationIdText, setLocationIdText] = useState(
    initialQuividiLocationId == null ? '' : String(initialQuividiLocationId),
  );
  const [validatedLocationId, setValidatedLocationId] = useState<number | null>(
    initialQuividiLocationId,
  );
  const [validating, setValidating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(
    initialQuividiLocationId && initialQuividiCameraName
      ? 'ID ' + initialQuividiLocationId + ' · ' + initialQuividiCameraName
      : null,
  );

  const busy = submitting || validating;

  function parsedLocationId(): number | null {
    const text = locationIdText.trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  async function validateLocation(): Promise<{
    id: number;
    name: string;
  } | null> {
    const id = parsedLocationId();
    if (id === null) {
      setLocationError('El Location ID debe ser un entero positivo.');
      setLocationNotice(null);
      return null;
    }

    setValidating(true);
    setLocationError(null);
    try {
      const location = await validateQuividiLocation(id);
      setValidatedLocationId(location.id);
      setQuividiCameraName(location.name);
      setLocationNotice(
        'Validada: ID ' +
          location.id +
          ' · ' +
          location.name +
          (location.active ? '' : ' · inactiva en Quividi'),
      );
      return { id: location.id, name: location.name };
    } catch {
      setValidatedLocationId(null);
      setLocationNotice(null);
      setLocationError(
        'No se encontró ese Location ID en Quividi o no fue posible validarlo.',
      );
      return null;
    } finally {
      setValidating(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const text = locationIdText.trim();
    if (!text) {
      onSubmit(values, calendarSupport, quividiCameraName, null);
      return;
    }

    const id = parsedLocationId();
    if (id === null) {
      setLocationError('El Location ID debe ser un entero positivo.');
      return;
    }

    let canonicalName = quividiCameraName;
    if (validatedLocationId !== id) {
      const location = await validateLocation();
      if (!location) return;
      canonicalName = location.name;
    }

    onSubmit(values, calendarSupport, canonicalName, id);
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

        <div className="screen-form__quividi">
          <div className="screen-form__quividi-title">
            <strong>Vínculo Quividi</strong>
            <span>
              El Location ID es la referencia estable; el alias se sincroniza al
              validarlo.
            </span>
          </div>

          <div className="screen-form__quividi-row">
            <label className="screen-form__field">
              <span>QUIVIDI LOCATION ID</span>
              <input
                type="text"
                inputMode="numeric"
                value={locationIdText}
                disabled={busy}
                placeholder="Ej. 184"
                onChange={(e) => {
                  setLocationIdText(e.target.value);
                  setValidatedLocationId(null);
                  setLocationNotice(null);
                  setLocationError(null);
                }}
              />
            </label>
            <button
              type="button"
              className="btn btn-secondary screen-form__validate"
              disabled={busy || locationIdText.trim() === ''}
              onClick={() => void validateLocation()}
            >
              {validating ? 'Validando…' : 'Validar en Quividi'}
            </button>
          </div>

          <label className="screen-form__field">
            <span>ALIAS / NOMBRE QUIVIDI</span>
            <input
              type="text"
              value={quividiCameraName}
              disabled={busy}
              readOnly={locationIdText.trim() !== ''}
              placeholder="Ej. 7 - L SANTA FE- DERECHO"
              onChange={(e) => setQuividiCameraName(e.target.value)}
            />
          </label>

          {locationNotice && (
            <div className="screen-form__validation screen-form__validation--ok">
              {locationNotice}
            </div>
          )}
          {locationError && (
            <div
              className="screen-form__validation screen-form__validation--error"
              role="alert"
            >
              {locationError}
            </div>
          )}
        </div>

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
