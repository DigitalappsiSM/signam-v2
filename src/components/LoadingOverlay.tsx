import { LoadingState, type LoadingVariant } from './LoadingState';
import './LoadingOverlay.css';

interface LoadingOverlayProps {
  variant?: LoadingVariant;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Estado de carga a **pantalla completa**: superpone un velo con desenfoque
 * (`backdrop-filter`) sobre toda la vista y centra el GIF de carga en grande,
 * dentro de una tarjeta translúcida. Al cubrir el viewport con
 * `position: fixed` no altera el layout de las secciones y **bloquea la
 * interacción** con el fondo mientras dura la espera.
 *
 * Reutiliza `LoadingState` (mismos GIFs, posters y semántica accesible), así
 * que el `role="status"` y los textos viven en un único nodo.
 */
export function LoadingOverlay({
  variant = 'process',
  title,
  description,
  className = '',
}: LoadingOverlayProps) {
  const classes = ['loading-overlay', className].filter(Boolean).join(' ');

  return (
    <div className={classes} data-loading-overlay="true">
      <div className="loading-overlay__panel">
        <LoadingState
          variant={variant}
          title={title}
          description={description}
        />
      </div>
    </div>
  );
}
