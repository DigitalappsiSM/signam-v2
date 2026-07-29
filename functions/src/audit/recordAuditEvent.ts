import { getFirestore } from 'firebase-admin/firestore';

/**
 * Acciones auditables (espejo del dominio del frontend). Mantener sincronizado
 * con `src/domain/models.ts` (`AuditAction`).
 */
export type AuditAction =
  | 'screen.create'
  | 'screen.update'
  | 'screen.deactivate'
  | 'screen.reactivate'
  | 'master.import'
  | 'calendar.import'
  | 'consolidation.run'
  | 'export.csv';

export interface AuditEventInput {
  action: AuditAction;
  entity: string;
  entityId: string;
  actorUid: string;
  actorEmail: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  relatedImportId?: string;
  relatedExportId?: string;
}

/**
 * Escribe un evento de auditoría inmutable en `auditEvents`. Las reglas de
 * Firestore impiden que los clientes escriban en esta colección: solo se puede
 * poblar desde Cloud Functions con credenciales de administrador.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<string> {
  const db = getFirestore();
  const doc = db.collection('auditEvents').doc();
  await doc.set({
    ...input,
    before: input.before ?? null,
    after: input.after ?? null,
    reason: input.reason ?? null,
    at: Date.now(),
  });
  return doc.id;
}
