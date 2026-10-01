import {
  canonicalState,
  canonicalZone,
  foldText,
  isInsideMexico,
  normalizePostalCode,
  stateForPostalCode,
  type MexicanState,
  type StoreZone,
} from './geography';

/**
 * Directorio de tiendas Liverpool: una ficha por número de tienda con su
 * dirección, código postal, estado, zona y coordenadas.
 *
 * Es la fuente única de ubicación: el catálogo Admira la consulta por
 * `Numero de Tienda` y nunca guarda una copia propia del CP. No forma parte del
 * maestro ni del CSV de Admira, y la consolidación no lo usa.
 */

export type StoreStatus = 'active' | 'inactive';
export type CoordinateSource = 'ekon' | 'manual';

export interface StoreDirectoryEntry {
  /** Número de tienda normalizado (sin ceros a la izquierda). Id del documento. */
  storeNumber: string;
  name: string;
  status: StoreStatus;
  street: string;
  neighborhood: string;
  municipality: string;
  state: MexicanState | null;
  zone: StoreZone | null;
  /** CP de 5 dígitos, o `null` si el origen no traía uno válido. */
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  coordinateSource: CoordinateSource | null;
}

/**
 * Ficha tal como sale de un archivo. `status` es `null` cuando el archivo no
 * trae estatus: así una actualización parcial (solo CP o solo coordenadas) no
 * reactiva una tienda que estaba inactiva.
 */
export type ImportedDirectoryEntry = Omit<StoreDirectoryEntry, 'status'> & {
  status: StoreStatus | null;
};

export type DirectoryIssueCode =
  | 'missing-header'
  | 'missing-store-number'
  | 'duplicate-store-number'
  | 'invalid-postal-code'
  | 'postal-code-state-mismatch'
  | 'unknown-state'
  | 'unknown-zone'
  | 'invalid-coordinates'
  | 'coordinates-without-store'
  | 'missing-coordinates';

export interface DirectoryIssue {
  code: DirectoryIssueCode;
  /** `error` bloquea la fila; `warning` se guarda pero se reporta. */
  severity: 'error' | 'warning';
  storeNumber: string | null;
  /** Hoja y fila (1-based) de origen, para que el usuario lo corrija en su Excel. */
  sheet: string;
  row: number | null;
  message: string;
}

/** Hoja como cuadrícula de texto (misma forma que produce `readWorkbook`). */
export interface DirectorySheet {
  name: string;
  rows: string[][];
}

/** Normaliza el número de tienda: `0078` y `78` son la misma tienda. */
export function normalizeStoreNumber(value: unknown): string {
  const t = String(value ?? '')
    .trim()
    .replace(/\.0+$/, '');
  return /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : t;
}

/** Un número de tienda debe servir como id de documento (sin `/`, no vacío). */
export function isValidStoreNumber(value: string): boolean {
  return value !== '' && !value.includes('/') && value.length <= 40;
}

function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

type ColumnKey =
  | 'storeNumber'
  | 'name'
  | 'status'
  | 'street'
  | 'neighborhood'
  | 'municipality'
  | 'zone'
  | 'state'
  | 'postalCode'
  | 'lat'
  | 'lng';

/** Encabezados aceptados (comparados sin acentos ni mayúsculas). */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  storeNumber: [
    'numero de sucursal',
    'numero de tienda',
    'determinante',
    'no tienda',
  ],
  name: ['tienda: nombre sucursal', 'nombre de tienda', 'tienda', 'nombre'],
  // «Alta en Ekon» no es estatus: indica alta en el ERP, no tienda abierta.
  status: ['estatus de tienda', 'estatus'],
  street: ['calle y no', 'direccion', 'calle'],
  neighborhood: ['colonia'],
  municipality: ['municipio / delegacion', 'municipio', 'alcaldia'],
  zone: ['zona'],
  state: ['estado'],
  postalCode: ['codigo postal', 'cp', 'c p'],
  lat: ['latitud', 'lat'],
  lng: ['longitud', 'longuitud', 'lng', 'lon'],
};

function headerKey(cell: string): ColumnKey | null {
  const folded = foldText(cell).replace(/\s*:\s*/g, ': ');
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(folded)) return key as ColumnKey;
  }
  return null;
}

