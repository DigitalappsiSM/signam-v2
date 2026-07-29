import {
  ADMIRA_CATALOG_HEADERS,
  CALENDAR_MAPPING_HEADERS,
  LEGACY_PASES_HEADER,
  REQUIRED_PASES_HEADER,
  type AdmiraCatalogHeader,
  type AdmiraScreenOriginal,
  type ValidationIssue,
} from '@/domain';
import { emptyOriginal } from './screenFactory';

/**
 * Análisis e importación del archivo MAESTRO (hoja `Consolidado`).
 *
 * La detección no depende de posiciones fijas: se identifica la hoja operativa
 * y la fila de encabezados por su estructura, se validan los 12 encabezados
 * oficiales y se informan cambios (faltantes, adicionales, `Pases` heredado)
 * sin corregirlos en silencio.
 */

/** Representación neutral de una hoja (independiente de la librería de Excel). */
export interface SheetData {
  name: string;
  /** Filas con el texto de cada celda (índice 0 = primera fila del archivo). */
  rows: string[][];
}

/** Una fila de datos mapeada a los campos originales, con su fila de origen. */
export interface MasterRow {
  original: AdmiraScreenOriginal;
  /** Número de fila en el archivo (1-based). */
  sourceRow: number;
  /** Valor de la columna de mapeo al soporte del calendario (si existe). */
  calendarSupport: string;
}

/**
 * Encabezados aceptados para la columna opcional que mapea cada pantalla al
 * soporte del Calendario de Liverpool (no es uno de los 12 oficiales).
 */
const MAPPING_ALIASES = new Set(
  CALENDAR_MAPPING_HEADERS.map((h) => normalizeHeader(h)),
);

export interface MasterAnalysis {
  detectedSheet: string | null;
  /** Fila de encabezados detectada (1-based). */
  headerRow: number | null;
  headers: string[];
  missing: AdmiraCatalogHeader[];
  extra: string[];
  legacyPases: boolean;
  /** Encabezado de la columna de mapeo detectada, o null si no viene. */
  mappingColumn: string | null;
  rows: MasterRow[];
  issues: ValidationIssue[];
  /** true si no hay incidencias bloqueantes y hay al menos una fila. */
  ok: boolean;
}

const PREFERRED_SHEET = 'consolidado';
const HEADER_SEARCH_DEPTH = 20;
const MIN_HEADER_MATCHES = 4;

function normalizeHeader(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const OFFICIAL_BY_NORM = new Map<string, AdmiraCatalogHeader>(
  ADMIRA_CATALOG_HEADERS.map((h) => [normalizeHeader(h), h]),
);

/** Cuenta cuántas celdas de una fila coinciden con encabezados oficiales. */
function headerMatchCount(row: string[]): number {
  let count = 0;
  for (const cell of row) {
    if (cell && OFFICIAL_BY_NORM.has(normalizeHeader(cell))) count += 1;
  }
  return count;
}

/** Encuentra la mejor fila de encabezados de una hoja (0-based) y su puntaje. */
function findHeaderRow(rows: string[][]): { index: number; score: number } {
  let best = { index: -1, score: 0 };
  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const score = headerMatchCount(rows[i] ?? []);
    if (score > best.score) best = { index: i, score };
  }
  return best;
}

function isRowEmpty(original: AdmiraScreenOriginal): boolean {
  return Object.values(original).every((v) => v === '');
}

/**
 * Analiza las hojas de un maestro y devuelve las pantallas detectadas más un
 * diagnóstico. Función pura: no depende de Firebase ni de la librería de Excel.
 */
