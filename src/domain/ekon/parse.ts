import {
  EKON_REQUIRED_HEADERS,
  validateHeaders,
  type EkonHeader,
} from './headers';
import {
  isCentroAdministrativo,
  normalizeId,
  normalizeStoreNumber,
  normalizeText,
  toCivilDate,
  toNumber,
} from './normalization';
import { assignmentKey } from './identity';
import {
  parseCampaignType,
  ratioForType,
  requiresTestigos,
} from './campaignType';
import { canonicalCircuit } from './supportMapping';
import type {
  EkonAssignment,
  EkonCommercial,
  EkonParseResult,
  EkonRawRow,
  EkonRowError,
} from './models';

/**
 * Parser puro del archivo Ekon: opera sobre una matriz neutral (la lectura del
 * `.xlsx` con `xlsx`/`exceljs` vive en el módulo y produce esta matriz). La
 * primera fila es el encabezado.
 *
 * - Valida encabezados requeridos, duplicados y desconocidos.
 * - Convierte fechas seriales a fechas civiles sin desfase.
 * - Aísla filas sin los campos mínimos (no aborta la importación) con nº de fila.
 * - Conserva campos comerciales aunque no controlen programación.
 */

/** Celda de la matriz de entrada (texto, número o fecha). */
export type EkonCell = string | number | Date | null | undefined;

function cell(row: readonly EkonCell[], col: number | undefined): EkonCell {
  if (col === undefined) return null;
  return row[col];
}

/** Versión del esquema/parser (para el lote). */
export const EKON_SCHEMA_VERSION = 1;

/**
 * Parsea la matriz neutral del archivo Ekon a filas crudas normalizadas.
 * `grid[0]` es la fila de encabezados.
 */
