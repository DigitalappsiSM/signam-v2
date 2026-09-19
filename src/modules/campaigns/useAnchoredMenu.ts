import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import { computeMenuPlacement, type MenuPlacement } from './menuPlacement';

/**
 * Menú anclado a un botón de la fila: calcula la posición con
 * `computeMenuPlacement`, cierra con Escape o clic fuera y se cierra —en vez de
 * recolocarse— al desplazar o redimensionar, que es preferible a dejar el panel
 * desalineado.
 */
export function useAnchoredMenu(options: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuWidth: number;
  estimatedHeight: number;
}): {
  btnRef: RefObject<HTMLButtonElement>;
  panelRef: RefObject<HTMLDivElement>;
  placement: MenuPlacement | null;
  style: CSSProperties;
} {
  const { open, onOpenChange, menuWidth, estimatedHeight } = options;
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);

  const reposition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPlacement(
      computeMenuPlacement({
        anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menuWidth,
        estimatedHeight,
      }),
    );
  }, [menuWidth, estimatedHeight]);

  useLayoutEffect(() => {
    if (open) reposition();
    else setPlacement(null);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const close = () => onOpenChange(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        btnRef.current?.focus();
      }
    };
    const onPointerDown = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onOpenChange]);

  const style: CSSProperties = placement
    ? {
        left: placement.left,
        ...(placement.top !== undefined ? { top: placement.top } : {}),
        ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
        ...(placement.maxHeight ? { maxHeight: placement.maxHeight } : {}),
        // El panel se alinea al borde derecho del botón; escala desde esa
        // esquina, arriba o abajo según hacia dónde abra.
        transformOrigin: placement.openUp ? 'bottom right' : 'top right',
      }
    : { visibility: 'hidden' };

  return { btnRef, panelRef, placement, style };
}
