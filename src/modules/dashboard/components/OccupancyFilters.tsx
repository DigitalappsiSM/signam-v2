import {
  FilterBar,
  FilterDate,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterDate,
  formatFilterSearch,
} from '@/components/filters';
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

const CLASSIFICATION_LABELS: Record<OccupancyClassification, string> = {
  institutional: 'Institucional',
  provider: 'Proveedor',
  unknown: 'Pendiente',
};

const OWNER_LABELS: Record<Owner, string> = {
  liverpool: 'Liverpool',
  'instore-media': 'InStore Media',
};

/** Vista predeterminada del panel: Mes actual y sin filtros. */
const DEFAULT_PATCH: Partial<OccupancyFilterValues> = {
  preset: 'this-month',
  classification: 'all',
  owner: 'all',
  support: '',
  store: '',
  search: '',
};

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
  const presetLabel =
    PRESETS.find((p) => p.value === values.preset)?.label ?? values.preset;
  const chips = compactChips([
    values.preset !== 'this-month' && {
      key: 'preset',
      label: 'Periodo',
      value:
        values.preset === 'custom'
          ? `${values.desde ? formatFilterDate(values.desde) : '…'} – ${values.hasta ? formatFilterDate(values.hasta) : '…'}`
          : presetLabel,
      onRemove: () => onChange({ preset: 'this-month' }),
    },
    values.classification !== 'all' && {
      key: 'classification',
      label: 'Clasificación',
      value: CLASSIFICATION_LABELS[values.classification],
      onRemove: () => onChange({ classification: 'all' }),
    },
    values.owner !== 'all' && {
      key: 'owner',
      label: 'Propietario',
      value: OWNER_LABELS[values.owner],
      onRemove: () => onChange({ owner: 'all' }),
    },
    values.support !== '' && {
      key: 'support',
      label: 'Soporte',
      value:
        supportOptions.find((s) => s.key === values.support)?.name ??
        values.support,
      onRemove: () => onChange({ support: '' }),
    },
    values.store !== '' && {
      key: 'store',
      label: 'Tienda',
      value:
        storeOptions.find((s) => s.number === values.store)?.name ??
        values.store,
      onRemove: () => onChange({ store: '' }),
    },
    values.search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(values.search),
      onRemove: () => onChange({ search: '' }),
    },
  ]);

  return (
    <FilterBar
      label="Filtros del panel (afectan todas las secciones)"
      chips={chips}
      onClear={() => onChange(DEFAULT_PATCH)}
      extra={
        chips.length === 0 && (
          <span className="fb-note">
            Afectan tarjetas, salud operativa, alertas, gráficas y totales.
          </span>
        )
      }
    >
      <FilterSearch
        label="Buscar campaña"
        placeholder="Nombre de campaña…"
        value={values.search}
        onChange={(search) => onChange({ search })}
      />
      <FilterSelect
        label="Periodo"
        value={values.preset}
        active={values.preset !== 'this-month'}
        onChange={(preset) => onChange({ preset: preset as RangePreset })}
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </FilterSelect>

      {values.preset === 'custom' && (
        <>
          <FilterDate
            label="Desde"
            value={values.desde}
            onChange={(desde) => onChange({ desde })}
          />
          <FilterDate
            label="Hasta"
            value={values.hasta}
            min={values.desde}
            onChange={(hasta) => onChange({ hasta })}
          />
        </>
      )}

      <FilterSelect
        label="Clasificación"
        value={values.classification}
        active={values.classification !== 'all'}
        onChange={(classification) =>
          onChange({
            classification: classification as OccupancyClassification | 'all',
          })
        }
      >
        <option value="all">Todas</option>
        <option value="institutional">Institucional</option>
        <option value="provider">Proveedor</option>
        <option value="unknown">Pendiente</option>
      </FilterSelect>

      <FilterSelect
        label="Propietario"
        value={values.owner}
        active={values.owner !== 'all'}
        onChange={(owner) => onChange({ owner: owner as Owner | 'all' })}
      >
        <option value="all">Todos</option>
        <option value="liverpool">Liverpool</option>
        <option value="instore-media">InStore Media</option>
      </FilterSelect>

      <FilterSelect
        label="Soporte"
        value={values.support}
        onChange={(support) => onChange({ support })}
      >
        <option value="">Todos</option>
        {supportOptions.map((s) => (
          <option key={s.key} value={s.key}>
            {s.name}
          </option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Tienda"
        value={values.store}
        onChange={(store) => onChange({ store })}
      >
        <option value="">Todas</option>
        {storeOptions.map((s) => (
          <option key={s.number} value={s.number}>
            {s.name} · {s.number}
          </option>
        ))}
      </FilterSelect>
    </FilterBar>
  );
}
