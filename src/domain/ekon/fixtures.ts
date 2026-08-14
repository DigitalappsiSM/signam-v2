import type { EkonCell } from './parse';
import { EKON_HEADERS } from './headers';
import { assignmentFingerprint } from './diff';
import { buildAssignments, parseEkonGrid } from './parse';
import type { EkonAssignment, StoredEkonAssignment } from './models';

/**
 * Fixtures SINTÉTICOS y anonimizados para las pruebas de dominio Ekon. No se usa
 * ningún archivo empresarial real. Los valores imitan la estructura del archivo
 * (30 columnas, fechas seriales de Excel, tipos de campaña) sin datos reales.
 */

/** Valores de una fila Ekon sintética; los ausentes toman un valor por defecto. */
export type EkonRowSpec = Partial<
  Record<(typeof EKON_HEADERS)[number], EkonCell>
>;

const DEFAULT_ROW: Record<(typeof EKON_HEADERS)[number], EkonCell> = {
  Año: 2026,
  Mes: 8,
  Cadena: 'CADENA',
  Enseña: 'ENSEÑA',
  Artículo: 'MEGA MUPI DIGITAL',
  Determinante: '10',
  Tienda: 'TIENDA DEMO',
  Provincia: 'PROVINCIA',
  Sociedad: 'SOCIEDAD',
  Comprador: 'COMPRADOR',
  Cliente: 'CLIENTE',
  'Cliente final': 'CLIENTE FINAL',
  Anunciante: 'ANUNCIANTE',
  'Tipo Campaña': 'General',
  Campaña: '30001',
  Producto: 'PRODUCTO DEMO',
  'ID Periodo': '32',
  // Serial 46231 = 2026-07-28; 46237 = 2026-08-03 (semana).
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
  Sector: 'SECTOR',
  Caras: 1,
  'Importe neto': 1000,
  'Tipo fact.': 'FACT/A',
  'No. factura': '900001',
  'Fecha Factura': 46240,
  'Código Centro': '3500',
  'Línea campaña': '10',
  Familia: 'IN [IN-STORE]',
  Comercial: 'COMERCIAL',
  Contrato: 'CONTRATO',
};

/** Fila de encabezados (los 30 nombres oficiales). */
export function headerRow(): EkonCell[] {
  return EKON_HEADERS.slice();
}

/** Construye una fila de celdas a partir de una especificación parcial. */
export function buildRow(spec: EkonRowSpec): EkonCell[] {
  return EKON_HEADERS.map((h) => (h in spec ? spec[h]! : DEFAULT_ROW[h]));
}

/** Construye una matriz (encabezado + filas) a partir de especificaciones. */
export function buildGrid(specs: readonly EkonRowSpec[]): EkonCell[][] {
  return [headerRow(), ...specs.map(buildRow)];
}

/** Atajo: parsea especificaciones a asignaciones vigentes. */
export function assignmentsFromSpecs(
  specs: readonly EkonRowSpec[],
): EkonAssignment[] {
  const parsed = parseEkonGrid(buildGrid(specs));
  return buildAssignments(parsed.rows);
}

/** Convierte una asignación en su forma persistida (para simular estado previo). */
export function storedFrom(
  assignment: EkonAssignment,
  overrides: Partial<StoredEkonAssignment> = {},
): StoredEkonAssignment {
  return {
    ...assignment,
    fingerprint: assignmentFingerprint(assignment),
    active: true,
    firstBatchId: 'batch-0',
    lastBatchId: 'batch-0',
    missingSinceBatchId: null,
    revision: 1,
    updatedAt: 0,
    ...overrides,
  };
}
