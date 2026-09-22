import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import type { FilterChip } from './filterChips';
import './FilterBar.css';

/**
 * Barra de filtros unificada de SIGNAM. Mismo aspecto y efectos en todas las
 * secciones: campos con etiqueta visible y altura fija, estado "con valor"
 * resaltado, contador de filtros activos, botón «Limpiar filtros» y chips para
 * quitar cada filtro por separado.
 *
 * Es solo presentación: cada página conserva su estado y su lógica de filtrado
 * y describe aquí qué está aplicado mediante `chips`.
 *
 * Con `sticky` (por defecto) la barra queda fija bajo la topbar al hacer
 * scroll; al despegarse pasa a vidrio con sombra. En pantallas estrechas los
 * campos (salvo la búsqueda) se recogen tras el botón «Filtros».
 */

/** Altura de la topbar fija (`.topbar` en AppLayout.css). */
const TOPBAR_OFFSET = 64;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
    return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function FilterBar({
  label,
  chips = [],
  onClear,
  sticky = true,
  extra,
  className,
  children,
}: {
  /** Nombre accesible del grupo de filtros. */
  label: string;
  /** Filtros aplicados (uno por chip). Su número alimenta el contador. */
  chips?: FilterChip[];
  /** Restablece todos los filtros. Sin él no se muestra «Limpiar filtros». */
  onClear?: () => void;
  sticky?: boolean;
  /** Contenido auxiliar a la derecha (conteo de resultados, acciones). */
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  const [open, setOpen] = useState(false);
  const count = chips.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!sticky || !el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        // Solo "despegada" cuando el centinela salió por arriba (no por abajo).
        setStuck(
          !entry.isIntersecting &&
            entry.boundingClientRect.top <= TOPBAR_OFFSET,
        );
      },
      { rootMargin: `-${TOPBAR_OFFSET}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sticky]);

  const classes = [
    'fb',
    sticky && 'fb--sticky',
    stuck && 'is-stuck',
    open && 'is-open',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      {sticky && (
        <div ref={sentinelRef} className="fb-sentinel" aria-hidden="true" />
      )}
      <section className={classes} role="group" aria-label={label}>
        <div className="fb__row">
          {children}
          <button
            type="button"
            className="fb__toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Icon name="filter" size={16} />
            Filtros
            {count > 0 && (
              <span key={count} className="fb-count__n">
                {count}
              </span>
            )}
          </button>
          {(count > 0 || extra) && (
            <div className="fb__tail">
              {extra}
              {count > 0 && (
                <span className="fb-count">
                  <span key={count} className="fb-count__n">
                    {count}
                  </span>
                  {count === 1 ? 'filtro activo' : 'filtros activos'}
                </span>
              )}
              {count > 0 && onClear && (
                <button type="button" className="fb-clear" onClick={onClear}>
                  <Icon name="rotate-ccw" size={14} />
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </div>
        {count > 0 && <FilterChips chips={chips} />}
      </section>
    </>
  );
}

/** Chips de filtros aplicados; cada uno se quita con su botón ✕. */
function FilterChips({ chips }: { chips: FilterChip[] }) {
  const [leaving, setLeaving] = useState<string[]>([]);
  // Al terminar la animación de salida se usa el `onRemove` del último render:
  // el del clic puede haber capturado un estado ya desactualizado.
  const latest = useRef(chips);
  latest.current = chips;

  function remove(chip: FilterChip) {
    if (prefersReducedMotion()) {
      chip.onRemove();
      return;
    }
    setLeaving((l) => [...l, chip.key]);
    window.setTimeout(() => {
      setLeaving((l) => l.filter((k) => k !== chip.key));
      latest.current.find((c) => c.key === chip.key)?.onRemove();
    }, 150);
  }

  return (
    <div className="fb-chips" aria-label="Filtros aplicados">
      <span className="fb-chips__lead">Aplicados:</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`fb-chip${leaving.includes(chip.key) ? ' is-leaving' : ''}`}
        >
          <span>
            {chip.label}: <b>{chip.value}</b>
          </span>
          <button
            type="button"
            className="fb-chip__x"
            aria-label={`Quitar filtro ${chip.label}`}
            onClick={() => remove(chip)}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Campo genérico de la barra: etiqueta visible + contenedor `fb-control`.
 * `children` recibe el `id` que enlaza la etiqueta con el control.
 */
export function FilterField({
  label,
  active,
  wide,
  className,
  children,
}: {
  label: string;
  active: boolean;
  /** Ocupa el ancho sobrante (búsquedas). */
  wide?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  const fieldClass = [
    'fb-field',
    wide && 'fb-field--wide',
    active && 'is-set',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={fieldClass}>
      <label className="fb-field__label" htmlFor={id}>
        {label}
      </label>
      <div className={`fb-control${active ? ' is-set' : ''}`}>
        {children(id)}
      </div>
    </div>
  );
}

export function FilterSearch({
  label,
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const id = useId();
  const active = value.trim() !== '';
  return (
    <div
      className={`fb-field fb-field--wide fb-field--search${active ? ' is-set' : ''}`}
    >
      <label className="fb-field__label" htmlFor={id}>
        {label}
      </label>
      <div
        className={`fb-control fb-control--search${active ? ' is-set' : ''}`}
      >
        <Icon name="search" size={16} className="fb-control__icon" />
        <input
          id={id}
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
        />
        {value !== '' && (
          <button
            type="button"
            className="fb-control__clear"
            aria-label={`Borrar «${label}»`}
            onClick={() => onChange('')}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  active,
  ariaLabel,
  disabled,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Por defecto: valor distinto de vacío. */
  active?: boolean;
  ariaLabel?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <FilterField label={label} active={active ?? value !== ''}>
      {(id) => (
        <>
          <select
            id={id}
            value={value}
            aria-label={ariaLabel}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          >
            {children}
          </select>
          <Icon name="chevron-down" size={14} className="fb-control__chev" />
        </>
      )}
    </FilterField>
  );
}

export function FilterDate({
  label,
  value,
  onChange,
  min,
  max,
  active,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  active?: boolean;
  ariaLabel?: string;
}) {
  return (
    <FilterField label={label} active={active ?? value !== ''}>
      {(id) => (
        <input
          id={id}
          type="date"
          value={value}
          min={min || undefined}
          max={max || undefined}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FilterField>
  );
}

/** Casilla booleana con la misma altura y efectos que el resto de campos. */
export function FilterCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="fb-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
