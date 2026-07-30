/** Definición central de rutas y navegación de SIGNAM V2. */
export interface RouteMeta {
  path: string;
  label: string;
  /** Emoji usado como icono ligero en la navegación. */
  icon: string;
  description: string;
}

export const NAV_ROUTES: RouteMeta[] = [
  {
    path: '/',
    label: 'Panel',
    icon: '🏠',
    description: 'Resumen del estado de SIGNAM V2.',
  },
  {
    path: '/importar',
    label: 'Importar Calendario',
    icon: '📥',
    description: 'Importa y valida el Calendario de Campañas de Liverpool.',
  },
  {
    path: '/catalogo',
    label: 'Catálogo Admira',
    icon: '🗂️',
    description: 'Administra las pantallas del catálogo Admira CSM.',
  },
  {
    path: '/campanas',
    label: 'Campañas',
    icon: '📣',
    description:
      'Campañas guardadas, detalle, CSV de Admira y reporte de errores.',
  },
  {
    path: '/seguimiento',
    label: 'Seguimiento operativo',
    icon: '✅',
    description:
      'Estados, testigos, fechas límite y alertas operativas por campaña.',
  },
  {
    path: '/historial',
    label: 'Historial',
    icon: '🕑',
    description: 'Auditoría de cambios, importaciones y exportaciones.',
  },
];