interface LocatedHeader {
  index: number;
  columns: Partial<Record<ColumnKey, number>>;
}

/** Busca, en las primeras filas, la que tiene número de tienda y al menos otro campo útil. */
function locateHeader(rows: string[][]): LocatedHeader | null {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const columns: Partial<Record<ColumnKey, number>> = {};
    (rows[i] ?? []).forEach((cell, c) => {
      const key = headerKey(cell);
      if (key && columns[key] === undefined) columns[key] = c;
    });
    if (columns.storeNumber !== undefined && Object.keys(columns).length >= 2) {
      return { index: i, columns };
    }
  }
  return null;
}

function parseCoordinate(value: string): number | null {
  const t = value.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Fila leída de una hoja, antes de fusionar fuentes. */
export interface DirectoryRow {
  storeNumber: string;
  sheet: string;
  row: number;
  values: Partial<Record<ColumnKey, string>>;
}

/**
 * Lee todas las hojas reconocibles de un libro. Una hoja aporta filas si su
 * encabezado tiene número de tienda (o determinante) y otro campo conocido;
 * las demás hojas se ignoran sin error (p. ej. «Articulos» del archivo Ekon).
 */
export function readDirectorySheets(sheets: readonly DirectorySheet[]): {
  rows: DirectoryRow[];
  issues: DirectoryIssue[];
} {
  const rows: DirectoryRow[] = [];
  const issues: DirectoryIssue[] = [];
  let recognized = 0;
  for (const sheet of sheets) {
    const header = locateHeader(sheet.rows);
    if (!header) continue;
    recognized += 1;
    for (let r = header.index + 1; r < sheet.rows.length; r += 1) {
      const cells = sheet.rows[r] ?? [];
      if (cells.every((c) => clean(c).replace(/^\.$/, '') === '')) continue;
      const values: Partial<Record<ColumnKey, string>> = {};
      for (const [key, col] of Object.entries(header.columns)) {
        values[key as ColumnKey] = clean(cells[col]);
      }
      const storeNumber = normalizeStoreNumber(values.storeNumber);
      if (!isValidStoreNumber(storeNumber)) {
        issues.push({
          code: 'missing-store-number',
          severity: 'error',
          storeNumber: null,
          sheet: sheet.name,
          row: r + 1,
          message:
            storeNumber === ''
              ? 'Fila sin número de tienda; se omite.'
              : `Número de tienda inválido «${storeNumber}»; se omite.`,
        });
        continue;
      }
      rows.push({ storeNumber, sheet: sheet.name, row: r + 1, values });
    }
  }
  if (recognized === 0) {
    issues.push({
      code: 'missing-header',
      severity: 'error',
      storeNumber: null,
      sheet: '',
      row: null,
      message:
        'Ninguna hoja tiene encabezados de directorio (número de tienda o determinante, más dirección, CP o coordenadas).',
    });
  }
  return { rows, issues };
}

function parseStatus(value: string | undefined): StoreStatus | null {
  const folded = foldText(value ?? '');
  if (folded === '') return null;
  if (['activa', 'activo', 'true', 'si', '1'].includes(folded)) return 'active';
  if (['inactiva', 'inactivo', 'false', 'no', '0', 'cerrada'].includes(folded))
    return 'inactive';
  return null;
}

/** Primer valor no vacío. */
function pick(...values: (string | undefined)[]): string {
  return values.find((v) => (v ?? '') !== '') ?? '';
}

/**
 * Fusiona las filas de todas las hojas en una ficha por tienda.
 *
 * - La hoja con dirección/CP manda sobre los datos postales; la que trae
 *   latitud/longitud aporta coordenadas (origen `ekon`).
 * - Un número de tienda repetido dentro de la misma hoja es error: no se elige
 *   una fila al azar.
 * - CP sin cero inicial se corrige; CP de otro estado se reporta y se guarda
 *   tal cual (el usuario decide), pero nunca se inventa uno.
 */
export function buildDirectory(rows: readonly DirectoryRow[]): {
  entries: ImportedDirectoryEntry[];
  issues: DirectoryIssue[];
} {
  const issues: DirectoryIssue[] = [];
  const bySheetStore = new Map<string, DirectoryRow>();
  const byStore = new Map<string, DirectoryRow[]>();
  for (const row of rows) {
    const k = `${row.sheet}|${row.storeNumber}`;
    const prev = bySheetStore.get(k);
    if (prev) {
      issues.push({
        code: 'duplicate-store-number',
        severity: 'error',
        storeNumber: row.storeNumber,
        sheet: row.sheet,
        row: row.row,
        message: `La tienda ${row.storeNumber} aparece de nuevo (ya estaba en la fila ${prev.row}); se conserva la primera.`,
      });
      continue;
    }
    bySheetStore.set(k, row);
    const list = byStore.get(row.storeNumber) ?? [];
    list.push(row);
    byStore.set(row.storeNumber, list);
  }

  const entries: ImportedDirectoryEntry[] = [];
  for (const [storeNumber, list] of byStore) {
    const postal = list.find(
      (r) => r.values.postalCode !== undefined || r.values.state !== undefined,
    );
    const geo = list.find(
      (r) => (r.values.lat ?? '') !== '' || (r.values.lng ?? '') !== '',
    );
    if (!postal) {
      issues.push({
        code: 'coordinates-without-store',
        severity: 'warning',
        storeNumber,
        sheet: geo?.sheet ?? list[0]!.sheet,
        row: geo?.row ?? list[0]!.row,
        message: `La tienda ${storeNumber} trae coordenadas pero no aparece en el directorio de direcciones.`,
      });
    }
    const main = postal ?? list[0]!;
    const v = main.values;
    const at = (
      code: DirectoryIssueCode,
      message: string,
      sev: DirectoryIssue['severity'] = 'warning',
      src = main,
    ) =>
      issues.push({
        code,
        severity: sev,
        storeNumber,
        sheet: src.sheet,
        row: src.row,
        message,
      });

    const state = v.state ? canonicalState(v.state) : null;
    if (v.state && !state)
      at('unknown-state', `Estado no reconocido: «${v.state}».`);
    const zone = v.zone ? canonicalZone(v.zone) : null;
    if (v.zone && !zone) at('unknown-zone', `Zona no reconocida: «${v.zone}».`);

    const postalCode = normalizePostalCode(v.postalCode);
    if ((v.postalCode ?? '') !== '' && !postalCode) {
      at('invalid-postal-code', `Código postal inválido: «${v.postalCode}».`);
    } else if (
      postalCode &&
      state &&
      stateForPostalCode(postalCode) !== state
    ) {
      at(
        'postal-code-state-mismatch',
        `El CP ${postalCode} corresponde a ${stateForPostalCode(postalCode)}, pero la tienda está en ${state}.`,
      );
    }

    let lat: number | null = null;
    let lng: number | null = null;
    let badCoordinates = false;
    if (geo) {
      const la = parseCoordinate(geo.values.lat ?? '');
      const ln = parseCoordinate(geo.values.lng ?? '');
      if (la !== null && ln !== null && isInsideMexico(la, ln)) {
        lat = la;
        lng = ln;
      } else {
        badCoordinates = true;
        at(
          'invalid-coordinates',
          `Coordenadas fuera de México o incompletas: ${geo.values.lat || '—'}, ${geo.values.lng || '—'}.`,
          'warning',
          geo,
        );
      }
    }

    const status =
      parseStatus(postal?.values.status) ?? parseStatus(geo?.values.status);
    if (lat === null && status !== 'inactive' && !badCoordinates) {
      at(
        'missing-coordinates',
        `La tienda ${storeNumber} no tiene coordenadas; el mapa la ubicará por municipio.`,
      );
    }

    entries.push({
      storeNumber,
      name: pick(postal?.values.name, geo?.values.name),
      status,
      street: v.street ?? '',
      neighborhood: v.neighborhood ?? '',
      municipality: v.municipality ?? '',
      state: state ?? (postalCode ? stateForPostalCode(postalCode) : null),
      zone,
      postalCode,
      lat,
      lng,
      coordinateSource: lat === null ? null : 'ekon',
    });
  }
  entries.sort((a, b) => compareStoreNumbers(a.storeNumber, b.storeNumber));
  return { entries, issues };
}

/** Orden natural: numéricos ascendentes, luego códigos alfanuméricos. */
export function compareStoreNumbers(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, 'es');
}
