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
    description: 'Cruza campañas Liverpool contra pantallas activas.',
  },
  {
    path: '/exportar',
    label: 'Exportación CSV',
    icon: '📤',
    description: 'Genera los CSV de programación de Admira.',
  },
  {
    path: '/historial',
    label: 'Historial',
    icon: '🕑',
    description: 'Auditoría de cambios, importaciones y exportaciones.',
  },
];
