/** Filtro aplicado que la barra muestra como chip removible. */
export interface FilterChip {
  /** Identificador estable (clave de React y de la animación de salida). */
  key: string;
  /** Nombre del filtro, p. ej. «Resolución». */
  label: string;
  /** Valor legible aplicado, p. ej. «1080x1920». */
  value: string;
  /** Quita solo este filtro (lo devuelve a su valor por defecto). */
  onRemove: () => void;
}

/**
 * Compacta una lista de chips candidatos descartando los filtros sin aplicar
 * (`false`/`null`/`undefined`), para declararlos en línea:
 * `compactChips([search !== '' && { … }, …])`.
 */
export function compactChips(
  items: ReadonlyArray<FilterChip | false | null | undefined>,
): FilterChip[] {
  return items.filter((c): c is FilterChip => Boolean(c));
}

/** Fecha civil ISO (`aaaa-mm-dd`) → `dd/mm/aaaa`; otros valores se respetan. */
export function formatFilterDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Texto de búsqueda para el chip: recortado y entre comillas. */
export function formatFilterSearch(text: string): string {
  return `“${text.trim()}”`;
}
