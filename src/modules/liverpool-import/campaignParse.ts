import { classifySupport, type SupportOwner } from '@/domain';
import type { ValidationIssue } from '@/domain';
import type { CellComment, SheetData, WorkbookData } from './calendarImport';

/**
 * Paso 2a — Interpretación de campañas del Calendario de Liverpool.
 *
 * El calendario es una matriz: cada fila es una campaña y las columnas de
 * soporte marcan "Asignada" cuando participan; el comentario de esa celda lista
 * las tiendas (`número ⇥ nombre`). Aquí se estructura todo eso sin cruzar aún
 * contra el catálogo (ese es el paso 2b).
 */

/** Tienda asignada, extraída del comentario de una celda de soporte. */
export interface StoreRef {
  numero: string;
  nombre: string;
}

/** Alcance explícito del soporte; `invalid` nunca debe consolidar pantallas. */
export type CampaignSupportScope = 'all' | 'selected' | 'invalid';

/** Un soporte asignado a una campaña, con sus tiendas. */
export interface CampaignSupport {
  support: string;
  owner: SupportOwner;
  stores: StoreRef[];
  /**
   * Documentos legacy pueden no tener este campo: el consumidor debe inferir
   * `selected` si hay tiendas y `all` si la lista está vacía.
   */
  scope?: CampaignSupportScope;
}

/** Compatibilidad centralizada para campañas guardadas antes de `scope`. */
export function effectiveCampaignSupportScope(
  support: Pick<CampaignSupport, 'scope' | 'stores'>,
): CampaignSupportScope {
  return support.scope ?? (support.stores.length === 0 ? 'all' : 'selected');
}

/** Comentario presente cuyo alcance no pudo interpretarse de forma segura. */
export interface AmbiguousStoreComment {
  /** Llave estable dentro del archivo cargado. */
  id: string;
  sheet: string;
  row: number;
  col: number;
  address: string;
  campaignName: string;
  support: string;
  comment: string;
}

export interface ParsedCampaign {
  /** Fila de origen (1-based). */
  row: number;
  name: string;
  tipo: string;
  vendidoPor: string;
  fechaInicio: string;
  fechaFin: string;
  mes: string;
  /** Enlace al contenido (columna LINK del calendario); vacío si no hay. */
  link: string;
  supports: CampaignSupport[];
}

export interface CampaignParseResult {
  operativeSheet: string | null;
  headerRow: number | null;
  campaigns: ParsedCampaign[];
  /** Encabezados clasificados como columnas de soporte. */
  liverpoolSupports: string[];
  instoreSupports: string[];
  totalCampaigns: number;
  issues: ValidationIssue[];
  /** Asignaciones que requieren resolución humana antes de guardar. */
  ambiguousStoreComments: AmbiguousStoreComment[];
}

const PREFERRED_SHEETS = ['hoja 2', 'hoja2'];
const HEADER_SEARCH_DEPTH = 20;

/** Columnas de metadatos de la campaña (no son soportes). */
const META_HEADERS: Record<string, keyof MetaCols> = {
  mes: 'mes',
  'campanas digitales': 'name',
  'tipo de campana': 'tipo',
  link: 'link',
  'campana nueva/ actualizada': 'nuevaAct',
  'campana nueva/actualizada': 'nuevaAct',
  'vendido por': 'vendidoPor',
  'fecha inicio': 'fechaInicio',
  'fecha fin': 'fechaFin',
};

