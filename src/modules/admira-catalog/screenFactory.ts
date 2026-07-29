import { ADMIRA_CATALOG_HEADERS } from '@/domain';
import type { AdmiraScreenOriginal, SignamMetadata } from '@/domain';

/** Actor que realiza una operación (para trazabilidad en los metadatos). */
export interface Actor {
  uid: string;
  email: string;
}

/** Devuelve un objeto de campos originales vacío (los 12 encabezados). */
export function emptyOriginal(): AdmiraScreenOriginal {
  const result = {} as AdmiraScreenOriginal;
  for (const header of ADMIRA_CATALOG_HEADERS) {
    result[header] = '';
  }
  return result;
}

/** Recorta y normaliza los campos originales conservando solo los oficiales. */
export function sanitizeOriginal(
  input: Partial<AdmiraScreenOriginal>,
): AdmiraScreenOriginal {
  const result = emptyOriginal();
  for (const header of ADMIRA_CATALOG_HEADERS) {
    result[header] = (input[header] ?? '').trim();
  }
  return result;
}

/** Metadatos SIGNAM para una pantalla creada manualmente desde el catálogo. */
export function newScreenMetadata(actor: Actor, now: number): SignamMetadata {
  return {
    active: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.email,
    updatedBy: actor.email,
    source: 'manual',
    sourceSheet: '',
    sourceRow: 0,
    deactivationReason: null,
    version: 1,
    calendarSupport: '',
  };
}

/** Metadatos tras una edición: conserva creación, bump de versión y updatedAt. */
export function bumpMetadata(
  prev: SignamMetadata,
  actor: Actor,
  now: number,
  changes: Partial<SignamMetadata> = {},
): SignamMetadata {
  return {
    ...prev,
    ...changes,
    updatedAt: now,
    updatedBy: actor.email,
    version: prev.version + 1,
  };
}
