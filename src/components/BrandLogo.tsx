import logoUrl from '@/assets/brand/instore-media.png';

/**
 * Logotipo corporativo de in-Store Media (lockup horizontal: icono + wordmark).
 *
 * El asset original es el PNG blanco autorizado (`assets/brand/instore-media.png`).
 * Para poder usarlo tanto en blanco sobre el sidebar azul como en azul sobre
 * superficies blancas SIN redibujar ni deformar la marca, se pinta como
 * máscara CSS: la silueta del logo se conserva exacta y solo cambia el color de
 * relleno según la superficie. Así un único asset sirve ambas variantes y se
 * mantiene el original intacto.
 */
export type BrandLogoVariant = 'white' | 'brand' | 'current';

const FILL: Record<BrandLogoVariant, string> = {
  white: '#ffffff',
  brand: 'var(--color-primary)',
  current: 'currentColor',
};

/** Proporción original del lockup (px del PNG): 242 × 51. */
const ASPECT = 242 / 51;

export interface BrandLogoProps {
  /** Color de relleno según la superficie donde se muestra. */
  variant?: BrandLogoVariant;
  /** Altura del logo en píxeles (el ancho se calcula por la proporción). */
  height?: number;
  /** Texto alternativo accesible. */
  label?: string;
  className?: string;
}

export function BrandLogo({
  variant = 'white',
  height = 28,
  label = 'in-Store Media',
  className,
}: BrandLogoProps) {
  return (
    <span
      role="img"
      aria-label={label}
      className={className}
      style={{
        display: 'inline-block',
        height,
        width: height * ASPECT,
        backgroundColor: FILL[variant],
        WebkitMaskImage: `url(${logoUrl})`,
        maskImage: `url(${logoUrl})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'left center',
        maskPosition: 'left center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}
