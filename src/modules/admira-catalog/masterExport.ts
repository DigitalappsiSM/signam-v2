import type { Column, Workbook, Worksheet } from 'exceljs';
import {
  ADMIRA_CATALOG_HEADERS,
  CALENDAR_MAPPING_HEADERS,
  type AdmiraCatalogHeader,
  type AdmiraScreen,
} from '@/domain';

/**
 * Exportación del catálogo Admira al formato del MAESTRO (.xlsx).
 *
 * Es la operación inversa de `masterImport`: genera un libro con la hoja
 * `Consolidado` cuyos encabezados son los 12 campos oficiales
 * (`ADMIRA_CATALOG_HEADERS`, en su orden autoritativo), de modo que el archivo
 * resultante puede volver a importarse sin incidencias (`analyzeMaster` la
 * re-detecta por el nombre de hoja y los encabezados).
 *
 * Reglas respetadas:
 * - Solo se exportan los **12 campos oficiales** del maestro. La metadata SIGNAM
 *   (`active`, `version`, autores, marcas de tiempo…) NUNCA se escribe dentro del
 *   maestro. La única columna adicional posible es `NORMALIZACION LIVERPOOL`, que
 *   es una columna legítima del maestro (mapeo al soporte del calendario), no un
 *   metadato de sistema; se incluye de forma opcional para que el mapeo también
 *   viaje en el round-trip.
 * - Se escribe siempre el encabezado definitivo `TIPO DE PASES` (nunca el
 *   heredado `Pases`).
 *
 * `exceljs` se carga por **import dinámico** para no penalizar la carga inicial
 * de la página del catálogo (igual que `campaignExcelExport`).
 */

export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Nombre de la hoja operativa, igual al que espera la importación. */
export const EXPORT_SHEET_NAME = 'Consolidado';

/**
 * Encabezado canónico de la columna (opcional) de mapeo al soporte del
 * calendario. Es el primero de `CALENDAR_MAPPING_HEADERS`, que la importación
 * reconoce como alias válido.
 */
export const MAPPING_EXPORT_HEADER = CALENDAR_MAPPING_HEADERS[0];

/** Opciones de exportación del catálogo. */
export interface CatalogExportOptions {
  /** Incluir también las pantallas inactivas. Por defecto `false` (solo activas). */
  includeInactive?: boolean;
  /**
   * Incluir la columna `NORMALIZACION LIVERPOOL` con el mapeo al calendario.
   * Por defecto `true`, para que el mapeo también viaje en el round-trip.
   */
  includeMappingColumn?: boolean;
}

/** Ancho de columna razonable por encabezado oficial (mismo orden). */
const COLUMN_WIDTHS: Record<AdmiraCatalogHeader, number> = {
  'TIPO DE pantallas': 18,
  CENTROS: 22,
  CIRCUITO: 16,
  RESOLUCION: 16,
  FORMATO: 12,
  'Nombre en plataforma': 26,
  'TIPO DE PASES': 16,
  'Numero de Tienda': 14,
  'Nombre de tienda': 28,
  Modelo: 16,
  ARTICULOS: 20,
  BRANDS: 18,
};

const MAPPING_WIDTH = 24;

/** Índice (1-based) de la columna `Numero de Tienda` dentro del encabezado. */
const STORE_COLUMN_INDEX =
  ADMIRA_CATALOG_HEADERS.indexOf('Numero de Tienda') + 1;

/** Aplica negritas al encabezado, congela la fila 1 y activa el autofiltro. */
function styleSheet(sheet: Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnCount },
  };
}

/** Ajusta anchos y activa el ajuste de texto en las columnas de datos. */
function applyColumns(sheet: Worksheet, widths: readonly number[]): void {
  sheet.columns = widths.map((width) => ({ width })) as Partial<Column>[];
  for (let i = 1; i <= widths.length; i += 1) {
    sheet.getColumn(i).alignment = { vertical: 'top', wrapText: true };
  }
}

/** Escribe el número de tienda como texto (evita perder ceros o interpretarlo). */
function setStoreCellText(sheet: Worksheet, rowNumber: number): void {
  const cell = sheet.getCell(rowNumber, STORE_COLUMN_INDEX);
  cell.numFmt = '@';
  cell.alignment = { vertical: 'top', wrapText: true };
}

