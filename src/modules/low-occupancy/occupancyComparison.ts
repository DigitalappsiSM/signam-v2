import { ADMIRA_CSV_COLUMNS } from '@/domain';
import type { AdmiraCsvRow } from '@/domain';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import {
  addDays,
  formatDdMmYyyy,
  toIsoDate,
} from '@/modules/operational-tracking/businessDays';
import type {
  OccupancyAnalysis,
  OccupancyExportGroup,
  OccupancyUnit,
} from './types';

/**
 * Comparación de la baja ocupación de una fecha contra su **día calendario
 * anterior**. Motor puro (sin React, Firebase ni efectos), reutiliza el
 * resultado de `analyzeLowOccupancy` — no reimplementa consolidación ni
 * serialización.
 *
 * Semántica y **limitación importante** (opción sin persistencia): "ayer" se
 * reconstruye con las **campañas y el maestro actuales**, no con un snapshot de
 * lo que se vio ese día. Si el maestro o el calendario cambiaron después, esta
 * comparación **no reproduce necesariamente el archivo exacto** que se generó
 * ayer; indica si el resultado que Admira recibiría hoy **para la fecha
 * anterior** difiere del de la fecha seleccionada. Sirve para evitar cargar en
 * Admira archivos idénticos día tras día, no como historial auditable.
 *
 * Criterio de cambio (autoritativo): se comparan las **filas finales
 * deduplicadas** de Admira por grupo (`normalización + resolución`) y por ratio,
 * ignorando el orden, el encabezado, el BOM, el nombre del archivo y las fechas
 * del nombre. El contador ilustrativo de pantallas **no** determina el cambio.
 * "Sin proveedores" se compara por unidades `tienda + normalización +
 * resolución`.
 */

/** Estado de comparación de una tarjeta o sección respecto al día anterior. */
export type ComparisonStatus = 'sin-cambios' | 'cambio' | 'nuevo' | 'vacio';

/** Etiquetas textuales (accesibilidad: nunca solo color). */
export const COMPARISON_LABELS: Record<ComparisonStatus, string> = {
  'sin-cambios': 'Sin cambios',
  cambio: 'Cambió',
  nuevo: 'Nuevo',
  vacio: 'Ya no tiene contenido',
};

/**
 * Resta **un día civil** a una fecha `AAAA-MM-DD` sin desfase de zona horaria.
 * Toda la aritmética se hace en UTC (vía `parseCampaignDate` + `addDays`), por
 * lo que los cambios de mes y de año se resuelven correctamente. Si la fecha no
 * es interpretable, se devuelve tal cual.
 */
export function previousCivilDate(iso: string): string {
  const d = parseCampaignDate(iso);
  if (!d) return iso;
  return toIsoDate(addDays(d, -1));
}

/** Formatea una fecha `AAAA-MM-DD` a `dd/mm/aaaa` (fecha civil). */
export function formatIsoDdMmYyyy(iso: string): string {
  const d = parseCampaignDate(iso);
  return d ? formatDdMmYyyy(d) : iso;
}

/** `"1 centro"` / `"N centros"` (singular/plural). */
export function pluralizeCentros(n: number): string {
  return `${n} ${n === 1 ? 'centro' : 'centros'}`;
}

/** Referencia ligera a un centro (unidad) que entró o salió. */
export interface CentroRef {
  key: string;
  storeNumber: string;
  storeName: string;
  centros: string;
  normalization: string;
  resolution: string;
}

/** Comparación de una sección (Ratio 1, Ratio 3 o Sin proveedores). */
export interface SectionComparison {
  status: ComparisonStatus;
  /** Conteo del día seleccionado (filas deduplicadas o unidades). */
  today: number;
  /** Conteo del día anterior. */
  yesterday: number;
  /** Centros presentes hoy pero no ayer. */
  entered: CentroRef[];
  /** Centros presentes ayer pero no hoy. */
  exited: CentroRef[];
}

/** Comparación completa de un grupo `normalización + resolución`. */
export interface GroupComparison {
  key: string;
  normalization: string;
  resolution: string;
  /** Estado general de la tarjeta (agrega Ratio 1 + Ratio 3). */
  overall: ComparisonStatus;
  ratio1: SectionComparison;
  ratio3: SectionComparison;
  zero: SectionComparison;
  /** ¿Hay algún cambio real (estado o entradas/salidas)? */
  hasChanges: boolean;
}

/** Resultado de comparar dos análisis (fecha seleccionada vs. día anterior). */
export interface OccupancyComparison {
  /** Fecha seleccionada `AAAA-MM-DD`. */
  selectedDate: string;
  /** Día calendario anterior `AAAA-MM-DD`. */
  previousDate: string;
  /** Comparaciones por clave de grupo `normalización|resolución`. */
  groups: Map<string, GroupComparison>;
}

// Separador de campos poco probable dentro de un valor real.
const FIELD_SEP = '\u0001';

/** Firma estable de una fila (independiente del orden de llaves del objeto). */
function rowSignature(row: AdmiraCsvRow): string {
  return ADMIRA_CSV_COLUMNS.map((c) => row[c] ?? '').join(FIELD_SEP);
}

