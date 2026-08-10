import type { SVGProps } from 'react';

/**
 * Set de iconos SVG propio y ligero (sin dependencias externas), coherente en
 * trazo (2px, líneas redondeadas) y basado en `currentColor` para heredar el
 * color del contexto (sidebar, topbar, botones). Sustituye a los emojis usados
 * antes como iconos, que no eran consistentes ni accesibles.
 *
 * Uso: `<Icon name="dashboard" />`. Los iconos son decorativos por defecto
 * (`aria-hidden`); cuando acompañan a un control sin texto, la etiqueta
 * accesible debe ir en el propio control (`aria-label`).
 */
export type IconName =
  | 'dashboard'
  | 'activity'
  | 'bell'
  | 'calendar'
  | 'monitor'
  | 'megaphone'
  | 'users'
  | 'shield'
  | 'sun'
  | 'moon'
  | 'power'
  | 'menu'
  | 'close'
  | 'chevron-down'
  | 'alert-triangle'
  | 'clock'
  | 'help'
  | 'check'
  | 'check-circle'
  | 'circle-dot'
  | 'minus'
  | 'ban';

/** Contenido (`<path>`, etc.) de cada icono en un viewBox 0 0 24 24. */
const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  megaphone: (
    <>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8a4 4 0 0 1 0 8M11 6l8-3v18l-8-3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M17.5 20a5.5 5.5 0 0 0-3-4.9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z" />,
  power: (
    <>
      <path d="M12 3v9" />
      <path d="M6.5 7a8 8 0 1 0 11 0" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  'alert-triangle': (
    <>
      <path d="M12 3.5 2.5 20h19L12 3.5Z" />
      <path d="M12 10v4" />
      <path d="M12 17.5h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.7-2 2-2 3" />
      <path d="M12 17h.01" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  'circle-dot': (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  ban: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m6 6 12 12" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  name: IconName;
  /** Tamaño en píxeles (ancho y alto). Por defecto 20. */
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