/** Encabezados de la hoja `Consolidado` según las opciones. */
function headerRow(includeMapping: boolean): string[] {
  return includeMapping
    ? [...ADMIRA_CATALOG_HEADERS, MAPPING_EXPORT_HEADER]
    : [...ADMIRA_CATALOG_HEADERS];
}

/** Anchos alineados con `headerRow`. */
function headerWidths(includeMapping: boolean): number[] {
  const base = ADMIRA_CATALOG_HEADERS.map((h) => COLUMN_WIDTHS[h]);
  return includeMapping ? [...base, MAPPING_WIDTH] : base;
}

/** Convierte una pantalla en la fila de valores (12 campos + mapeo opcional). */
function screenToRow(screen: AdmiraScreen, includeMapping: boolean): string[] {
  const values = ADMIRA_CATALOG_HEADERS.map((h) => screen.original[h] ?? '');
  return includeMapping
    ? [...values, screen.metadata.calendarSupport ?? '']
    : values;
}

/**
 * Construye el `Workbook` del catálogo actual en formato maestro.
 * Función asíncrona por el import dinámico de `exceljs`.
 */
export async function buildCatalogWorkbook(
  screens: readonly AdmiraScreen[],
  options: CatalogExportOptions = {},
): Promise<Workbook> {
  const { includeInactive = false, includeMappingColumn = true } = options;
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(EXPORT_SHEET_NAME);

  applyColumns(sheet, headerWidths(includeMappingColumn));
  sheet.addRow(headerRow(includeMappingColumn));

  const selected = includeInactive
    ? screens
    : screens.filter((s) => s.metadata.active);

  for (const screen of selected) {
    const row = sheet.addRow(screenToRow(screen, includeMappingColumn));
    setStoreCellText(sheet, row.number);
  }

  styleSheet(sheet, headerRow(includeMappingColumn).length);
  return wb;
}

