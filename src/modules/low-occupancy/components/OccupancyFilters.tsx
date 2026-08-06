import { LEVEL_LABELS } from '../types';
import type { OccupancyFilters as Filters, OccupancyLevel } from '../types';

const LEVELS: OccupancyLevel[] = [
  'sin-ocupacion',
  'baja-critica',
  'baja-preventiva',
  'normal',
];

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
  active,
}: {
  filters: Filters;
  normalizations: string[];
  resolutions: string[];
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  active: boolean;
}) {
  return (
    <div className="occ-filters" role="group" aria-label="Filtros de la tabla">
      <input
        className="catalog__search"
        type="search"
        placeholder="Buscar campaña o artículo…"
        aria-label="Buscar por campaña o artículo"
        value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <input
        className="catalog__search"
        type="search"
        placeholder="Centro…"
        aria-label="Filtrar por centro"
        value={filters.centro}
        onChange={(e) => onChange({ centro: e.target.value })}
      />
      <input
        className="catalog__search"
        type="search"
        placeholder="Número de tienda…"
        aria-label="Filtrar por número de tienda"
        value={filters.storeNumber}
        onChange={(e) => onChange({ storeNumber: e.target.value })}
      />
      <label className="occ-filter">
        <span className="visually-hidden">Normalización Liverpool</span>
        <select
          aria-label="Filtrar por normalización Liverpool"
          value={filters.normalization}
          onChange={(e) => onChange({ normalization: e.target.value })}
        >
          <option value="">Toda normalización</option>
          {normalizations.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <label className="occ-filter">
        <span className="visually-hidden">Resolución</span>
        <select
          aria-label="Filtrar por resolución"
          value={filters.resolution}
          onChange={(e) => onChange({ resolution: e.target.value })}
        >
          <option value="">Toda resolución</option>
          {resolutions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label className="occ-filter">
        <span className="visually-hidden">Nivel</span>
        <select
          aria-label="Filtrar por nivel"
          value={filters.level}
          onChange={(e) =>
            onChange({ level: e.target.value as Filters['level'] })
          }
        >
          <option value="">Todo nivel</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABELS[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="occ-filter">
        <span className="visually-hidden">Ratio recomendado</span>
        <select
          aria-label="Filtrar por ratio recomendado"
          value={filters.ratio}
          onChange={(e) =>
            onChange({ ratio: e.target.value as Filters['ratio'] })
          }
        >
          <option value="">Todo ratio</option>
          <option value="1">Ratio 1</option>
          <option value="3">Ratio 3</option>
          <option value="0">Sin ocupación</option>
        </select>
      </label>
      {active && (
        <button className="btn btn-secondary" onClick={onClear}>
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