export function analyzeMaster(sheets: readonly SheetData[]): MasterAnalysis {
  const issues: ValidationIssue[] = [];

  // 1) Elegir la hoja operativa: preferir "Consolidado"; si no, la de mejor
  //    coincidencia de encabezados.
  const candidates = sheets.map((sheet) => ({
    sheet,
    header: findHeaderRow(sheet.rows),
  }));

  const preferred = candidates.find(
    (c) =>
      normalizeHeader(c.sheet.name) === PREFERRED_SHEET && c.header.score > 0,
  );
  const best = candidates.reduce(
    (acc, c) => (c.header.score > acc.header.score ? c : acc),
    { sheet: { name: '', rows: [] }, header: { index: -1, score: 0 } },
  );
  const chosen =
    preferred ?? (best.header.score >= MIN_HEADER_MATCHES ? best : null);

  if (!chosen) {
    issues.push({
      severity: 'blocking',
      code: 'sheet-not-found',
      message:
        'No se identificó la hoja operativa del maestro (se esperaba una hoja tipo "Consolidado" con los encabezados oficiales).',
    });
    return {
      detectedSheet: null,
      headerRow: null,
      headers: [],
      missing: [...ADMIRA_CATALOG_HEADERS],
      extra: [],
      legacyPases: false,
      mappingColumn: null,
      rows: [],
      issues,
      ok: false,
    };
  }

  const { sheet, header } = chosen;
  const headerCells = sheet.rows[header.index] ?? [];

  // 2) Mapear columnas oficiales presentes y detectar faltantes/adicionales.
  //    La columna opcional de mapeo al calendario se captura aparte (no es
  //    "adicional" ni oficial).
  const columnByHeader = new Map<AdmiraCatalogHeader, number>();
  const extra: string[] = [];
  let mappingCol = -1;
  let mappingColumn: string | null = null;
  headerCells.forEach((cell, col) => {
    const text = cell?.trim() ?? '';
    if (text === '') return;
    const official = OFFICIAL_BY_NORM.get(normalizeHeader(text));
    if (official) {
      if (!columnByHeader.has(official)) columnByHeader.set(official, col);
    } else if (MAPPING_ALIASES.has(normalizeHeader(text))) {
      if (mappingCol === -1) {
        mappingCol = col;
        mappingColumn = text;
      }
    } else {
      extra.push(text);
    }
  });

  const missing = ADMIRA_CATALOG_HEADERS.filter((h) => !columnByHeader.has(h));

  const legacyPases =
    missing.includes(REQUIRED_PASES_HEADER) &&
    extra.some(
      (h) => normalizeHeader(h) === normalizeHeader(LEGACY_PASES_HEADER),
    );

  // 3) Incidencias por columnas.
  for (const h of missing) {
    issues.push({
      severity: 'blocking',
      code: 'missing-column',
      message: `Campo obligatorio faltante: ${h}`,
      location: { sheet: sheet.name, row: header.index + 1, column: h },
    });
  }
  for (const h of extra) {
    issues.push({
      severity: 'warning',
      code: 'extra-column',
      message: `Campo antiguo o adicional: ${h}`,
      location: { sheet: sheet.name, row: header.index + 1, column: h },
    });
  }

  // 4) Mapear filas de datos.
  const rows: MasterRow[] = [];
  for (let r = header.index + 1; r < sheet.rows.length; r += 1) {
    const cells = sheet.rows[r] ?? [];
    const original = emptyOriginal();
    for (const [h, col] of columnByHeader) {
      original[h] = (cells[col] ?? '').trim();
    }
    if (isRowEmpty(original)) continue;
    const calendarSupport =
      mappingCol >= 0 ? (cells[mappingCol] ?? '').trim() : '';
    rows.push({ original, sourceRow: r + 1, calendarSupport });
  }

  if (rows.length === 0) {
    issues.push({
      severity: 'blocking',
      code: 'no-rows',
      message: 'No se encontraron filas de datos debajo de los encabezados.',
      location: { sheet: sheet.name },
    });
  }

  const ok = !issues.some((i) => i.severity === 'blocking');

  return {
    detectedSheet: sheet.name,
    headerRow: header.index + 1,
    headers: headerCells.map((c) => c?.trim() ?? '').filter((c) => c !== ''),
    missing,
    extra,
    legacyPases,
    mappingColumn,
    rows,
    issues,
    ok,
  };
}