/** Serializa el catálogo a un `Blob` `.xlsx`. */
export async function buildCatalogBlob(
  screens: readonly AdmiraScreen[],
  options: CatalogExportOptions = {},
): Promise<Blob> {
  const wb = await buildCatalogWorkbook(screens, options);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

// --- Plantilla ---------------------------------------------------------------

/** Descripción de un campo del maestro para la hoja de instrucciones. */
export interface FieldGuide {
  header: string;
  required: boolean;
  description: string;
  example: string;
}

/**
 * Guía de los 12 campos oficiales del maestro + la columna de mapeo. El orden
 * coincide con `ADMIRA_CATALOG_HEADERS`. Sirve para que un usuario que no conoce
 * el formato pueda crear el archivo sin ambigüedad.
 */
export const FIELD_GUIDE: readonly FieldGuide[] = [
  {
    header: 'TIPO DE pantallas',
    required: true,
    description: 'Tipo de pantalla o soporte físico del equipo.',
    example: 'VIDEOWALL',
  },
  {
    header: 'CENTROS',
    required: true,
    description: 'Centro o plaza al que pertenece la pantalla.',
    example: 'L CULIACAN - 46',
  },
  {
    header: 'CIRCUITO',
    required: true,
    description: 'Circuito de la pantalla.',
    example: 'VIDEOWALL',
  },
  {
    header: 'RESOLUCION',
    required: true,
    description:
      'Resolución en píxeles. Es una de las llaves de consolidación (Campaña + RESOLUCION); escríbela consistente.',
    example: '914 x 908',
  },
  {
    header: 'FORMATO',
    required: true,
    description: 'Formato u orientación de la pantalla.',
    example: 'HORIZONTAL',
  },
  {
    header: 'Nombre en plataforma',
    required: true,
    description:
      'Nombre con el que la pantalla aparece en la plataforma Admira.',
    example: 'GDL GALERIAS VW',
  },
  {
    header: 'TIPO DE PASES',
    required: true,
    description:
      'Tipo de pases contratados. Encabezado definitivo (no usar el heredado "Pases").',
    example: 'PASES FULL',
  },
  {
    header: 'Numero de Tienda',
    required: true,
    description:
      'Número de tienda Liverpool. Se cruza con el calendario junto con NORMALIZACION LIVERPOOL.',
    example: '78',
  },
  {
    header: 'Nombre de tienda',
    required: true,
    description: 'Nombre de la tienda.',
    example: 'L GUADALAJARA GALERIAS',
  },
  {
    header: 'Modelo',
    required: true,
    description: 'Modelo del equipo.',
    example: 'CRIUS',
  },
  {
    header: 'ARTICULOS',
    required: true,
    description:
      'Artículo(s) de la pantalla. Componen el nombre de campaña Admira (<Campaña>_ <ARTICULOS>).',
    example: 'VW 914x908',
  },
  {
    header: 'BRANDS',
    required: true,
    description: 'Marca(s) asociadas a la pantalla.',
    example: 'LIVERPOOL',
  },
  {
    header: MAPPING_EXPORT_HEADER,
    required: false,
    description:
      'Opcional pero recomendado. Mapeo al soporte del Calendario de Liverpool; se cruza con Numero de Tienda para asignar campañas.',
    example: 'VIDEO WALL CRIUS',
  },
];

/** Filas de ejemplo (realistas) que se colocan bajo los encabezados. */
const TEMPLATE_EXAMPLE_ROWS: Record<string, string>[] = [
  {
    'TIPO DE pantallas': 'VIDEOWALL',
    CENTROS: 'L GUADALAJARA GALERIAS',
    CIRCUITO: 'VIDEOWALL',
    RESOLUCION: '914 x 908',
    FORMATO: 'HORIZONTAL',
    'Nombre en plataforma': 'GDL GALERIAS VW',
    'TIPO DE PASES': 'PASES FULL',
    'Numero de Tienda': '78',
    'Nombre de tienda': 'L GUADALAJARA GALERIAS',
    Modelo: 'CRIUS',
    ARTICULOS: 'VW 914x908',
    BRANDS: 'LIVERPOOL',
    [MAPPING_EXPORT_HEADER]: 'VIDEO WALL CRIUS',
  },
];

export interface TemplateOptions {
  /** Incluir la columna de mapeo `NORMALIZACION LIVERPOOL`. Por defecto `true`. */
  includeMappingColumn?: boolean;
  /** Incluir una fila de ejemplo bajo los encabezados. Por defecto `true`. */
  includeExample?: boolean;
}

/** Nombre sugerido del archivo de plantilla. */
export const TEMPLATE_FILE_NAME = 'Plantilla maestro Admira.xlsx';

function addInstructionsSheet(wb: Workbook, includeMapping: boolean): void {
  const sheet = wb.addWorksheet('Instrucciones');
  applyColumns(sheet, [24, 14, 62, 24]);
  sheet.addRow(['Campo', 'Obligatorio', 'Descripción', 'Ejemplo']);
  const guide = includeMapping
    ? FIELD_GUIDE
    : FIELD_GUIDE.filter((f) => f.header !== MAPPING_EXPORT_HEADER);
  for (const field of guide) {
    sheet.addRow([
      field.header,
      field.required ? 'Sí' : 'Opcional',
      field.description,
      field.example,
    ]);
  }
  styleSheet(sheet, 4);
}

/**
 * Construye el `Workbook` de la plantilla: hoja `Consolidado` con los
 * encabezados (y opcionalmente una fila de ejemplo) + hoja `Instrucciones` que
 * describe cada campo.
 */
export async function buildTemplateWorkbook(
  options: TemplateOptions = {},
): Promise<Workbook> {
  const { includeMappingColumn = true, includeExample = true } = options;
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(EXPORT_SHEET_NAME);

  applyColumns(sheet, headerWidths(includeMappingColumn));
  const headers = headerRow(includeMappingColumn);
  sheet.addRow(headers);

  if (includeExample) {
    for (const example of TEMPLATE_EXAMPLE_ROWS) {
      const row = sheet.addRow(headers.map((h) => example[h] ?? ''));
      setStoreCellText(sheet, row.number);
    }
  }

  styleSheet(sheet, headers.length);
  addInstructionsSheet(wb, includeMappingColumn);
  return wb;
}

/** Serializa la plantilla a un `Blob` `.xlsx`. */
export async function buildTemplateBlob(
  options: TemplateOptions = {},
): Promise<Blob> {
  const wb = await buildTemplateWorkbook(options);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

// --- Nombres de archivo ------------------------------------------------------

/** Fecha `aaaa-mm-dd` (civil, sin desfase de zona) a partir de epoch millis. */
function isoDate(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Nombre del archivo del catálogo exportado: `Catálogo Admira_aaaa-mm-dd.xlsx`. */
export function catalogExportFileName(now: number = Date.now()): string {
  return `Catálogo Admira_${isoDate(now)}.xlsx`;
}
