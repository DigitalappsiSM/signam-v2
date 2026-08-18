import type { UserRole } from '@/domain';

/**
 * Matriz de permisos por rol. Es la fuente de verdad en el cliente para mostrar
 * u ocultar acciones; las mismas reglas deben aplicarse en Firestore, ya que
 * ocultar botones no es suficiente.
 */
export type Permission =
  | 'catalog.read'
  | 'catalog.write'
  | 'catalog.deactivate'
  | 'calendar.import'
  | 'ekon.import'
  | 'reconciliation.read'
  | 'export.csv'
  | 'export.occupancyCsv'
  | 'tracking.read'
  | 'tracking.write'
  | 'digitalOperations.read'
  | 'digitalOperations.import'
  | 'digitalOperations.track'
  | 'digitalOperations.export'
  | 'digitalCatalog.manage'
  | 'users.manage';

// `export.occupancyCsv` lo tienen TODOS los roles a propósito: los CSV de las
// alertas de baja ocupación son 100% operativos (se generan en el navegador a
// partir de datos que cualquier usuario autenticado ya puede leer) y no
// contienen información que deba resguardarse. Es distinto de `export.csv`, que
// cubre las exportaciones de catálogo/campañas y sí queda restringido.
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'catalog.read',
    'catalog.write',
    'catalog.deactivate',
    'calendar.import',
    'ekon.import',
    'reconciliation.read',
    'export.csv',
    'export.occupancyCsv',
    'tracking.read',
    'tracking.write',
    'digitalOperations.read',
    'digitalOperations.import',
    'digitalOperations.track',
    'digitalOperations.export',
    'digitalCatalog.manage',
    'users.manage',
  ],
  operator: [
    'catalog.read',
    'calendar.import',
    'ekon.import',
    'reconciliation.read',
    'export.csv',
    'export.occupancyCsv',
    'tracking.read',
    'tracking.write',
    'digitalOperations.read',
    'digitalOperations.import',
    'digitalOperations.track',
    'digitalOperations.export',
  ],
  viewer: [
    'catalog.read',
    'reconciliation.read',
    'export.occupancyCsv',
    'tracking.read',
    'digitalOperations.read',
  ],
};

/** Indica si un rol tiene un permiso dado. */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
