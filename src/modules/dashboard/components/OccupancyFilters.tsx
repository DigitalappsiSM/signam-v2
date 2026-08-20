import type {
  Owner,
  OccupancyClassification,
  RangePreset,
} from '../occupancyModel';

export interface OccupancyFilterValues {
  preset: RangePreset;
  desde: string;
  hasta: string;
  classification: OccupancyClassification | 'all';
  owner: Owner | 'all';
  support: string;
  store: string;
  search: string;
}

const PRESETS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'this-week', label: 'Semana actual' },
  { value: 'next-7', label: 'Próximos 7 días' },
  { value: 'this-month', label: 'Mes actual' },
  { value: 'next-30', label: 'Próximos 30 días' },
  { value: 'custom', label: 'Rango personalizado' },
];

/** Filtros de la sección de carga operativa (controlados). */
export function OccupancyFilters({
  values,
  onChange,
  supportOptions,
  storeOptions,
}: {
  values: OccupancyFilterValues;
  onChange: (patch: Partial<OccupancyFilterValues>) => void;
  supportOptions: { key: string; name: string }[];
  storeOptions: { number: string; name: string }[];
}) {
  return (
    <div
      className="occ-filters"
      role="group"
      aria-label="Filtros del panel (afectan todas las secciones)"
    >
      <label className="occ-field">
        <span>Periodo</span>
        <select
          value={values.preset}
          onChange={(e) => onChange({ preset: e.target.value as RangePreset })}
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {values.preset === 'custom' && (
        <>
          <label className="occ-field">
            <span>Desde</span>
            <input
              type="date"
              value={values.desde}
              onChange={(e) => onChange({ desde: e.target.value })}
            />
          </label>
          <label className="occ-field">
            <span>Hasta</span>
            <input
              type="date"
              value={values.hasta}
              min={values.desde || undefined}
              onChange={(e) => onChange({ hasta: e.target.value })}
            />
          </label>
        </>
      )}

      <label className="occ-field">
        <span>Clasificación</span>
        <select
          value={values.classification}
          onChange={(e) =>
            onChange({
              classification: e.target.value as OccupancyClassification | 'all',
            })
          }
        >
          <option value="all">Todas</option>
          <option value="institutional">Institucional</option>
          <option value="provider">Proveedor</option>
          <option value="unknown">Pendiente</option>
        </select>
      </label>

      <label className="occ-field">
        <span>Propietario</span>
        <select
          value={values.owner}
          onChange={(e) => onChange({ owner: e.target.value as Owner | 'all' })}
        >
          <option value="all">Todos</option>
          <option value="liverpool">Liverpool</option>
          <option value="instore-media">InStore Media</option>
        </select>
      </label>

      <label className="occ-field">
        <span>Soporte</span>
        <select
          value={values.support}
          onChange={(e) => onChange({ support: e.target.value })}
        >
          <option value="">Todos</option>
          {supportOptions.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className="occ-field">
        <span>Tienda</span>
        <select
          value={values.store}
          onChange={(e) => onChange({ store: e.target.value })}
        >
          <option value="">Todas</option>
          {storeOptions.map((s) => (
            <option key={s.number} value={s.number}>
              {s.name} · {s.number}
            </option>
          ))}
        </select>
      </label>

      <label className="occ-field occ-field--search">
        <span>Buscar campaña</span>
        <input
          type="search"
          placeholder="Nombre de campaña…"
          value={values.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </label>
    </div>
  );
}
