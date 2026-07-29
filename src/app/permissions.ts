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
  | 'export.csv'
  | 'users.manage';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'catalog.read',
    'catalog.write',
    'catalog.deactivate',
    'calendar.import',
    'export.csv',
    'users.manage',
  ],
  operator: ['catalog.read', 'calendar.import', 'export.csv'],
  viewer: ['catalog.read'],
};

/** Indica si un rol tiene un permiso dado. */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
