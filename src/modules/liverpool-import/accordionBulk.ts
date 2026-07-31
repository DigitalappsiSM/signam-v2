/**
 * Estado del control "Expandir/Colapsar todo" del acordeón de importación.
 *
 * `nonce` cambia en cada pulsación para forzar que las secciones reapliquen el
 * estado aunque `open` no cambie (p. ej. "Colapsar todo" dos veces seguidas
 * después de que el usuario haya abierto una sección a mano).
 */
export interface BulkState {
  open: boolean;
  nonce: number;
}

export function nextBulk(prev: BulkState | null, open: boolean): BulkState {
  return { open, nonce: (prev?.nonce ?? 0) + 1 };
}
