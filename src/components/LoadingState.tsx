import botAnimation from '@/assets/loaders/signam-bot-loading.gif';
import botPoster from '@/assets/loaders/signam-bot-loading-poster.png';
import importAnimation from '@/assets/loaders/signam-ufo-import.gif';
import importPoster from '@/assets/loaders/signam-ufo-import-poster.png';
import processAnimation from '@/assets/loaders/signam-terminal-loading.gif';
import processPoster from '@/assets/loaders/signam-terminal-loading-poster.png';
import './LoadingState.css';

export type LoadingVariant = 'system' | 'import' | 'process';

interface LoadingStateProps {
  variant?: LoadingVariant;
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
}

const VARIANTS: Record<
  LoadingVariant,
  { animation: string; poster: string; title: string; description: string }
> = {
  system: {
    animation: botAnimation,
    poster: botPoster,
    title: 'Preparando SIGNAM…',
    description: 'Encendiendo píxeles y verificando la sesión.',
  },
  import: {
    animation: importAnimation,
    poster: importPoster,
    title: 'Procesando archivo…',
    description: 'Ordenando el caos operativo.',
  },
  process: {
    animation: processAnimation,
    poster: processPoster,
    title: 'Cargando información…',
    description: 'Sincronizando campañas y pantallas.',
  },
};

/** Estado de espera reutilizable con una variante visual según el contexto. */
export function LoadingState({
  variant = 'process',
  title,
  description,
  compact = false,
  className = '',
}: LoadingStateProps) {
  const meta = VARIANTS[variant];
  const classes = [
    'loading-state',
    `loading-state--${variant}`,
    compact ? 'loading-state--compact' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-loading-variant={variant}
    >
      <picture className="loading-state__visual" aria-hidden="true">
        <source media="(prefers-reduced-motion: reduce)" srcSet={meta.poster} />
        <img src={meta.animation} alt="" draggable="false" />
      </picture>
      <div className="loading-state__copy">
        <strong>{title ?? meta.title}</strong>
        <span className="loading-state__description">
          {description ?? meta.description}
        </span>
      </div>
    </div>
  );
}
