import type { Permission } from './permissions';

/** Definición central de rutas y navegación de SIGNAM V2. */
export interface RouteMeta {
  path: string;
  label: string;
  /** Emoji usado como icono ligero en la navegación. */
  icon: string;
  description: string;
  /** Grupo de la barra lateral (secciones tipo panel analítico). */
  group: NavGroup;
  /**
   * Permiso requerido para ver la ruta en la navegación. Si se omite, la ruta
   * es visible para cualquier usuario autenticado.
   */
  permission?: Permission;
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
    path: '/usuarios',
    label: 'Usuarios y permisos',
    icon: '👥',
    description: 'Administra los usuarios y su rol (admin, operador, consulta).',
    group: 'Administración',
    permission: 'users.manage',
  },
  {
    path: '/historial',
    label: 'Historial',
    icon: '🕑',
    description: 'Auditoría de cambios, importaciones y exportaciones.',
    group: 'Administración',
  },
];

/**
 * Agrupa las rutas por sección respetando `NAV_GROUP_ORDER`. El predicado
 * opcional `canAccess` filtra rutas restringidas por permiso (por defecto se
 * incluyen todas). Los grupos sin rutas visibles se omiten.
 */
export function groupedNavRoutes(
  canAccess: (route: RouteMeta) => boolean = () => true,
): { group: NavGroup; routes: RouteMeta[] }[] {
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    routes: NAV_ROUTES.filter((r) => r.group === group && canAccess(r)),
  })).filter((g) => g.routes.length > 0);
}