interface MetaCols {
  mes: number;
  name: number;
  tipo: number;
  link: number;
  nuevaAct: number;
  vendidoPor: number;
  fechaInicio: number;
  fechaFin: number;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function nonEmptyCount(row: string[]): number {
  return row.reduce((n, cell) => (cell && cell.trim() !== '' ? n + 1 : n), 0);
}

function detectHeaderRow(rows: string[][]): number {
  let best = { index: -1, score: 0 };
  const depth = Math.min(rows.length, HEADER_SEARCH_DEPTH);
  for (let i = 0; i < depth; i += 1) {
    const score = nonEmptyCount(rows[i] ?? []);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function pickOperative(sheets: readonly SheetData[]): SheetData | null {
  if (sheets.length === 0) return null;
  const preferred = sheets.find((s) =>
    PREFERRED_SHEETS.includes(normalizeHeader(s.name)),
  );
  if (preferred) return preferred;
  return sheets.reduce((acc, s) => {
    const score = nonEmptyCount(s.rows[detectHeaderRow(s.rows)] ?? []);
    const accScore = nonEmptyCount(acc.rows[detectHeaderRow(acc.rows)] ?? []);
    return score > accScore ? s : acc;
  }, sheets[0]!);
}

/**
 * Parsea el texto de un comentario de tiendas: cada línea es `número<sep>nombre`
 * (separador tabulador o espacios). Solo se consideran líneas cuyo primer token
 * es numérico (el número de tienda); las demás (títulos, notas) se ignoran, para
 * no confundir, p. ej., la "L" del nombre con un número de tienda.
 */
export function parseStoreComment(text: string): StoreRef[] {
  const stores: StoreRef[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    const match = line.match(/^(\d+)[\t ]+(.*)$/);
    if (match) {
      stores.push({ numero: match[1]!, nombre: match[2]!.trim() });
    } else if (/^\d+$/.test(line)) {
      stores.push({ numero: line, nombre: '' });
    }
    // Líneas sin número de tienda al inicio se ignoran.
  }
  return stores;
}

/** Marcadores inequívocos que autorizan el circuito completo. */
export function isExplicitAllStoreComment(text: string): boolean {
  const normalized = normalizeHeader(text).replace(/[.!;:]+$/g, '');
  return (
    normalized === 'todas' ||
    normalized === 'todas las tiendas' ||
    normalized === 'todas las pantallas'
  );
}

/** Índice de comentarios por `fila:columna` (1-based). */
function indexComments(
  comments: readonly CellComment[],
): Map<string, CellComment> {
  const map = new Map<string, CellComment>();
  for (const c of comments) map.set(`${c.sheet}:${c.row}:${c.col}`, c);
  return map;
}

/** Interpreta el calendario y devuelve las campañas estructuradas. Función pura. */
export function parseCampaigns(data: WorkbookData): CampaignParseResult {
  const issues: ValidationIssue[] = [];
  const operative = pickOperative(data.sheets);

  if (!operative) {
    issues.push({
      severity: 'blocking',
      code: 'empty-workbook',
      message: 'El archivo no contiene hojas legibles.',
    });
    return emptyResult(issues);
  }

  const headerIndex = detectHeaderRow(operative.rows);
  const headerRow = (operative.rows[headerIndex] ?? []).map(
    (c) => c?.trim() ?? '',
  );

  // Clasificar columnas: metadatos vs soportes.
  const meta: MetaCols = {
    mes: -1,
    name: -1,
    tipo: -1,
    link: -1,
    nuevaAct: -1,
    vendidoPor: -1,
    fechaInicio: -1,
    fechaFin: -1,
  };
  const supportColumns: { col: number; header: string; owner: SupportOwner }[] =
    [];

  headerRow.forEach((header, col) => {
    if (header === '') return;
    const key = META_HEADERS[normalizeHeader(header)];
    if (key) {
      if (meta[key] === -1) meta[key] = col;
    } else {
      supportColumns.push({ col, header, owner: classifySupport(header) });
    }
  });

  if (meta.name === -1) {
    issues.push({
      severity: 'blocking',
      code: 'missing-campaign-column',
      message:
        'No se encontró la columna del nombre de campaña ("CAMPAÑAS DIGITALES").',
      location: { sheet: operative.name, row: headerIndex + 1 },
    });
    return emptyResult(issues, operative.name, headerIndex + 1);
  }

  const commentIndex = indexComments(data.comments);
  const cellText = (row: string[], col: number) =>
    col >= 0 ? (row[col] ?? '').trim() : '';

  const campaigns: ParsedCampaign[] = [];
  const ambiguousStoreComments: AmbiguousStoreComment[] = [];
  for (let r = headerIndex + 1; r < operative.rows.length; r += 1) {
    const row = operative.rows[r] ?? [];
    const name = cellText(row, meta.name);
    if (name === '') continue;

    const supports: CampaignSupport[] = [];
    for (const sc of supportColumns) {
      if (cellText(row, sc.col) === '') continue; // no "Asignada"
      const comment = commentIndex.get(
        `${operative.name}:${r + 1}:${sc.col + 1}`,
      );
      const stores = comment ? parseStoreComment(comment.text) : [];
      let scope: CampaignSupportScope = comment ? 'selected' : 'all';
      if (comment && stores.length === 0) {
        if (isExplicitAllStoreComment(comment.text)) {
          scope = 'all';
        } else {
          scope = 'invalid';
          ambiguousStoreComments.push({
            id: `${operative.name}:${r + 1}:${sc.col + 1}`,
            sheet: operative.name,
            row: r + 1,
            col: sc.col + 1,
            address: comment.address,
            campaignName: name,
            support: sc.header,
            comment: comment.text,
          });
        }
      }
      supports.push({
        support: sc.header,
        owner: sc.owner,
        stores,
        scope,
      });
    }

    campaigns.push({
      row: r + 1,
      name,
      tipo: cellText(row, meta.tipo),
      vendidoPor: cellText(row, meta.vendidoPor),
      fechaInicio: cellText(row, meta.fechaInicio),
      fechaFin: cellText(row, meta.fechaFin),
      mes: cellText(row, meta.mes),
      link: cellText(row, meta.link),
      supports,
    });
  }

  if (campaigns.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'no-campaigns',
      message: 'No se encontraron campañas con nombre en la hoja.',
      location: { sheet: operative.name },
    });
  }

  return {
    operativeSheet: operative.name,
    headerRow: headerIndex + 1,
    campaigns,
    liverpoolSupports: supportColumns
      .filter((s) => s.owner === 'liverpool')
      .map((s) => s.header),
    instoreSupports: supportColumns
      .filter((s) => s.owner === 'instore-media')
      .map((s) => s.header),
    totalCampaigns: campaigns.length,
    issues,
    ambiguousStoreComments,
  };
}

function emptyResult(
  issues: ValidationIssue[],
  operativeSheet: string | null = null,
  headerRow: number | null = null,
): CampaignParseResult {
  return {
    operativeSheet,
    headerRow,
    campaigns: [],
    liverpoolSupports: [],
    instoreSupports: [],
    totalCampaigns: 0,
    issues,
    ambiguousStoreComments: [],
  };
}
