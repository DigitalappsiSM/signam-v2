import type { SortState } from '@/lib/tableSort';
import './SortableTh.css';

/**
 * Encabezado de tabla ordenable: un `<th>` con botón que alterna el orden por
 * esa columna. Muestra una flecha según el estado y expone `aria-sort` para
 * accesibilidad.
 */
export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'center' | 'right';
}) {
  const active = sort.key === sortKey;
  const ariaSort = active
    ? sort.dir === 'asc'
      ? 'ascending'
      : 'descending'
    : 'none';
  const arrow = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
  return (
    <th aria-sort={ariaSort} className={className}>
      <button
        type="button"
        className={`th-sort th-sort--${align}${active ? ' th-sort--active' : ''}`}
        onClick={() => onSort(sortKey)}
      >
        <span>{label}</span>
        <span className="th-sort__arrow" aria-hidden="true">
          {arrow}
        </span>
      </button>
    </th>
  );
}
