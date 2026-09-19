/**
 * Control de acceso del reporte de audiencia Quividi.
 *
 * Las reglas de Firestore no cubren las callables, así que el rol se valida
 * aquí. Es el espejo en backend de la capacidad `quividi.report` de
 * `src/app/permissions.ts`: si allí se restringe un rol, hay que quitarlo
 * también de `QUIVIDI_REPORT_ROLES` — ocultar el botón no es control de acceso.
 *
 * Decisión vigente: los tres roles pueden descargar el informe, porque es
 * material de lectura para marcas/marketing. La capacidad existe por separado
 * de `reporting.read` porque su descarga sí consume la API de pago de Quividi.
 */

/** Roles válidos. Espejo de `USER_ROLES` en `src/domain/constants.ts`. */
const ROLES = ['admin', 'operator', 'viewer'] as const;

export type Role = (typeof ROLES)[number];

/** Roles con la capacidad `quividi.report`. */
export const QUIVIDI_REPORT_ROLES: readonly Role[] = [
  'admin',
  'operator',
  'viewer',
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
