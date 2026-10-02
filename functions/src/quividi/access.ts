/**
 * Control de acceso del reporte de audiencia Quividi.
 *
 * Las reglas de Firestore no cubren las callables, así que el rol se valida
 * aquí. Es el espejo en backend de la capacidad `quividi.report` de
 * `src/app/permissions.ts`: si allí se restringe un rol, hay que quitarlo
 * también de `QUIVIDI_REPORT_ROLES` — ocultar el botón no es control de acceso.
 *
 * Decisión vigente: los cuatro roles pueden descargar el informe, porque es
 * material de lectura para marcas/marketing. La capacidad existe por separado
 * de `reporting.read` porque su descarga sí consume la API de pago de Quividi.
 */

/** Roles válidos. Espejo de `USER_ROLES` en `src/domain/constants.ts`. */
const ROLES = ['admin', 'operator', 'viewer', 'commercial'] as const;

export type Role = (typeof ROLES)[number];

/** Roles con la capacidad `quividi.report`. */
export const QUIVIDI_REPORT_ROLES: readonly Role[] = [
  'admin',
  'operator',
  'viewer',
  'commercial',
];

function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}

/**
 * Rol del token, con `viewer` por defecto.
 *
 * Mismo criterio que `AuthProvider` y que las Functions de usuarios: un token
 * sin el custom claim aprovisionado se trata como `viewer`, nunca se asume un
 * rol mayor.
 */
export function roleFromClaims(
  claims: Record<string, unknown> | undefined,
): Role {
  const role = claims?.role;
  return isRole(role) ? role : 'viewer';
}

/** Indica si un rol puede consultar el reporte de audiencia. */
export function canReportQuividi(role: Role): boolean {
  return QUIVIDI_REPORT_ROLES.includes(role);
}

/** Capacidades operativas Quividi ajenas al informe comercial por campaña. */
export const QUIVIDI_OPERATIONS_ROLES: readonly Role[] = [
  'admin',
  'operator',
  'viewer',
];

export function canUseQuividiOperations(role: Role): boolean {
  return QUIVIDI_OPERATIONS_ROLES.includes(role);
}

export const QUIVIDI_TICKET_ROLES: readonly Role[] = ['admin', 'operator'];

export function canManageQuividiTickets(role: Role): boolean {
  return QUIVIDI_TICKET_ROLES.includes(role);
}

export const QUIVIDI_HEALTH_REFRESH_ROLES: readonly Role[] = [
  'admin',
  'operator',
];

export function canRefreshQuividiHealth(role: Role): boolean {
  return QUIVIDI_HEALTH_REFRESH_ROLES.includes(role);
}

/**
 * Roles que pueden ejecutar operaciones masivas contra VidiCenter (backfill de
 * salud de cámaras). Es la operación que más cuota consume, así que queda
 * reservada a `admin`.
 */
export const QUIVIDI_FORCE_REFRESH_ROLES: readonly Role[] = ['admin'];

/** Indica si un rol puede ejecutar operaciones masivas contra VidiCenter. */
export function canForceRefreshQuividi(role: Role): boolean {
  return QUIVIDI_FORCE_REFRESH_ROLES.includes(role);
}

/**
 * Roles que pueden actualizar el informe de una campaña saltándose la caché.
 *
 * `forceRefresh` ignora el snapshot guardado y vuelve a pedir los cuatro
 * exports a VidiCenter para UNA campaña. Por decisión de negocio lo tienen
 * `admin` y `operator` (botón «Actualizar datos de Quividi» en Campañas); su
 * espejo en la interfaz es `quividi.refresh` en `src/app/permissions.ts`.
 */
export const QUIVIDI_REPORT_REFRESH_ROLES: readonly Role[] = [
  'admin',
  'operator',
];

/** Indica si un rol puede actualizar el informe de campaña sin caché. */
export function canRefreshQuividiReport(role: Role): boolean {
  return QUIVIDI_REPORT_REFRESH_ROLES.includes(role);
}
