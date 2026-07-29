import { classifySupport, normalizeSupport } from '@/domain';
import type { ValidationIssue } from '@/domain';

/**
 * Inspección (paso 1) del Calendario de Campañas de Liverpool.
 *
 * No asume posiciones fijas ni columnas obligatorias todavía: identifica la
 * hoja operativa y la fila de encabezados por estructura, y expone lo detectado
 * (hojas, encabezados, vista previa, comentarios de celda y valores InStore
 * Media) para poder definir después la validación exacta y el mapeo a campañas.
 */

/** Representación neutral de una hoja. */
export interface SheetData {
  name: string;
  rows: string[][];
}

/** Comentario de celda (asignaciones de tienda, etc.). */
export interface CellComment {
  sheet: string;
  /** Fila y columna 1-based. */
  row: number;
  col: number;
  address: string;
  text: string;
}

export interface WorkbookData {
  sheets: SheetData[];
  comments: CellComment[];
}

export interface SheetSummary {
  name: string;
  rows: number;
  cols: number;
}

export interface DetectedComment {
  address: string;
  row: number;
  col: number;
  text: string;
}

export interface DetectedSupport {
  value: string;
  count: number;
}

export interface CalendarAnalysis {
  sheets: SheetSummary[];
  operativeSheet: string | null;
  /** Fila de encabezados detectada (1-based). */
  headerRow: number | null;
  headers: string[];
  dataRowCount: number;
  /** Primeras filas de datos (para vista previa). */
  previewRows: string[][];
  /** Comentarios de celda de la hoja operativa. */
  comments: DetectedComment[];
  /** Valores InStore Media (Muppi's / Pendón) hallados en la hoja operativa. */
  instoreSupports: DetectedSupport[];
  issues: ValidationIssue[];
}

const PREFERRED_SHEETS = ['hoja 2', 'hoja2'];
const HEADER_SEARCH_DEPTH = 20;
const PREVIEW_ROWS = 10;

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function nonEmptyCount(row: string[]): number {
  return row.reduce((n, cell) => (cell && cell.trim() !== '' ? n + 1 : n), 0);
}

/** Fila con más celdas no vacías (heurística de encabezados), 0-based. */
function detectHeaderRow(rows: string[][]): number {
  let best = { index: -1, score: 0 };
  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const score = nonEmptyCount(rows[i] ?? []);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function rowIsEmpty(row: string[]): boolean {
  return nonEmptyCount(row) === 0;
}

/** Inspecciona el calendario y devuelve la estructura detectada. Función pura. */
export function analyzeCalendar(data: WorkbookData): CalendarAnalysis {
  const { sheets, comments } = data;
  const issues: ValidationIssue[] = [];

  const summaries: SheetSummary[] = sheets.map((s) => ({
    name: s.name,
    rows: s.rows.length,
    cols: s.rows.reduce((max, r) => Math.max(max, r.length), 0),
  }));

  if (sheets.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'empty-workbook',
      message: 'El archivo no contiene hojas legibles.',
    });
    return {
      sheets: summaries,
      operativeSheet: null,
      headerRow: null,
      headers: [],
      dataRowCount: 0,
      previewRows: [],
      comments: [],
      instoreSupports: [],
      issues,
    };
  }

  // Hoja operativa: preferir "Hoja 2"; si no, la de encabezados más poblados.
  const preferred = sheets.find((s) =>
    PREFERRED_SHEETS.includes(normalizeName(s.name)),
  );
  const richest = sheets.reduce(
    (acc, s) => {
      const score = nonEmptyCount(s.rows[detectHeaderRow(s.rows)] ?? []);
      return score > acc.score ? { sheet: s, score } : acc;
    },
    { sheet: sheets[0]!, score: -1 },
  );
  const operative = preferred ?? richest.sheet;

  const headerIndex = detectHeaderRow(operative.rows);
  if (headerIndex < 0) {
    issues.push({
      severity: 'blocking',
      code: 'no-headers',
      message: `No se detectó una fila de encabezados en la hoja "${operative.name}".`,
      location: { sheet: operative.name },
    });
    return {
      sheets: summaries,
      operativeSheet: operative.name,
      headerRow: null,
      headers: [],
      dataRowCount: 0,
      previewRows: [],
      comments: [],
      instoreSupports: [],
      issues,
    };
  }

  const headers = (operative.rows[headerIndex] ?? []).map(
    (c) => c?.trim() ?? '',
  );

  const dataRows = operative.rows
    .slice(headerIndex + 1)
    .filter((r) => !rowIsEmpty(r));

  if (dataRows.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'no-data',
      message: 'No se encontraron filas de datos debajo de los encabezados.',
      location: { sheet: operative.name, row: headerIndex + 1 },
    });
  }

  // Valores InStore Media (Muppi's / Pendón) en toda la hoja operativa.
  const instoreCounts = new Map<string, DetectedSupport>();
  for (const row of operative.rows) {
    for (const cell of row) {
      const value = cell?.trim();
      if (!value) continue;
      if (classifySupport(value) === 'instore-media') {
        const key = normalizeSupport(value);
        const existing = instoreCounts.get(key);
        if (existing) existing.count += 1;
        else instoreCounts.set(key, { value, count: 1 });
      }
    }
  }

  const sheetComments: DetectedComment[] = comments
    .filter((c) => c.sheet === operative.name)
    .map((c) => ({ address: c.address, row: c.row, col: c.col, text: c.text }));

  return {
    sheets: summaries,
    operativeSheet: operative.name,
    headerRow: headerIndex + 1,
    headers,
    dataRowCount: dataRows.length,
    previewRows: dataRows.slice(0, PREVIEW_ROWS),
    comments: sheetComments,
    instoreSupports: Array.from(instoreCounts.values()).sort(
      (a, b) => b.count - a.count,
    ),
    issues,
  };
}