/** Conjunto de firmas de un lote de filas ya deduplicadas. */
function rowSignatureSet(rows: readonly AdmiraCsvRow[]): Set<string> {
  return new Set(rows.map(rowSignature));
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/** Deriva el estado a partir de los conteos y la igualdad de conjuntos. */
function statusFor(
  today: number,
  yesterday: number,
  equal: boolean,
): ComparisonStatus {
  if (today === 0 && yesterday === 0) return 'sin-cambios';
  if (yesterday === 0) return 'nuevo';
  if (today === 0) return 'vacio';
  return equal ? 'sin-cambios' : 'cambio';
}

function centroRef(u: OccupancyUnit): CentroRef {
  return {
    key: u.key,
    storeNumber: u.storeNumber,
    storeName: u.storeName,
    centros: u.centros,
    normalization: u.normalization,
    resolution: u.resolution,
  };
}

/** Centros que entraron (hoy y no ayer) y salieron (ayer y no hoy), por unidad. */
function diffUnits(
  today: readonly OccupancyUnit[],
  yesterday: readonly OccupancyUnit[],
): { entered: CentroRef[]; exited: CentroRef[] } {
  const todayKeys = new Set(today.map((u) => u.key));
  const yesterdayKeys = new Set(yesterday.map((u) => u.key));
  return {
    entered: today.filter((u) => !yesterdayKeys.has(u.key)).map(centroRef),
    exited: yesterday.filter((u) => !todayKeys.has(u.key)).map(centroRef),
  };
}

/**
 * Compara una sección de ratio por sus **filas deduplicadas** (criterio
 * autoritativo). Las entradas/salidas se resuelven por unidad para el detalle.
 */
function compareRatioSection(
  todayRows: readonly AdmiraCsvRow[],
  yesterdayRows: readonly AdmiraCsvRow[],
  todayUnits: readonly OccupancyUnit[],
  yesterdayUnits: readonly OccupancyUnit[],
): SectionComparison {
  const equal = setsEqual(
    rowSignatureSet(todayRows),
    rowSignatureSet(yesterdayRows),
  );
  const { entered, exited } = diffUnits(todayUnits, yesterdayUnits);
  return {
    status: statusFor(todayRows.length, yesterdayRows.length, equal),
    today: todayRows.length,
    yesterday: yesterdayRows.length,
    entered,
    exited,
  };
}

/** Compara "Sin proveedores" por unidades `tienda + normalización + resolución`. */
function compareZeroSection(
  todayUnits: readonly OccupancyUnit[],
  yesterdayUnits: readonly OccupancyUnit[],
): SectionComparison {
  const todayKeys = new Set(todayUnits.map((u) => u.key));
  const yesterdayKeys = new Set(yesterdayUnits.map((u) => u.key));
  const { entered, exited } = diffUnits(todayUnits, yesterdayUnits);
  return {
    status: statusFor(
      todayUnits.length,
      yesterdayUnits.length,
      setsEqual(todayKeys, yesterdayKeys),
    ),
    today: todayUnits.length,
    yesterday: yesterdayUnits.length,
    entered,
    exited,
  };
}

/** Conjunto de firmas de todas las filas del grupo, etiquetadas por ratio. */
function taggedRowSet(group: OccupancyExportGroup | undefined): Set<string> {
  const out = new Set<string>();
  if (!group) return out;
  for (const row of group.ratio1Rows)
    out.add(`1${FIELD_SEP}${rowSignature(row)}`);
  for (const row of group.ratio3Rows)
    out.add(`3${FIELD_SEP}${rowSignature(row)}`);
  return out;
}

const EMPTY_ROWS: readonly AdmiraCsvRow[] = [];
const EMPTY_UNITS: readonly OccupancyUnit[] = [];

function sectionHasDiff(s: SectionComparison): boolean {
  return (
    s.status !== 'sin-cambios' || s.entered.length > 0 || s.exited.length > 0
  );
}

/**
 * Compara dos análisis (fecha seleccionada vs. día anterior) calculados con los
 * **mismos datos cargados**. No muta los análisis recibidos.
 */
export function compareOccupancy(
  current: OccupancyAnalysis,
  previous: OccupancyAnalysis,
): OccupancyComparison {
  const currentByKey = new Map(current.groups.map((g) => [g.key, g]));
  const previousByKey = new Map(previous.groups.map((g) => [g.key, g]));
  const keys = new Set<string>([
    ...currentByKey.keys(),
    ...previousByKey.keys(),
  ]);

  const groups = new Map<string, GroupComparison>();
  for (const key of keys) {
    const cur = currentByKey.get(key);
    const prev = previousByKey.get(key);

    const ratio1 = compareRatioSection(
      cur?.ratio1Rows ?? EMPTY_ROWS,
      prev?.ratio1Rows ?? EMPTY_ROWS,
      cur?.ratio1Units ?? EMPTY_UNITS,
      prev?.ratio1Units ?? EMPTY_UNITS,
    );
    const ratio3 = compareRatioSection(
      cur?.ratio3Rows ?? EMPTY_ROWS,
      prev?.ratio3Rows ?? EMPTY_ROWS,
      cur?.ratio3Units ?? EMPTY_UNITS,
      prev?.ratio3Units ?? EMPTY_UNITS,
    );
    const zero = compareZeroSection(
      cur?.zeroUnits ?? EMPTY_UNITS,
      prev?.zeroUnits ?? EMPTY_UNITS,
    );

    const curTagged = taggedRowSet(cur);
    const prevTagged = taggedRowSet(prev);
    const overall = statusFor(
      curTagged.size,
      prevTagged.size,
      setsEqual(curTagged, prevTagged),
    );

    groups.set(key, {
      key,
      normalization: cur?.normalization ?? prev?.normalization ?? '',
      resolution: cur?.resolution ?? prev?.resolution ?? '',
      overall,
      ratio1,
      ratio3,
      zero,
      hasChanges:
        overall !== 'sin-cambios' ||
        sectionHasDiff(ratio1) ||
        sectionHasDiff(ratio3) ||
        sectionHasDiff(zero),
    });
  }

  return {
    selectedDate: current.analysisDate,
    previousDate: previous.analysisDate,
    groups,
  };
}
