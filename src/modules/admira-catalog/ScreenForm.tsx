import { useState, type FormEvent } from 'react';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreenOriginal } from '@/domain';
import { emptyOriginal } from './screenFactory';
import './CatalogPage.css';

/**
 * Formulario modal para crear o editar una pantalla del catálogo. Muestra los
 * 12 campos oficiales del maestro en su orden autoritativo, más el mapeo
 * SIGNAM al soporte del Calendario de Liverpool (metadato, no oficial).
 */
export function ScreenForm({
  title,
  initial,
  initialCalendarSupport = '',
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: AdmiraScreenOriginal;
  initialCalendarSupport?: string;
  submitting: boolean;
  onSubmit: (original: AdmiraScreenOriginal, calendarSupport: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AdmiraScreenOriginal>(
    initial ?? emptyOriginal(),
  );
  const [calendarSupport, setCalendarSupport] = useState(
    initialCalendarSupport,
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(values, calendarSupport);
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <form className="modal__card" onSubmit={handleSubmit}>
        <h2 className="modal__title">{title}</h2>
        <div className="screen-form__grid">
          {ADMIRA_CATALOG_HEADERS.map((header) => (
            <label key={header} className="screen-form__field">
              <span>{header}</span>
              <input
                type="text"
                value={values[header]}
                disabled={submitting}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [header]: e.target.value }))
                }
              />
            </label>
          ))}
        </div>

        <label
          className="screen-form__field"
          style={{ marginTop: '0.75rem', display: 'block' }}
        >
          <span>NORMALIZACIÓN LIVERPOOL (mapeo al calendario)</span>
          <input
            type="text"
            value={calendarSupport}
            disabled={submitting}
            placeholder="Ej. VIDEO WALL CRIUS"
            onChange={(e) => setCalendarSupport(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
