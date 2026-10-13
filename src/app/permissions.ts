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
  | 'campaign.correct'
  | 'campaign.createManual'
  | 'campaign.downloadOperational'
  | 'campaign.linkEkon'
  | 'ekon.import'
  | 'reconciliation.read'
  | 'export.csv'
  | 'export.occupancyCsv'
  | 'tracking.read'
  | 'tracking.write'
  | 'odooIncidents.read'
  | 'reporting.read'
  | 'quividi.report'
  | 'quividi.refresh'
  | 'quividi.history'
  | 'quividi.commercial'
  | 'quividi.commercial.generate'
  | 'quividi.commercial.rebuild'
  | 'digitalOperations.read'
  | 'digitalOperations.import'
  | 'digitalOperations.track'
  | 'digitalOperations.export'
  | 'digitalCatalog.manage'
  | 'users.manage';

// `export.occupancyCsv` lo conservan los tres roles históricos: los CSV de las
// alertas de baja ocupación son operativos. Comercial queda excluido porque su
// única descarga autorizada es Quividi. Es distinto de `export.csv`, que cubre
// las exportaciones de catálogo/campañas y también queda restringido.
// `quividi.report` lo tienen los CUATRO roles por decisión de negocio: el informe
// de audiencia es material de lectura para marcas/marketing, igual que el resto
// de `reporting.read`. La capacidad existe por separado porque su descarga sí
// consume la API de pago de Quividi, así que si en el futuro se decide
// restringirla basta con quitarla de un rol aquí y del espejo en
// `functions/src/quividi/access.ts`.
// `quividi.refresh` («Actualizar datos de Quividi» en Campañas) lo tienen admin y
// operator: vuelve a pedir los datos a VidiCenter sin la copia guardada. Su
// espejo en el servidor es `QUIVIDI_REPORT_REFRESH_ROLES`.
// `quividi.commercial` (Inteligencia Comercial, Fase 3) también lo tienen los
// cuatro roles: ver reportes/auditoría es lectura, igual que `quividi.report`.
// `quividi.commercial.rebuild` (botón «Reconstruir rollup») es solo admin y
// operator: reescribe `quividiCommercialDaily` desde el histórico; es operación,
// no lectura ni acción comercial. Espejo `QUIVIDI_COMMERCIAL_REBUILD_ROLES`.
// `quividi.commercial.generate` excluye a `viewer`: confirmar una propuesta
// final persiste `quividiCommercialProposals` y produce el PDF que ve la
// marca, una acción mutante — mismo criterio que el resto de acciones de
// escritura de la matriz. Espejo en `functions/src/quividi/access.ts`
// (`QUIVIDI_COMMERCIAL_ROLES` / `QUIVIDI_COMMERCIAL_GENERATE_ROLES`).
const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'catalog.read',
    'catalog.write',
    'catalog.deactivate',
    'calendar.import',
    'campaign.correct',
    'campaign.createManual',
    'campaign.downloadOperational',
    'campaign.linkEkon',
    'ekon.import',
    'reconciliation.read',
    'export.csv',
    'export.occupancyCsv',
    'tracking.read',
    'tracking.write',
    'reporting.read',
    'odooIncidents.read',
    'quividi.report',
    'quividi.refresh',
    'quividi.history',
    'quividi.commercial',
    'quividi.commercial.generate',
    'quividi.commercial.rebuild',
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
    'campaign.correct',
    'campaign.createManual',
    'campaign.downloadOperational',
    'campaign.linkEkon',
    'ekon.import',
    'reconciliation.read',
    'export.csv',
    'export.occupancyCsv',
    'tracking.read',
    'tracking.write',
    'reporting.read',
    'odooIncidents.read',
    'quividi.report',
    'quividi.refresh',
    'quividi.commercial',
    'quividi.commercial.generate',
    'quividi.commercial.rebuild',
    'digitalOperations.read',
    'digitalOperations.import',
    'digitalOperations.track',
    'digitalOperations.export',
  ],
  viewer: [
    'catalog.read',
    'campaign.downloadOperational',
    'campaign.linkEkon',
    'reconciliation.read',
    'export.occupancyCsv',
    'tracking.read',
    'reporting.read',
    'odooIncidents.read',
    'quividi.report',
    'quividi.commercial',
    'digitalOperations.read',
  ],
  commercial: [
    'tracking.read',
    'quividi.report',
    'quividi.commercial',
    'quividi.commercial.generate',
  ],
};

/** Indica si un rol tiene un permiso dado. */
export function can(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
