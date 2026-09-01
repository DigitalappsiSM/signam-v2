import type { Permission } from './permissions';
import type { IconName } from '@/components/Icon';

/** Definición central de rutas y navegación de SIGNAM V2. */
export interface RouteMeta {
  path: string;
  label: string;
  /** Nombre del icono SVG (ver `components/Icon`) usado en la navegación. */
  icon: IconName;
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
    icon: 'dashboard',
    description: 'Resumen del estado de SIGNAM V2.',
    group: 'Operación',
  },
  {
    path: '/seguimiento',
    label: 'Seguimiento operativo',
    icon: 'activity',
    description:
      'Estados, testigos, fechas límite y alertas operativas por campaña.',
    group: 'Operación',
  },
  {
    path: '/reporting',
    label: 'Reporting',
    icon: 'activity',
    description:
      'Resumen ejecutivo, cumplimiento operativo y calidad de datos.',
    group: 'Operación',
    permission: 'reporting.read',
  },
  {
    path: '/alertas-ocupacion',
    label: 'Alertas de baja ocupación',
    icon: 'bell',
    description:
      'Detecta pantallas con baja variedad y genera CSV para Ratio 1 y Ratio 3.',
    group: 'Operación',
  },
  {
    path: '/importar',
    label: 'Importar Calendario',
    icon: 'calendar',
    description: 'Importa y valida el Calendario de Campañas de Liverpool.',
    group: 'Datos',
  },
  {
    path: '/catalogo',
    label: 'Catálogo Admira',
    icon: 'monitor',
    description: 'Administra las pantallas del catálogo Admira CSM.',
    group: 'Datos',
  },
  {
    path: '/importar-ekon',
    label: 'Importación Ekon',
    icon: 'calendar',
    description:
      'Importa la extracción Ekon, confirma periodos y revisa el diff por lote.',
    group: 'Datos',
    permission: 'ekon.import',
  },
  {
    path: '/importar-digital',
    label: 'Importación Digital',
    icon: 'calendar',
    description: 'Importa catorcenas EKON para La Comer y Chedraui.',
    group: 'Datos',
    permission: 'digitalOperations.import',
  },
  {
    path: '/operacion-digital',
    label: 'Operación Digital',
    icon: 'activity',
    description: 'Seguimiento externo multirretailer sin Admira ni testigos.',
    group: 'Operación',
    permission: 'digitalOperations.read',
  },
  {
    path: '/catalogo-digital',
    label: 'Catálogo digital',
    icon: 'monitor',
    description: 'Perfiles de retailer y soporte admitidos.',
    group: 'Administración',
    permission: 'digitalCatalog.manage',
  },
  {
    path: '/campanas',
    label: 'Campañas',
    icon: 'megaphone',
    description:
      'Campañas guardadas, detalle, CSV de Admira y reporte de errores.',
    group: 'Campañas',
  },
  {
    path: '/conciliacion',
    label: 'Conciliación',
    icon: 'activity',
    description:
      'Compara campañas Liverpool vinculadas con sus asignaciones Ekon vigentes.',
    group: 'Campañas',
    permission: 'reconciliation.read',
  },
  {
    path: '/usuarios',
    label: 'Usuarios y permisos',
    icon: 'users',
    description:
      'Administra los usuarios y su rol (admin, operador, consulta).',
    group: 'Administración',
    permission: 'users.manage',
  },
  {
    path: '/historial',
    label: 'Historial',
    icon: 'shield',
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
