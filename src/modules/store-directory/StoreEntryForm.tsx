import { useState, type FormEvent } from 'react';
import {
  MEXICAN_STATES,
  STORE_ZONES,
  type StoreDirectoryEntry,
} from '@/domain/stores';
import {
  entryFromForm,
  formValuesFrom,
  type EntryFormValues,
} from './entryForm';

/** Formulario modal para crear o corregir la ficha de una tienda. */
export function StoreEntryForm({
  previous,
  takenNumbers,
  submitting,
  onSubmit,
  onCancel,
}: {
  previous: StoreDirectoryEntry | null;
  takenNumbers: ReadonlySet<string>;
  submitting: boolean;
  onSubmit: (entry: StoreDirectoryEntry) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<EntryFormValues>(() =>
    formValuesFrom(previous),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmedWarnings, setConfirmedWarnings] = useState(false);

  const set = (key: keyof EntryFormValues) => (value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setConfirmedWarnings(false);
  };

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = entryFromForm(values, previous, takenNumbers);
    if (!result.ok) {
      setErrors(result.errors);
      setWarnings([]);
      return;
    }
    setErrors([]);
    if (result.warnings.length > 0 && !confirmedWarnings) {
      setWarnings(result.warnings);
      setConfirmedWarnings(true);
      return;
    }
    onSubmit(result.entry);
  }

  const text = (
    key: keyof EntryFormValues,
    label: string,
    extra: { placeholder?: string; inputMode?: 'decimal' | 'numeric' } = {},
  ) => (
    <label className="screen-form__field">
      <span>{label}</span>
      <input
        type="text"
        value={values[key]}
        disabled={submitting || (key === 'storeNumber' && previous !== null)}
        onChange={(e) => set(key)(e.target.value)}
        {...extra}
      />
    </label>
  );

  const title = previous
    ? `Tienda ${previous.storeNumber} · ${previous.name}`
    : 'Agregar tienda';

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onCancel} aria-hidden="true" />
      <form className="modal__card" onSubmit={handleSubmit}>
        <h2 className="modal__title">{title}</h2>
        <div className="screen-form__grid">
          {text('storeNumber', 'Número de tienda', { inputMode: 'numeric' })}
          {text('name', 'Nombre')}
          <label className="screen-form__field">
            <span>Estatus</span>
            <select
              value={values.status}
              disabled={submitting}
              onChange={(e) => set('status')(e.target.value)}
            >
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </label>
          <label className="screen-form__field">
            <span>Zona</span>
            <select
              value={values.zone}
              disabled={submitting}
              onChange={(e) => set('zone')(e.target.value)}
            >
              <option value="">Sin zona</option>
              {STORE_ZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
          {text('street', 'Calle y número')}
          {text('neighborhood', 'Colonia')}
          {text('municipality', 'Municipio / alcaldía')}
          <label className="screen-form__field">
            <span>Estado</span>
            <select
              value={values.state}
              disabled={submitting}
              onChange={(e) => set('state')(e.target.value)}
            >
              <option value="">Deducir del CP</option>
              {MEXICAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          {text('postalCode', 'Código postal', {
            inputMode: 'numeric',
            placeholder: 'Ej. 03100',
          })}
          <span />
          {text('lat', 'Latitud', {
            inputMode: 'decimal',
            placeholder: 'Ej. 19.4326',
          })}
          {text('lng', 'Longitud', {
            inputMode: 'decimal',
            placeholder: 'Ej. -99.1332',
          })}
        </div>
        <p className="text-muted store-dir__hint">
          Si corriges las coordenadas quedan marcadas como captura manual y una
          importación posterior no las sobrescribe.
        </p>

        {errors.length > 0 && (
          <div className="import__issues import__issues--blocking" role="alert">
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <div className="import__issues import__issues--warning" role="status">
            <ul>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <p style={{ margin: '0.35rem 0 0' }}>
              Guarda de nuevo para confirmar.
            </p>
          </div>
        )}

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
