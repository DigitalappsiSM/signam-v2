import type { ReactNode } from 'react';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from '@/components/filters';
import { LEVEL_LABELS } from '../types';
import type { OccupancyFilters as Filters, OccupancyLevel } from '../types';

const LEVELS: OccupancyLevel[] = [
  'sin-ocupacion',
  'baja-critica',
  'baja-preventiva',
  'normal',
];

const RATIO_LABELS: Record<Exclude<Filters['ratio'], ''>, string> = {
  '1': 'Ratio 1',
  '3': 'Ratio 3',
  '0': 'Sin ocupación',
};

/**
 * Filtros visuales de la tabla. No alteran los CSV completos: solo cambian lo
 * que se muestra en pantalla.
 */
export function OccupancyFilters({
  filters,
  normalizations,
  resolutions,
  onChange,
  onClear,
  summary,
}: {
  filters: Filters;
  normalizations: string[];
  resolutions: string[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  /** Conteo de unidades visibles, a la derecha de la barra. */
  summary?: ReactNode;
}) {
  const chips = compactChips([
    filters.search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(filters.search),
      onRemove: () => onChange({ search: '' }),
    },
    filters.centro.trim() !== '' && {
      key: 'centro',
      label: 'Centro',
      value: formatFilterSearch(filters.centro),
      onRemove: () => onChange({ centro: '' }),
    },
    filters.storeNumber.trim() !== '' && {
      key: 'storeNumber',
      label: 'Tienda',
      value: filters.storeNumber.trim(),
      onRemove: () => onChange({ storeNumber: '' }),
    },
    filters.normalization !== '' && {
      key: 'normalization',
      label: 'Normalización',
      value: filters.normalization,
      onRemove: () => onChange({ normalization: '' }),
    },
    filters.resolution !== '' && {
      key: 'resolution',
      label: 'Resolución',
      value: filters.resolution,
      onRemove: () => onChange({ resolution: '' }),
    },
    filters.level !== '' && {
      key: 'level',
      label: 'Nivel',
      value: LEVEL_LABELS[filters.level],
      onRemove: () => onChange({ level: '' }),
    },
    filters.ratio !== '' && {
      key: 'ratio',
      label: 'Ratio',
      value: RATIO_LABELS[filters.ratio],
      onRemove: () => onChange({ ratio: '' }),
    },
  ]);

  return (
    <FilterBar
      label="Filtros de la tabla"
      chips={chips}
      onClear={onClear}
      extra={summary}
    >
      <FilterSearch
        label="Buscar"
        placeholder="Buscar campaña o artículo…"
        ariaLabel="Buscar por campaña o artículo"
        value={filters.search}
        onChange={(search) => onChange({ search })}
      />
      <FilterSearch
        label="Centro"
        placeholder="Centro…"
        ariaLabel="Filtrar por centro"
        value={filters.centro}
        onChange={(centro) => onChange({ centro })}
      />
      <FilterSearch
        label="Tienda"
        placeholder="Número de tienda…"
        ariaLabel="Filtrar por número de tienda"
        value={filters.storeNumber}
        onChange={(storeNumber) => onChange({ storeNumber })}
      />
      <FilterSelect
        label="Normalización"
        ariaLabel="Filtrar por normalización Liverpool"
        value={filters.normalization}
        onChange={(normalization) => onChange({ normalization })}
      >
        <option value="">Toda normalización</option>
        {normalizations.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Resolución"
        ariaLabel="Filtrar por resolución"
        value={filters.resolution}
        onChange={(resolution) => onChange({ resolution })}
      >
        <option value="">Toda resolución</option>
        {resolutions.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Nivel"
        ariaLabel="Filtrar por nivel"
        value={filters.level}
        onChange={(level) => onChange({ level: level as Filters['level'] })}
      >
        <option value="">Todo nivel</option>
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {LEVEL_LABELS[l]}
          </option>
        ))}
      </FilterSelect>
      <FilterSelect
        label="Ratio"
        ariaLabel="Filtrar por ratio recomendado"
        value={filters.ratio}
        onChange={(ratio) => onChange({ ratio: ratio as Filters['ratio'] })}
      >
        <option value="">Todo ratio</option>
        <option value="1">Ratio 1</option>
        <option value="3">Ratio 3</option>
        <option value="0">Sin ocupación</option>
      </FilterSelect>
    </FilterBar>
  );
}
