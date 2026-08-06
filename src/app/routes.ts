/** Definición central de rutas y navegación de SIGNAM V2. */
export interface RouteMeta {
  path: string;
  label: string;
  /** Emoji usado como icono ligero en la navegación. */
  icon: string;
  description: string;
  /** Grupo de la barra lateral (secciones tipo panel analítico). */
  group: NavGroup;
}

export type NavGroup = 'Operación' | 'Datos' | 'Campañas' | 'Administración';

/** Orden de las secciones en la barra lateral. */
export const NAV_GROUP_ORDER: NavGroup[] = [
  'Operación',
  'Datos',
  'Campañas',
  'Administración',
];

export const NAV_ROUTES: RouteMeta[] = [
  {
    path: '/',
    label: 'Panel',
    icon: '🏠',
    description: 'Resumen del estado de SIGNAM V2.',
    group: 'Operación',
  },
  {
    path: '/seguimiento',
    label: 'Seguimiento operativo',
    icon: '✅',
    description:
      'Estados, testigos, fechas límite y alertas operativas por campaña.',
    group: 'Operación',
  },
  {
    path: '/alertas-ocupacion',
    label: 'Alertas de baja ocupación',
    icon: '📉',
    description:
      'Detecta pantallas con baja variedad y genera CSV para Ratio 1 y Ratio 3.',
    group: 'Operación',
  },
  {
    path: '/importar',
    label: 'Importar Calendario',
    icon: '📥',
    description: 'Importa y valida el Calendario de Campañas de Liverpool.',
    group: 'Datos',
  },
  {
    path: '/catalogo',
    label: 'Catálogo Admira',
    icon: '🗂️',
    description: 'Administra las pantallas del catálogo Admira CSM.',
    group: 'Datos',
  },
  {
    path: '/campanas',
    label: 'Campañas',
    icon: '📣',
    description:
      'Campañas guardadas, detalle, CSV de Admira y reporte de errores.',
    group: 'Campañas',
  },
  {
    path: '/historial',
    label: 'Historial',
    icon: '🕑',
    description: 'Auditoría de cambios, importaciones y exportaciones.',
    group: 'Administración',
  },
];

/** Agrupa las rutas por sección respetando `NAV_GROUP_ORDER`. */
export function groupedNavRoutes(): { group: NavGroup; routes: RouteMeta[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    routes: NAV_ROUTES.filter((r) => r.group === group),
  })).filter((g) => g.routes.length > 0);
}
