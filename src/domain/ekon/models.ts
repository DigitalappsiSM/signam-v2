import type { EkonHeader } from './headers';

/**
 * Modelos de dominio de la integración Ekon.
 *
 * Los datos Ekon viven en colecciones SEPARADAS de `campaigns`, del catálogo
 * Admira y del seguimiento operativo. Nunca se mezclan ni los sobrescriben.
 */

/** Marca de tiempo en milisegundos desde epoch. */
export type EpochMillis = number;

/** Clasificación por tipo de campaña Ekon (distinta de la baja ocupación). */
export type EkonRatio = 'ratio1' | 'ratio3';

/** Enum interno del tipo de campaña Ekon (se conserva el texto original). */
export type EkonCampaignType =
  'institucionales' | 'liverpesos' | 'liverpool' | 'general';

/**
 * Fila cruda del archivo Ekon, normalizada mínimamente. Conserva tanto valores
 * originales como normalizados donde es útil para auditoría. Es un snapshot de
 * la importación; no se mezcla con `campaigns`.
 */
export interface EkonRawRow {
  /** Fila de origen en el Excel (1-based, incluye encabezado). */
  sourceRow: number;
  año: string;
  mes: string;
  cadena: string;
  enseña: string;
  articulo: string;
  determinante: string;
  /** Determinante normalizado (sin ceros a la izquierda) para comparación. */
  determinanteKey: string;
  tienda: string;
  provincia: string;
  sociedad: string;
  comprador: string;
  cliente: string;
  clienteFinal: string;
  anunciante: string;
  tipoCampañaOriginal: string;
  campaña: string;
  producto: string;
  idPeriodo: string;
  /** Fecha civil `AAAA-MM-DD`. */
  inicioPeriodo: string | null;
  finPeriodo: string | null;
  sector: string;
  caras: number | null;
  importeNeto: number | null;
  tipoFactura: string;
  noFactura: string;
  fechaFactura: string | null;
  codigoCentro: string;
  lineaCampaña: string;
  familia: string;
  comercial: string;
  contrato: string;
}

/**
 * Motivo por el que una fila se rechaza/aísla (no aborta la importación).
 */
export interface EkonRowError {
  sourceRow: number;
  reason: string;
  /** Encabezados/campos implicados, si aplica. */
  fields?: EkonHeader[];
}

/** Resultado de parsear un archivo Ekon a filas crudas. */
export interface EkonParseResult {
  rows: EkonRawRow[];
  errors: EkonRowError[];
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  headerIssues: {
    missing: string[];
    duplicated: string[];
    unknown: string[];
  };
}

/**
 * Datos comerciales de una asignación (informativos: NO controlan programación
 * ni resolución de pantallas). Se conservan y pueden mostrarse como cambios
 * comerciales.
 */
export interface EkonCommercial {
  /** Suma de importes netos de las filas que forman la asignación. */
  importeNeto: number | null;
  /** Suma de caras (dato comercial: NO multiplica pantallas). */
  caras: number | null;
  comprador: string;
  cliente: string;
  clienteFinal: string;
  anunciante: string;
  sector: string;
  comercial: string;
  contrato: string;
  facturas: string[];
}

/**
 * Asignación Ekon normalizada: la unidad que consumen la conciliación y el
 * fallback de CSV. Una asignación agrupa las filas del archivo que comparten la
 * misma identidad estable dentro de un periodo.
 */
export interface EkonAssignment {
  /** Llave estable (ver `identity.ts`). Identifica la asignación entre lotes. */
  key: string;
  año: string;
  /** Número de campaña Ekon (texto identificador). */
  campaña: string;
  lineaCampaña: string;
  determinante: string;
  determinanteKey: string;
  articulo: string;
  /** Circuito canónico Ekon (alias resueltos, ver `supportMapping.ts`). */
  circuito: string;
  tipoCampaña: EkonCampaignType;
  tipoCampañaOriginal: string;
  ratio: EkonRatio;
  requiresTestigos: boolean;
  producto: string;
  idPeriodo: string;
  inicioPeriodo: string | null;
  finPeriodo: string | null;
  tienda: string;
  codigoCentro: string;
  familia: string;
  /** true si el determinante es `0` (Centro Administrativo): no es tienda. */
  centroAdministrativo: boolean;
  commercial: EkonCommercial;
  /**
   * Motivo de conflicto de datos (p. ej. la misma identidad apareció con varios
   * periodos incompatibles dentro del mismo lote). `null` si no hay conflicto.
   */
  conflict: string | null;
  /** Filas de origen que forman la asignación (para auditoría). */
  sourceRows: number[];
}

/** Estado funcional de una asignación tras el diff de una importación. */
export type EkonChangeState =
  | 'nueva'
  | 'sin-cambios'
  | 'modificada'
  | 'no-incluida'
  | 'restaurada'
  | 'conflicto';

/** Estado del ciclo de vida de un lote de importación Ekon. */
export type EkonBatchStatus =
  'parsing' | 'pending_confirmation' | 'processing' | 'completed' | 'failed';

/** Un periodo Ekon detectado (año + id + fechas civiles). */
export interface EkonPeriod {
  año: string;
  idPeriodo: string;
  inicio: string | null;
  fin: string | null;
}

/** Metadatos de un lote de importación Ekon. */
export interface EkonImportBatch {
  id: string;
  fileName: string;
  /** Hash del contenido normalizado (idempotencia de reimportación). */
  contentHash: string;
  status: EkonBatchStatus;
  createdByUid: string;
  createdByEmail: string;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
  completedAt: EpochMillis | null;
  detectedPeriods: EkonPeriod[];
  confirmedPeriodIds: string[];
  coverage: { min: string | null; max: string | null };
  totals: EkonBatchTotals;
  /** Resumen breve de errores/advertencias. */
  warnings: string[];
  schemaVersion: number;
}

/** Conteos del lote y del diff. */
export interface EkonBatchTotals {
  totalRows: number;
  validRows: number;
  rejectedRows: number;
  distinctCampaigns: number;
  distinctLines: number;
  distinctDeterminantes: number;
  periods: number;
  nuevas: number;
  modificadas: number;
  sinCambios: number;
  noIncluidas: number;
  restauradas: number;
  conflictos: number;
}

/** Versión persistida de una asignación (documento vigente). */
export interface StoredEkonAssignment extends EkonAssignment {
  /** Fingerprint relevante para conciliación/versionado (ver `diff.ts`). */
  fingerprint: string;
  active: boolean;
  firstBatchId: string;
  lastBatchId: string;
  missingSinceBatchId: string | null;
  revision: number;
  updatedAt: EpochMillis;
}

/** Tipo de evento del historial de una asignación. */
export type EkonRevisionEvent =
  | 'created'
  | 'modified'
  | 'period-change'
  | 'line-change'
  | 'missing'
  | 'restored';

/** Registro de historial de una asignación (snapshot antes/después). */
export interface EkonRevision {
  id: string;
  key: string;
  batchId: string;
  event: EkonRevisionEvent;
  before: EkonAssignment | null;
  after: EkonAssignment | null;
  changedFields: string[];
  at: EpochMillis;
  byUid: string;
  byEmail: string;
}