export function parseEkonGrid(
  grid: readonly (readonly EkonCell[])[],
): EkonParseResult {
  const headerRow = (grid[0] ?? []).map((c) => (c == null ? '' : String(c)));
  const validation = validateHeaders(headerRow);
  const col = (h: EkonHeader) => validation.columnIndex.get(h);

  const rows: EkonRawRow[] = [];
  const errors: EkonRowError[] = [];

  // Si faltan encabezados requeridos, no se pueden formar asignaciones: se
  // reporta y se devuelven cero filas (la UI muestra los faltantes).
  if (validation.missing.length > 0) {
    return {
      rows: [],
      errors: [],
      totalRows: Math.max(grid.length - 1, 0),
      validRows: 0,
      rejectedRows: Math.max(grid.length - 1, 0),
      headerIssues: {
        missing: validation.missing.slice(),
        duplicated: validation.duplicated.slice(),
        unknown: validation.unknown.slice(),
      },
    };
  }

  for (let r = 1; r < grid.length; r += 1) {
    const raw = grid[r] ?? [];
    const sourceRow = r + 1; // 1-based, contando el encabezado.

    // Fila completamente vacía: se ignora en silencio.
    if (raw.every((c) => c == null || String(c).trim() === '')) continue;

    const missingFields = EKON_REQUIRED_HEADERS.filter((h) => {
      const v = cell(raw, col(h));
      return v == null || String(v).trim() === '';
    });
    if (missingFields.length > 0) {
      errors.push({
        sourceRow,
        reason: `Faltan campos mínimos: ${missingFields.join(', ')}.`,
        fields: missingFields,
      });
      continue;
    }

    const inicio = toCivilDate(cell(raw, col('Inicio periodo')));
    const fin = toCivilDate(cell(raw, col('Fin periodo')));
    if (inicio === null || fin === null) {
      errors.push({
        sourceRow,
        reason: 'Fechas de periodo no interpretables (Inicio/Fin periodo).',
        fields: ['Inicio periodo', 'Fin periodo'],
      });
      continue;
    }

    const determinante = normalizeId(cell(raw, col('Determinante')));
    rows.push({
      sourceRow,
      año: normalizeId(cell(raw, col('Año'))),
      mes: normalizeId(cell(raw, col('Mes'))),
      cadena: normalizeText(cell(raw, col('Cadena'))),
      enseña: normalizeText(cell(raw, col('Enseña'))),
      articulo: normalizeText(cell(raw, col('Artículo'))),
      determinante,
      determinanteKey: normalizeStoreNumber(determinante),
      tienda: normalizeText(cell(raw, col('Tienda'))),
      provincia: normalizeText(cell(raw, col('Provincia'))),
      sociedad: normalizeText(cell(raw, col('Sociedad'))),
      comprador: normalizeText(cell(raw, col('Comprador'))),
      cliente: normalizeText(cell(raw, col('Cliente'))),
      clienteFinal: normalizeText(cell(raw, col('Cliente final'))),
      anunciante: normalizeText(cell(raw, col('Anunciante'))),
      tipoCampañaOriginal: normalizeText(cell(raw, col('Tipo Campaña'))),
      campaña: normalizeId(cell(raw, col('Campaña'))),
      producto: normalizeText(cell(raw, col('Producto'))),
      idPeriodo: normalizeId(cell(raw, col('ID Periodo'))),
      inicioPeriodo: inicio,
      finPeriodo: fin,
      sector: normalizeText(cell(raw, col('Sector'))),
      caras: toNumber(cell(raw, col('Caras'))),
      importeNeto: toNumber(cell(raw, col('Importe neto'))),
      tipoFactura: normalizeText(cell(raw, col('Tipo fact.'))),
      noFactura: normalizeId(cell(raw, col('No. factura'))),
      fechaFactura: toCivilDate(cell(raw, col('Fecha Factura'))),
      codigoCentro: normalizeId(cell(raw, col('Código Centro'))),
      lineaCampaña: normalizeId(cell(raw, col('Línea campaña'))),
      familia: normalizeText(cell(raw, col('Familia'))),
      comercial: normalizeText(cell(raw, col('Comercial'))),
      contrato: normalizeText(cell(raw, col('Contrato'))),
    });
  }

  const totalRows = Math.max(grid.length - 1, 0);
  return {
    rows,
    errors,
    totalRows,
    validRows: rows.length,
    rejectedRows: errors.length,
    headerIssues: {
      missing: validation.missing.slice(),
      duplicated: validation.duplicated.slice(),
      unknown: validation.unknown.slice(),
    },
  };
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Agrupa filas crudas en asignaciones por identidad estable. Las filas que
 * comparten llave dentro del mismo periodo son líneas comerciales del mismo
 * pase: se agregan (importe/caras se suman; facturas se acumulan). El resto de
 * campos operativos se toma de la primera fila (son idénticos por construcción
 * de la llave). `Caras` NO multiplica pantallas: solo se conserva como dato.
 */
export function buildAssignments(
  rows: readonly EkonRawRow[],
): EkonAssignment[] {
  const groups = new Map<string, EkonRawRow[]>();
  for (const row of rows) {
    const key = assignmentKey({
      año: row.año,
      campaña: row.campaña,
      lineaCampaña: row.lineaCampaña,
      determinante: row.determinante,
      articulo: row.articulo,
    });
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
  }

  const assignments: EkonAssignment[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const type = parseCampaignType(first.tipoCampañaOriginal) ?? 'general';
    // Conflicto de datos: la misma identidad aparece con periodos distintos
    // dentro del MISMO lote (no debería ocurrir; el perfilado del archivo real
    // no lo produjo). Se marca para excluirla de conciliación y fallback.
    const distinctPeriods = new Set(group.map((r) => r.idPeriodo));
    const conflict =
      distinctPeriods.size > 1
        ? `La asignación aparece en varios periodos en el mismo lote: ${[...distinctPeriods].join(', ')}.`
        : null;
    const commercial: EkonCommercial = {
      importeNeto: group.reduce<number | null>(
        (acc, r) => sumNullable(acc, r.importeNeto),
        null,
      ),
      caras: group.reduce<number | null>(
        (acc, r) => sumNullable(acc, r.caras),
        null,
      ),
      comprador: first.comprador,
      cliente: first.cliente,
      clienteFinal: first.clienteFinal,
      anunciante: first.anunciante,
      sector: first.sector,
      comercial: first.comercial,
      contrato: first.contrato,
      facturas: [
        ...new Set(group.map((r) => r.noFactura).filter((f) => f !== '')),
      ],
    };
    assignments.push({
      key,
      año: first.año,
      campaña: first.campaña,
      lineaCampaña: first.lineaCampaña,
      determinante: first.determinante,
      determinanteKey: first.determinanteKey,
      articulo: first.articulo,
      circuito: canonicalCircuit(first.articulo) ?? first.articulo,
      tipoCampaña: type,
      tipoCampañaOriginal: first.tipoCampañaOriginal,
      ratio: ratioForType(type),
      requiresTestigos: requiresTestigos(type),
      producto: first.producto,
      idPeriodo: first.idPeriodo,
      inicioPeriodo: first.inicioPeriodo,
      finPeriodo: first.finPeriodo,
      tienda: first.tienda,
      codigoCentro: first.codigoCentro,
      familia: first.familia,
      centroAdministrativo: isCentroAdministrativo(first.determinante),
      commercial,
      conflict,
      sourceRows: group.map((r) => r.sourceRow),
    });
  }
  return assignments;
}
