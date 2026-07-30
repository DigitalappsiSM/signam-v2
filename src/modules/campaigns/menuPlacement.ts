/**
 * Cálculo puro de la posición de un menú flotante respecto a su botón ancla.
 *
 * Separado de React para poder probar la decisión de abrir hacia abajo o hacia
 * arriba sin depender de coordenadas reales del navegador. Todas las medidas
 * están en píxeles del viewport (como `getBoundingClientRect`).
 */

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface MenuPlacementInput {
  anchor: AnchorRect;
  viewport: Viewport;
  /** Ancho estimado del panel. */
  menuWidth: number;
  /** Alto estimado del panel (para decidir arriba/abajo). */
  estimatedHeight: number;
  /** Separación entre el botón y el panel. */
  gap?: number;
  /** Margen mínimo respecto a los bordes del viewport. */
  margin?: number;
}

export interface MenuPlacement {
  left: number;
  /** Definido cuando el menú abre hacia abajo (posición `top` fija). */
  top?: number;
  /** Definido cuando el menú abre hacia arriba (posición `bottom` fija). */
  bottom?: number;
  openUp: boolean;
  /** Alto máximo disponible para el panel (con scroll interno si hace falta). */
  maxHeight: number;
}

/**
 * Coloca el panel junto al botón: alineado a su borde derecho, abriendo hacia
 * abajo si hay espacio y hacia arriba en caso contrario, y siempre dentro de los
 * límites horizontales del viewport.
 */
export function computeMenuPlacement(input: MenuPlacementInput): MenuPlacement {
  const gap = input.gap ?? 4;
  const margin = input.margin ?? 8;
  const { anchor, viewport, menuWidth, estimatedHeight } = input;

  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;
  const openUp =
    spaceBelow < estimatedHeight + gap + margin && spaceAbove > spaceBelow;

  // Alinear el borde derecho del panel con el del botón, sin salir del viewport.
  const maxLeft = Math.max(margin, viewport.width - menuWidth - margin);
  const left = Math.min(Math.max(anchor.right - menuWidth, margin), maxLeft);

  if (openUp) {
    return {
      left,
      bottom: viewport.height - anchor.top + gap,
      openUp: true,
      maxHeight: Math.max(0, spaceAbove - gap - margin),
    };
  }
  return {
    left,
    top: anchor.bottom + gap,
    openUp: false,
    maxHeight: Math.max(0, spaceBelow - gap - margin),
  };
}
