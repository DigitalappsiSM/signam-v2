import type { AdmiraCsvColumn, UserRole } from './constants';

/**
 * Modelos de dominio de SIGNAM V2.
 *
 * Regla clave: los campos oficiales del maestro Admira se conservan intactos y
 * NO se mezclan con los metadatos que agrega SIGNAM. Por eso `AdmiraScreen`
 * separa `original` (campos del maestro, tal cual) de los metadatos SIGNAM.
 */

/** Marca de tiempo en milisegundos desde epoch (serializable y estable en Firestore). */
export type EpochMillis = number;

/**
 * Campos originales de una pantalla del catálogo Admira, exactamente como
 * aparecen en el maestro (hoja `Consolidado`). Las claves son los encabezados
 * oficiales; los valores se conservan como texto literal.
 */
export interface AdmiraScreenOriginal {
  'TIPO DE pantallas': string;
  CENTROS: string;
  CIRCUITO: string;
  RESOLUCION: string;
  FORMATO: string;
  'Nombre en plataforma': string;
  'TIPO DE PASES': string;
  'Numero de Tienda': string;
  'Nombre de tienda': string;
  Modelo: string;
  ARTICULOS: string;
  BRANDS: string;
}

/** Metadatos que agrega SIGNAM. Nunca se exportan dentro del maestro. */
export interface SignamMetadata {
  active: boolean;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
  createdBy: string;
  updatedBy: string;
  /** Procedencia: nombre de archivo, hoja y fila de origen en el maestro. */
  source: string;
  sourceSheet: string;
  sourceRow: number;
  /** Motivo de inactivación, requerido al inactivar una pantalla. */
  deactivationReason: string | null;
  /** Versión monotónica del registro (se incrementa en cada edición). */
  version: number;
  /**
   * Mapeo al soporte del Calendario de Liverpool (p. ej. `VIDEO WALL CRIUS`).
   * Es el campo por el que se cruza el calendario contra el catálogo, junto con
   * `Numero de Tienda`. Metadato SIGNAM: no forma parte de los 12 campos
   * oficiales del maestro. Vacío si aún no se ha mapeado.
   */
  calendarSupport: string;
}

/** Pantalla del catálogo Admira: campos originales + metadatos SIGNAM. */
export interface AdmiraScreen {
  id: string;
  original: AdmiraScreenOriginal;
  metadata: SignamMetadata;
}

/**
 * Una campaña Liverpool importada del calendario. La consolidación posterior
 * genera un CSV por cada `Campaña + RESOLUCION` derivada de sus pantallas
 * activas. Esta forma es intencionalmente mínima en la primera entrega.
 */
export interface Campaign {
  id: string;
  /** Nombre de la campaña tal como aparece en el calendario Liverpool. */
  name: string;
  startDate: EpochMillis | null;
  endDate: EpochMillis | null;
  /** Soportes solicitados por la campaña (texto literal del calendario). */
  requestedSupports: string[];
  /** Números de tienda asignados (extraídos de celdas y comentarios). */
  storeNumbers: string[];
  /** Identificador de la importación que originó esta campaña. */
  importId: string;
  createdAt: EpochMillis;
}

/** Severidad de un hallazgo durante la validación de una importación. */
export type IssueSeverity = 'blocking' | 'warning' | 'info';

/** Hallazgo textual de validación (columna faltante, soporte nuevo, etc.). */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  /** Ubicación opcional (hoja/fila/columna) para trazabilidad. */
  location?: {
    sheet?: string;
    row?: number;
    column?: string;
  };
}

/**
 * Resultado de validar un archivo importado (calendario Liverpool o maestro
 * Admira). Conserva referencia al archivo original y separa errores
 * bloqueantes de advertencias.
 */
export interface ImportValidation {
  id: string;
  kind: 'liverpool-calendar' | 'admira-master';
  fileName: string;
  /** Ruta del archivo original conservado en Cloud Storage. */
  storagePath: string | null;
  detectedSheet: string | null;
  headerRow: number | null;
  issues: ValidationIssue[];
  /** true si no hay hallazgos bloqueantes y puede confirmarse la importación. */
  ok: boolean;
  createdAt: EpochMillis;
  createdBy: string;
}

/**
 * Una campaña consolidada: la unidad `Campaña + RESOLUCION` que produce un CSV.
 * `articulos` ya viene resuelto (literal del maestro, deduplicado y concatenado
 * con ` + ` cuando corresponde).
 */
export interface Consolidation {
  id: string;
  campaignId: string;
  campaignName: string;
  resolution: string;
  /** Nombre de campaña Admira: `<Campaña>_ <ARTICULOS>`. */
  admiraCampaignName: string;
  articulos: string;
  /** IDs de las pantallas activas que aportan a esta consolidación. */
  screenIds: string[];
  issues: ValidationIssue[];
  createdAt: EpochMillis;
}

/** Una fila del CSV de Admira, tipada por columna. */
export type AdmiraCsvRow = Record<AdmiraCsvColumn, string>;

/**
 * Registro de una exportación de CSV. Conserva un snapshot inmutable: una
 * exportación histórica no cambia si luego se edita o inactiva una pantalla.
 */
export interface CsvExport {
  id: string;
  campaignName: string;
  resolution: string;
  admiraCampaignName: string;
  rows: AdmiraCsvRow[];
  /** Ruta del CSV generado en Cloud Storage. */
  storagePath: string | null;
  /** Snapshot de las pantallas y consolidaciones al momento de exportar. */
  snapshot: {
    screenIds: string[];
    consolidationId: string;
  };
  createdAt: EpochMillis;
  createdBy: string;
}

/** Acciones auditables del sistema. */
export type AuditAction =
  | 'screen.create'
  | 'screen.update'
  | 'screen.deactivate'
  | 'screen.reactivate'
  | 'master.import'
  | 'calendar.import'
  | 'consolidation.run'
  | 'export.csv';

/** Evento de auditoría: quién, cuándo, qué, valores anteriores y nuevos. */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  /** Colección/entidad afectada y su identificador. */
  entity: string;
  entityId: string;
  actorUid: string;
  actorEmail: string;
  at: EpochMillis;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  /** Importación/exportación relacionada, si aplica. */
  relatedImportId?: string;
  relatedExportId?: string;
}

/** Perfil de usuario con su rol (fuente de verdad para las reglas de Firestore). */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: EpochMillis;
}
