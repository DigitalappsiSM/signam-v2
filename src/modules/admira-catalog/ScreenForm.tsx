import { useState, type FormEvent } from 'react';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreenOriginal } from '@/domain';
import { emptyOriginal } from './screenFactory';
import './CatalogPage.css';

/**
 * Formulario modal para crear o editar una pantalla del catálogo. Muestra los
 * 12 campos oficiales del maestro en su orden autoritativo.
 */
export function ScreenForm({
  title,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial?: AdmiraScreenOriginal;
  submitting: boolean;
  onSubmit: (original: AdmiraScreenOriginal) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<AdmiraScreenOriginal>(
    initial ?? emptyOriginal(),
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(values);
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
