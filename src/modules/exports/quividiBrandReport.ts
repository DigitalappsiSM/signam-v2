import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  type QuividiCampaignReport,
  type QuividiMeasurementStatus,
  type QuividiSupportDay,
} from '@/domain';

/**
 * Capa pura del informe comercial de audiencia.
 *
 * El Excel técnico conserva el detalle original. Este módulo prepara únicamente
 * la vista agregada que se comparte con marcas: OTS, cobertura de tiendas,
 * extrapolación y distribuciones porcentuales de audiencia.
 */

export interface BrandCoverage {
  totalStores: number;
  measuredStores: number;
  estimatedStores: number;
  /** Cobertura por tienda: tiendas con alguna medición sobre el universo. */
  measuredPercent: number;
  estimatedPercent: number;
  /** Tiendas del universo × días de vigencia. */
  totalStoreDays: number;
  /** Tienda-día con al menos un soporte medido. */
  measuredStoreDays: number;
  /**
   * Completitud real de la medición. A diferencia de `measuredPercent`, una
   * tienda cuya cámara cae a mitad de vigencia deja de contar como cubierta
   * durante los días sin dato.
   */
  storeDayPercent: number;
}

/**
 * Base sobre la que se extrapola. La unidad es el par-día (tienda × soporte ×
 * fecha) porque es la unidad en la que se acumulan los OTS.
 */
export interface BrandExtrapolationBasis {
  days: number;
  totalPairs: number;
  measuredPairs: number;
  totalPairDays: number;
  /** Par-día con medición válida (completa o parcial). */
  measuredPairDays: number;
  completePairDays: number;
  partialPairDays: number;
  /** Par-día de un soporte con cámara instalada que no reportó ese día. */
  missingPairDays: number;
  /** Par-día de soportes del universo sin cámara instalada. */
  uncoveredPairDays: number;
  otsPerMeasuredPairDay: number;
}

export interface BrandHeader {
  campaignName: string;
  periodLabel: string;
  days: number;
  totalStores: number;
  measuredStores: number;
  supports: string[];
  storeSupportPairs: number;
}

export interface BrandCampaignSummary {
  measuredOts: number;
  extrapolatedOts: number;
  estimatedOts: number;
  dailyAverage: number;
  dailyPerStore: number;
  dailyPerSupport: number;
  coverage: BrandCoverage;
  basis: BrandExtrapolationBasis;
  scope: BrandMeasurableScope;
  /**
   * OTS medidos del día incompleto (ya incluidos en `measuredOts` y
   * `estimatedOts`, nunca extrapolados); 0 si no hay día incompleto.
   */
  partialOts: number;
}

export interface BrandDailyPoint {
  date: string;
  label: string;
  measuredOts: number;
  estimatedOts: number;
  /** Pares medidos ese día; 0 significa jornada sin ninguna medición. */
  measuredPairs: number;
  /** Factor de extrapolación aplicado a ese día concreto. */
  factor: number;
  /** Hora `HH:MM` hasta la que se midió, sólo en el día incompleto. */
  partialUntil?: string;
}

export interface BrandShare {
  label: string;
  share: number;
}

/** Un formato de soporte del circuito y cuánto se midió de él. */
export interface BrandSupportFormat {
  support: string;
  /** Soportes de ese formato en el universo contratado. */
  pairs: number;
  /** Soportes de ese formato con cámara instalada. */
  mappedPairs: number;
  pairDays: number;
  measuredPairDays: number;
  measuredOts: number;
  /** Pares medidos del formato en el día incompleto (fuera de la rejilla). */
  partialPairs: number;
  /** OTS medidos del formato en el día incompleto; nunca se extrapolan. */
  partialOts: number;
  /** Hubo al menos una jornada medida en este formato durante la vigencia. */
  measurable: boolean;
}

/**
 * Reparto del circuito entre lo que se puede medir y lo que no.
 *
 * La cifra publicada cubre únicamente los formatos con medición: extrapolar la
 * audiencia de un mupi a un video wall o a un CRIUS supondría que un pasillo y
 * un atrio ven pasar a la misma gente. Los formatos sin ninguna cámara se
 * reportan como alcance adicional, nunca dentro del OTS.
 */
export interface BrandMeasurableScope {
  days: number;
  formats: BrandSupportFormat[];
  measurable: BrandSupportFormat[];
  excluded: BrandSupportFormat[];
  measurablePairs: number;
  excludedPairs: number;
  measurablePairDays: number;
  measuredPairDays: number;
  /** Porcentaje del circuito medible con dato directo. */
  measuredPercent: number;
}

/** Reparto porcentual de los OTS con medición horaria directa, hora a hora. */
export interface BrandHourlyPoint {
  hour: number;
  share: number;
}

/** Composición por género de un día, en porcentaje sobre lo observado ese día. */
export interface BrandGenderDayPoint {
  date: string;
  female: number;
  male: number;
  unknown: number;
  /** Watchers del día; sostiene el reagrupado semanal en vigencias largas. */
  totalWatchers: number;
  /** Hora `HH:MM` del corte, sólo en el día incompleto. */
  partialUntil?: string;
}

/** Evolución semanal (lunes a domingo) para vigencias de más de 28 días. */
export interface BrandWeeklyPoint {
  /** Primera fecha del periodo con dato, recortada a la vigencia. */
  weekStart: string;
  /** Última fecha del periodo con dato, recortada a la vigencia. */
  weekEnd: string;
  /** Suma (no promedio) de los OTS ajustados de los días del periodo. */
  estimatedOts: number;
  /** Hora `HH:MM` del corte si el periodo incluye el día incompleto. */
  partialUntil?: string;
}

/** Aportación de una tienda a la cifra publicada: la que sostiene «Tiendas TOP». */
export interface BrandStoreAttribution {
  storeNumber: string;
  storeName: string;
  /** OTS registrados directamente, sin completar huecos. */
  measuredOts: number;
  /** OTS ajustados: el propio dato más los huecos de la tienda completados al promedio de su formato. */
  adjustedOts: number;
  /**
   * OTS medidos el día incompleto (ya incluidos en `measuredOts` y
   * `adjustedOts`, sin extrapolar); 0 si no hay día incompleto.
   */
  partialOts: number;
  /** Dwell time ponderado por watchers, sólo con periodos observados (completos o parciales). */
  dwellSeconds: number;
  /** Tuvo al menos una jornada con medición directa en algún momento de la vigencia. */
  everMeasured: boolean;
}

/**
 * Reparto de la cifra publicada entre tiendas con medición en algún momento de
 * la vigencia y tiendas sin medición (sin cámara, o con cámara sin ningún dato
 * válido). Es la clasificación del pie discreto de portada; no debe
 * confundirse con la clasificación técnica observado/estimado del Excel.
 */
export interface BrandStoreAttributionSummary {
  /** Sólo tiendas con al menos una fila en `supportDays` (con cámara instalada). */
  stores: BrandStoreAttribution[];
  measuredStoresOts: number;
  unmeasuredStoresOts: number;
  measuredStoresSharePercent: number;
  unmeasuredStoresSharePercent: number;
}

/** Cruce género × edad: una fila por rango, con el peso de cada género. */
export interface BrandGenderAgeRow {
  age: string;
  female: number;
  male: number;
}

/** Aportación de una tienda a la cifra publicada, para la hoja de auditoría. */
export interface BrandStoreAudit {
  storeNumber: string;
  storeName: string;
  /** Soportes de la tienda con cámara instalada. */
  pairs: number;
  totalPairDays: number;
  measuredPairDays: number;
  completenessPercent: number;
  /** Lo medido, sin ningún ajuste de negocio. */
  measuredOts: number;
  /**
   * `measuredOts` después de duplicar los pares de 1 cámara, o 2 fuera de
   * zona partida (`SINGLE_CAMERA_DUPLICATION_FACTOR`). Igual a `measuredOts`
   * si la tienda no tiene ningún par duplicado.
   */
  publishedOts: number;
}

/**
 * Reconciliación de la duplicación por cámara única dentro del circuito
 * medible: cuánto se midió realmente en pares duplicados (1 cámara, o la más
 * alta de 2 cámaras fuera de zona partida),
 * cuánto se publica después de duplicarlo, y la diferencia. Es la base de la
 * sección «Duplicación por cámara única» de la hoja de auditoría — hace
 * explícito un ajuste que, a diferencia de la extrapolación por huecos, no
 * rellena un vacío de medición: duplica un dato 100% medido por una
 * directriz de negocio (la mayoría de los circuitos de 1 cámara en realidad
 * tienen 2 pantallas en el mismo sitio).
 */
export interface BrandSingleCameraDuplication {
  /**
   * Pares tienda+soporte distintos cuya cifra se duplica: 1 cámara
   * configurada, o 2 cámaras fuera de zona partida (la más alta × 2).
   */
  pairs: number;
  /** Suma de lo medido en esos pares, sin duplicar. */
  measuredOts: number;
  /** `measuredOts` duplicado. */
  publishedOts: number;
  /** `publishedOts - measuredOts`: lo que la duplicación añadió a la cifra. */
  addedOts: number;
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + numeric(value), 0);
}

function pairKey(
  row: Pick<QuividiSupportDay, 'storeNumber' | 'support'>,
): string {
  return `${row.storeNumber}|${row.support}`;
}

function supportDayKey(
  row: Pick<QuividiSupportDay, 'date' | 'storeNumber' | 'support'>,
): string {
  return `${row.date}|${row.storeNumber}|${row.support}`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

export function formatPercent(value: number, decimals = 0): string {
  return `${value.toFixed(decimals)}%`;
}

/** `2026-08-11` -> `11/08/2026`. Fechas civiles, sin zona horaria. */
export function formatCivilDate(value: string): string {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T12:00:00Z`);
  const end = Date.parse(`${endDate}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Días naturales cubiertos por la vigencia contratada, ambos extremos
 * incluidos. Es informativa (portada, encabezados, nombre de archivo) y el
 * umbral de evolución diaria/semanal; no se usa para extrapolar. */
export function periodDays(report: QuividiCampaignReport): number {
  return daysBetween(report.startDate, report.endDate);
}

/**
 * Último día completo a la fecha de generación: el día anterior, en hora de
 * la Ciudad de México. Sólo para reportes anteriores a schema v6, que no traen
 * el corte del servidor (`measuredEndDate`).
 */
export function lastCompleteDateAt(generatedAt: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(generatedAt);
  return previousCivilDate(today);
}

function previousCivilDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

/** Día en curso incluido con datos parciales (10:00–22:00 CDMX), o `null`. */
export function brandPartialDay(
  report: QuividiCampaignReport,
): { date: string; until: string } | null {
  if (!report.partialDate) return null;
  return { date: report.partialDate, until: report.partialUntil ?? '' };
}

/** Leyenda para cada lugar donde aparece la fecha del día incompleto. */
export function partialDayLabel(until: string): string {
  return until ? `Día incompleto, medido hasta ${until}` : 'Día incompleto';
}

/** Leyenda del día incompleto si `date` lo es; `''` en cualquier otra fecha. */
export function partialDayNote(
  report: QuividiCampaignReport,
  date: string,
): string {
  const partial = brandPartialDay(report);
  return partial && partial.date === date ? partialDayLabel(partial.until) : '';
}

/**
 * Último día de la rejilla de extrapolación: el último día **completo**
 * consultado a Quividi, nunca posterior al fin de vigencia.
 *
 * El servidor fija el corte (`measuredEndDate`, `functions/src/quividi/
 * measurement.ts`): antes de las 10:00 CDMX llega hasta ayer; de 10:00 a 22:00
 * incluye hoy como día incompleto (`partialDate`), que queda **fuera** de la
 * rejilla — sólo suma lo medido, sin extrapolar, porque un día a medias
 * deflactaría el promedio que rellena los demás —; desde las 22:00 hoy cuenta
 * como completo. Si la campaña aún no tiene días completos, devuelve una fecha
 * anterior al inicio (rejilla vacía).
 */
export function effectiveEndDate(report: QuividiCampaignReport): string {
  let gridEnd: string;
  if (report.measuredEndDate === undefined) {
    gridEnd = lastCompleteDateAt(report.generatedAt);
  } else if (report.measuredEndDate === null) {
    gridEnd = previousCivilDate(report.startDate);
  } else if (report.partialDate) {
    gridEnd = previousCivilDate(report.partialDate);
  } else {
    gridEnd = report.measuredEndDate;
  }
  return gridEnd < report.endDate ? gridEnd : report.endDate;
}

/**
 * Días sobre los que se extrapola. Si la campaña sigue vigente a la fecha de
 * generación del reporte, el tope es esa fecha, no el fin de vigencia
 * contratado: un día de vigencia que todavía no ha ocurrido no es un hueco de
 * medición (sin cámara / sin dato) y no debe completarse con el promedio del
 * formato como si lo fuera — eso proyectaría la cifra a futuro en vez de
 * mostrar lo real más lo extrapolado a la fecha del reporte.
 */
export function measuredPeriodDays(report: QuividiCampaignReport): number {
  return daysBetween(report.startDate, effectiveEndDate(report));
}

/**
 * Punto único de acceso a `report.supportDays`.
 *
 * Insurgentes (dos cámaras en pisos distintos, OTS sumados como zonas
 * independientes) se corregía aquí mismo, pero dependía de `cameraDays`, que
 * `brandOperationalReport` vaciaba para la vista horaria — por eso nunca
 * llegaba al PDF real, sólo al Excel. La regla de combinación de cámaras
 * (zona partida: Insurgentes y Banner Digital → suma; brecha > 1,000 OTS →
 * la más alta; si no, promedio) ahora vive en el origen del dato
 * (`functions/src/quividi/cameraCombination.ts`, compartida por
 * `buildMeasurementRows` y `buildSupportHours`), así que `report.supportDays`
 * ya llega combinado correctamente y este módulo no necesita corregir nada.
 */
export function brandSupportDays(
  report: QuividiCampaignReport,
): QuividiSupportDay[] {
  // El día incompleto queda fuera de la rejilla; se lee aparte con
  // `brandPartialSupportDays` y sólo suma lo medido.
  const partial = report.partialDate ?? null;
  return report.supportDays
    .filter((row) => row.date !== partial)
    .map((row) => ({ ...row }));
}

/** Filas del día incompleto, o `[]` si el reporte no trae uno. */
export function brandPartialSupportDays(
  report: QuividiCampaignReport,
): QuividiSupportDay[] {
  const partial = report.partialDate;
  if (!partial) return [];
  return report.supportDays
    .filter((row) => row.date === partial)
    .map((row) => ({ ...row }));
}

/**
 * Cobertura por tienda y, sobre todo, por tienda-día.
 *
 * `measuredPercent` cuenta una tienda como cubierta si tuvo medición en algún
 * momento de la vigencia; es el dato que describe el despliegue de cámaras.
 * `storeDayPercent` mide la completitud real y es el que sostiene la
 * extrapolación: en vigencias largas una cámara caída degrada la completitud
 * sin que el despliegue cambie.
 */
export function brandCoverage(report: QuividiCampaignReport): BrandCoverage {
  const rows = brandSupportDays(report);
  const measuredFromRows = new Set(
    rows
      .filter((row) => row.status !== 'missing')
      .map((row) => row.storeNumber),
  ).size;

  const totalStores = Math.max(
    report.storeCoverage?.totalStores ?? 0,
    report.storeCoverage?.mappedStores ?? 0,
    measuredFromRows,
  );
  const measuredStores = Math.min(
    totalStores,
    Math.max(report.storeCoverage?.mappedStores ?? 0, measuredFromRows),
  );
  const estimatedStores = Math.max(0, totalStores - measuredStores);
  const measuredPercent =
    totalStores > 0 ? (measuredStores / totalStores) * 100 : 0;

  const days = measuredPeriodDays(report);
  const totalStoreDays = totalStores * days;
  const measuredStoreDays = Math.min(
    totalStoreDays,
    new Set(
      rows
        .filter((row) => row.status !== 'missing')
        .map((row) => `${row.storeNumber}|${row.date}`),
    ).size,
  );

  return {
    totalStores,
    measuredStores,
    estimatedStores,
    measuredPercent,
    estimatedPercent: totalStores > 0 ? 100 - measuredPercent : 0,
    totalStoreDays,
    measuredStoreDays,
    storeDayPercent:
      totalStoreDays > 0 ? (measuredStoreDays / totalStoreDays) * 100 : 0,
  };
}

/**
 * Rejilla par-día sobre la que se extrapola: la del circuito medible.
 *
 * `report.supportDays` sólo contiene filas de soportes con cámara instalada,
 * una por fecha. Los soportes del universo sin cámara no aparecen, y los
 * formatos que no tienen ninguna cámara quedan fuera de la cifra por completo:
 * su hueco se reporta como alcance adicional, no se rellena.
 */
export function brandExtrapolationBasis(
  report: QuividiCampaignReport,
): BrandExtrapolationBasis {
  const rows = brandSupportDays(report);
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  const inScope = rows.filter((row) => measurableSupports.has(row.support));

  const completePairDays = inScope.filter(
    (row) => row.status === 'complete',
  ).length;
  const partialPairDays = inScope.filter(
    (row) => row.status === 'partial',
  ).length;
  const missingPairDays = inScope.filter(
    (row) => row.status === 'missing',
  ).length;
  const measuredOts = sum(
    inScope
      .filter((row) => row.status !== 'missing')
      .map((row) => row.publishedOts),
  );

  return {
    days: scope.days,
    totalPairs: scope.measurablePairs,
    measuredPairs: new Set(
      inScope.filter((row) => row.status !== 'missing').map(pairKey),
    ).size,
    totalPairDays: scope.measurablePairDays,
    measuredPairDays: scope.measuredPairDays,
    completePairDays,
    partialPairDays,
    missingPairDays,
    uncoveredPairDays: Math.max(
      0,
      scope.measurablePairDays - scope.measuredPairDays - missingPairDays,
    ),
    otsPerMeasuredPairDay:
      scope.measuredPairDays > 0 ? measuredOts / scope.measuredPairDays : 0,
  };
}

/** Desglose por formato de los OTS extrapolados, según el motivo del hueco. */
export interface BrandExtrapolationReasonRow {
  support: string;
  /** Par-día de un soporte con cámara instalada que no reportó ese día. */
  missingPairDays: number;
  /** OTS extrapolados atribuibles a esos días sin dato. */
  missingOts: number;
  /** Par-día de soportes del universo contratado sin cámara instalada. */
  uncoveredPairDays: number;
  /** OTS extrapolados atribuibles a esos soportes sin cámara. */
  uncoveredOts: number;
}

export interface BrandExtrapolationByReason {
  byFormat: BrandExtrapolationReasonRow[];
  /** Total de OTS extrapolados por días sin dato en soportes con cámara. */
  missingOts: number;
  /** Total de OTS extrapolados por soportes sin cámara instalada. */
  uncoveredOts: number;
}

/**
 * Desglosa `brandCampaignSummary(report).extrapolatedOts` por el motivo del
 * hueco que se completó: un día sin dato en un soporte con cámara instalada,
 * frente a un soporte del universo contratado que nunca tuvo cámara.
 *
 * Formato a formato, con el mismo promedio por par-día medido que usa la
 * cifra publicada — nunca un promedio único del circuito — de modo que
 * `missingOts + uncoveredOts` reconcilia exactamente con
 * `brandCampaignSummary(report).extrapolatedOts` sin recalcularlo.
 */
export function brandExtrapolationByReason(
  report: QuividiCampaignReport,
): BrandExtrapolationByReason {
  const scope = brandMeasurableScope(report);
  const rows = brandSupportDays(report);

  const byFormat: BrandExtrapolationReasonRow[] = scope.measurable.map(
    (format) => {
      const rate =
        format.measuredPairDays > 0
          ? format.measuredOts / format.measuredPairDays
          : 0;
      const missingPairDays = rows.filter(
        (row) => row.support === format.support && row.status === 'missing',
      ).length;
      const uncoveredPairDays = Math.max(
        0,
        format.pairDays - format.mappedPairs * scope.days,
      );
      return {
        support: format.support,
        missingPairDays,
        missingOts: rate * missingPairDays,
        uncoveredPairDays,
        uncoveredOts: rate * uncoveredPairDays,
      };
    },
  );

  return {
    byFormat,
    missingOts: sum(byFormat.map((row) => row.missingOts)),
    uncoveredOts: sum(byFormat.map((row) => row.uncoveredOts)),
  };
}

export function brandHeader(report: QuividiCampaignReport): BrandHeader {
  const adjusted = brandSupportDays(report);
  const coverage = brandCoverage(report);
  const supports = Array.from(
    new Set(adjusted.map((row) => row.support).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b, 'es'));
  const measuredPairs = new Set(
    adjusted.filter((row) => row.status !== 'missing').map(pairKey),
  ).size;

  return {
    campaignName: report.campaignName,
    periodLabel: `${formatCivilDate(report.startDate)} - ${formatCivilDate(report.endDate)}`,
    days: periodDays(report),
    totalStores: coverage.totalStores,
    measuredStores: coverage.measuredStores,
    supports,
    storeSupportPairs: Math.max(report.coverage.totalPairs, measuredPairs),
  };
}

/**
 * Extrapolación comercial, formato a formato, dentro del circuito medible.
 *
 * Cada formato con medición se completa con **su propio** promedio de OTS por
 * par-día medido: aplicar un promedio único a todo el circuito haría que un
 * video wall heredara el rendimiento de un mupi. Los formatos sin ninguna
 * cámara no entran en la cifra.
 *
 * Dentro de cada formato, el promedio se calcula sobre los par-día medidos y no
 * sobre la rejilla completa: si los días sin dato entraran al numerador como
 * cero, deflactarían el promedio que luego rellena el resto, un sesgo que crece
 * con la vigencia.
 */
export function brandCampaignSummary(
  report: QuividiCampaignReport,
): BrandCampaignSummary {
  const coverage = brandCoverage(report);
  const scope = brandMeasurableScope(report);
  const basis = brandExtrapolationBasis(report);

  const gridMeasuredOts = sum(
    scope.measurable.map((format) => format.measuredOts),
  );
  const gridEstimatedOts = sum(
    scope.measurable.map((format) =>
      format.measuredPairDays > 0
        ? (format.measuredOts / format.measuredPairDays) * format.pairDays
        : 0,
    ),
  );
  const extrapolatedOts = Math.max(0, gridEstimatedOts - gridMeasuredOts);
  // El día incompleto suma sólo lo medido: no entra al promedio ni se rellena.
  const partialOts = sum(scope.measurable.map((format) => format.partialOts));
  const measuredOts = gridMeasuredOts + partialOts;
  const estimatedOts = gridEstimatedOts + partialOts;
  const days = scope.days;
  // El divisor por tienda sigue siendo el universo de campaña. Una tienda que
  // sólo tenga formatos no medibles no aporta OTS a la cifra, así que el
  // reparto queda conservador; es el sentido seguro para un dato que va a
  // marca, y evita inventar cuántas tiendas tienen soporte medible, dato que
  // el reporte no desglosa.
  const stores = coverage.totalStores;

  // Los promedios diarios usan sólo días completos: el día incompleto los
  // deflactaría. Sin ningún día completo, el único dato es el del día en curso.
  const averageOts = days > 0 ? gridEstimatedOts : partialOts;
  const averageDays = days > 0 ? days : partialOts > 0 ? 1 : 0;

  return {
    measuredOts,
    extrapolatedOts,
    estimatedOts,
    dailyAverage: averageDays > 0 ? averageOts / averageDays : 0,
    dailyPerStore:
      averageDays > 0 && stores > 0 ? averageOts / averageDays / stores : 0,
    dailyPerSupport:
      averageDays > 0 && scope.measurablePairs > 0
        ? averageOts / averageDays / scope.measurablePairs
        : 0,
    coverage,
    basis,
    scope,
    partialOts,
  };
}

/**
 * Evolución diaria agregada; nunca expone una tienda individual.
 *
 * Cada día se extrapola **formato a formato**, con el mismo promedio por
 * par-día medido que usa `brandCampaignSummary`: el hueco de un formato en un
 * día concreto se completa con el promedio de ese formato, nunca con un
 * promedio único del circuito. Esto es lo que garantiza la identidad que debe
 * sostener el informe: la suma de `estimatedOts` de todos los días de la
 * vigencia es exactamente igual a `brandCampaignSummary(report).estimatedOts`
 * (ver test de reconciliación). Con un factor único por día, un formato con
 * mejor rendimiento que otro deformaba el reparto entre días desiguales y la
 * serie dejaba de conciliar con el total de portada.
 */
export function brandDaily(report: QuividiCampaignReport): BrandDailyPoint[] {
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  const rateByFormat = new Map(
    scope.measurable.map((format) => [
      format.support,
      format.measuredPairDays > 0
        ? format.measuredOts / format.measuredPairDays
        : 0,
    ]),
  );
  const rows = brandSupportDays(report).filter((row) =>
    measurableSupports.has(row.support),
  );

  const byDate = new Map<string, QuividiSupportDay[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }
  // Toda fecha de la vigencia aparece, incluso si nadie midió ese día.
  const dates = Array.from(byDate.keys()).sort();

  const points: BrandDailyPoint[] = dates.map((date) => {
    const byFormat = new Map<string, QuividiSupportDay[]>();
    for (const row of byDate.get(date) ?? []) {
      const list = byFormat.get(row.support) ?? [];
      list.push(row);
      byFormat.set(row.support, list);
    }

    let measuredOts = 0;
    let estimatedOts = 0;
    let measuredPairs = 0;
    for (const format of scope.measurable) {
      const formatRows = byFormat.get(format.support) ?? [];
      const measuredRows = formatRows.filter((row) => row.status !== 'missing');
      const dayMeasuredOts = sum(measuredRows.map((row) => row.publishedOts));
      const rate = rateByFormat.get(format.support) ?? 0;
      const gap = Math.max(0, format.pairs - measuredRows.length);
      measuredOts += dayMeasuredOts;
      estimatedOts += dayMeasuredOts + gap * rate;
      measuredPairs += measuredRows.length;
    }

    return {
      date,
      label: date.slice(8, 10),
      measuredOts,
      estimatedOts,
      measuredPairs,
      factor: measuredOts > 0 ? estimatedOts / measuredOts : 0,
    };
  });

  // El día incompleto cierra la serie con lo medido, sin extrapolar.
  const partial = brandPartialDay(report);
  if (partial) {
    const partialRows = brandPartialSupportDays(report).filter(
      (row) => measurableSupports.has(row.support) && row.status !== 'missing',
    );
    const measuredOts = sum(partialRows.map((row) => row.publishedOts));
    points.push({
      date: partial.date,
      label: partial.date.slice(8, 10),
      measuredOts,
      estimatedOts: measuredOts,
      measuredPairs: partialRows.length,
      factor: measuredOts > 0 ? 1 : 0,
      partialUntil: partial.until,
    });
  }
  return points;
}

/** Lunes de la semana ISO a la que pertenece `date` (`YYYY-MM-DD`). */
export function weekStartOf(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  const day = parsed.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + diff);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Evolución semanal, para vigencias de más de 28 días: 60 barras diarias no
 * caben legibles en una página y el dato útil a esa escala es la tendencia por
 * semana, no el día suelto. Las semanas van de lunes a domingo; las semanas de
 * los extremos de la vigencia quedan parciales y `weekStart`/`weekEnd`
 * reflejan la fecha real cubierta, no el lunes/domingo teórico si cae fuera de
 * la vigencia. Suma (nunca promedia) los días de cada semana, así que el total
 * de esta serie también concilia con `brandCampaignSummary().estimatedOts`.
 */
export function brandWeeklyEvolution(
  report: QuividiCampaignReport,
): BrandWeeklyPoint[] {
  const daily = brandDaily(report);
  if (daily.length === 0) return [];

  const weeks = new Map<string, BrandDailyPoint[]>();
  for (const point of daily) {
    const key = weekStartOf(point.date);
    const bucket = weeks.get(key) ?? [];
    bucket.push(point);
    weeks.set(key, bucket);
  }

  return Array.from(weeks.values())
    .map((points) => {
      const dates = points.map((point) => point.date).sort();
      const partial = points.find((point) => point.partialUntil !== undefined);
      return {
        weekStart: dates[0] ?? '',
        weekEnd: dates[dates.length - 1] ?? '',
        estimatedOts: sum(points.map((point) => point.estimatedOts)),
        ...(partial ? { partialUntil: partial.partialUntil } : {}),
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

/** Origen de una fila de demografía publicada. */
export type BrandDemographicOrigin =
  'measured' | 'partial' | 'missing' | 'uncovered';

/** Fila de demografía de cara a marca (watchers publicados). */
export interface BrandDemographicRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  gender: number;
  age: number;
  /** Watchers publicados: medidos (duplicados donde aplica) o estimados. */
  watchers: number;
  origin: BrandDemographicOrigin;
  /** Soportes sin cámara que representa la fila (sólo `uncovered`). */
  uncoveredPairs?: number;
}

function civilDays(start: string, end: string): string[] {
  const days: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) {
    return days;
  }
  while (cursor <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/** Fechas de la rejilla de extrapolación (días completos de la vigencia). */
export function brandGridDates(report: QuividiCampaignReport): string[] {
  return civilDays(report.startDate, effectiveEndDate(report));
}

/**
 * Promedios por par-día **medido** de cada formato del circuito medible,
 * en cifra publicada: los mismos que rellenan los huecos de OTS
 * (`brandCampaignSummary`), más los de OTS efectivos y watchers.
 */
export function brandFormatRates(
  report: QuividiCampaignReport,
): Map<string, { ots: number; effectiveOts: number; watchers: number }> {
  const scope = brandMeasurableScope(report);
  const rows = brandSupportDays(report).filter(
    (row) => row.status !== 'missing',
  );
  return new Map(
    scope.measurable.map((format) => {
      const formatRows = rows.filter((row) => row.support === format.support);
      const days = format.measuredPairDays;
      return [
        format.support,
        {
          ots: days > 0 ? format.measuredOts / days : 0,
          effectiveOts:
            days > 0
              ? sum(formatRows.map((row) => row.publishedEffectiveOts)) / days
              : 0,
          watchers:
            days > 0
              ? sum(formatRows.map((row) => row.publishedWatchers)) / days
              : 0,
        },
      ];
    }),
  );
}

/** Soportes del universo de un formato sin fila ese día (sin cámara). */
export function brandUncoveredPairsByDate(
  report: QuividiCampaignReport,
): Array<{ date: string; support: string; pairs: number }> {
  const scope = brandMeasurableScope(report);
  const rowsByKey = new Map<string, number>();
  for (const row of brandSupportDays(report)) {
    const key = `${row.date}|${row.support}`;
    rowsByKey.set(key, (rowsByKey.get(key) ?? 0) + 1);
  }
  const result: Array<{ date: string; support: string; pairs: number }> = [];
  for (const date of brandGridDates(report)) {
    for (const format of scope.measurable) {
      const pairs = Math.max(
        0,
        format.pairs - (rowsByKey.get(`${date}|${format.support}`) ?? 0),
      );
      if (pairs > 0) result.push({ date, support: format.support, pairs });
    }
  }
  return result;
}

/**
 * Demografía de cara a marca, con la misma lógica que el OTS publicado:
 *
 * - lo medido usa los watchers publicados (misma cámara de referencia que el
 *   OTS, duplicados donde aplica — `publishedWatchers` del backend);
 * - un día sin dato de un soporte con cámara, y los soportes del universo sin
 *   cámara, se completan con el promedio de watchers por par-día medido del
 *   formato, repartido según el perfil de género × edad medido del formato;
 * - el día incompleto suma sólo lo medido;
 * - los formatos sin ninguna medición quedan fuera, igual que en el OTS.
 *
 * Los porcentajes del total casi no cambian (lo estimado usa el mismo perfil
 * del formato); los conteos sí, y cuadran con los watchers publicados.
 */
export function brandDemographics(
  report: QuividiCampaignReport,
): BrandDemographicRow[] {
  const scope = brandMeasurableScope(report);
  const measurable = new Set(scope.measurable.map((format) => format.support));
  const excluded = new Set(scope.excluded.map((format) => format.support));
  const partial = report.partialDate ?? null;
  const published = (row: QuividiCampaignReport['demographics'][number]) =>
    numeric(row.publishedWatchers ?? row.watchers);

  const result: BrandDemographicRow[] = [];
  const profile = new Map<string, Map<string, number>>();
  for (const row of report.demographics) {
    if (excluded.has(row.support)) continue;
    const watchers = published(row);
    const isPartial = row.date === partial;
    result.push({
      date: row.date,
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      gender: row.gender,
      age: row.age,
      watchers,
      origin: isPartial ? 'partial' : 'measured',
    });
    if (isPartial) continue;
    const formatProfile = profile.get(row.support) ?? new Map<string, number>();
    const key = `${row.gender}|${row.age}`;
    formatProfile.set(key, (formatProfile.get(key) ?? 0) + watchers);
    profile.set(row.support, formatProfile);
  }

  const rates = brandFormatRates(report);
  const spread = (
    support: string,
    total: number,
    base: Omit<BrandDemographicRow, 'gender' | 'age' | 'watchers'>,
  ) => {
    const formatProfile = profile.get(support);
    if (!formatProfile || total <= 0) return;
    const profileTotal = sum(Array.from(formatProfile.values()));
    if (profileTotal <= 0) return;
    for (const [key, count] of formatProfile) {
      const [gender, age] = key.split('|').map(Number);
      result.push({
        ...base,
        gender: gender ?? 0,
        age: age ?? 0,
        watchers: (total * count) / profileTotal,
      });
    }
  };

  for (const row of brandSupportDays(report)) {
    if (row.status !== 'missing' || !measurable.has(row.support)) continue;
    spread(row.support, rates.get(row.support)?.watchers ?? 0, {
      date: row.date,
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      origin: 'missing',
    });
  }
  for (const gap of brandUncoveredPairsByDate(report)) {
    spread(gap.support, (rates.get(gap.support)?.watchers ?? 0) * gap.pairs, {
      date: gap.date,
      storeNumber: '',
      storeName: `Sin cámara (${gap.pairs} ${gap.pairs === 1 ? 'soporte' : 'soportes'})`,
      support: gap.support,
      origin: 'uncovered',
      uncoveredPairs: gap.pairs,
    });
  }
  return result;
}

function shareBy(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): BrandShare[] {
  const groups = new Map<number, number>();
  for (const row of brandDemographics(report)) {
    groups.set(
      row[field],
      (groups.get(row[field]) ?? 0) + numeric(row.watchers),
    );
  }
  const total = sum(Array.from(groups.values()));
  return Array.from(groups, ([key, count]) => ({
    label: labels[key] ?? `Código ${key}`,
    share: total > 0 ? (count / total) * 100 : 0,
  }))
    .filter((item) => item.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** Distribución porcentual de género; no expone conteos absolutos. */
export function brandGender(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'gender', QUIVIDI_GENDER_LABELS);
}

/** Distribución porcentual de edad; no expone conteos absolutos. */
export function brandAge(report: QuividiCampaignReport): BrandShare[] {
  return shareBy(report, 'age', QUIVIDI_AGE_LABELS);
}

/**
 * Desglose por tienda de lo que realmente se midió.
 *
 * Es el detalle que sostiene la cifra agregada: cuántos par-día aportó cada
 * tienda frente a los que le tocaban y con cuántos OTS. Sólo aparece en el
 * Excel de auditoría; el informe comercial nunca publica tienda a tienda.
 */
export function brandStoreAudit(
  report: QuividiCampaignReport,
): BrandStoreAudit[] {
  const rows = brandSupportDays(report);
  const days = measuredPeriodDays(report);
  const groups = new Map<string, QuividiSupportDay[]>();

  for (const row of rows) {
    const current = groups.get(row.storeNumber) ?? [];
    current.push(row);
    groups.set(row.storeNumber, current);
  }

  return Array.from(groups, ([storeNumber, storeRows]) => {
    const pairs = new Set(storeRows.map((row) => row.support)).size;
    const totalPairDays = pairs * days;
    const measured = storeRows.filter((row) => row.status !== 'missing');
    return {
      storeNumber,
      storeName: storeRows[0]?.storeName ?? '',
      pairs,
      totalPairDays,
      measuredPairDays: measured.length,
      completenessPercent:
        totalPairDays > 0 ? (measured.length / totalPairDays) * 100 : 0,
      measuredOts: sum(measured.map((row) => row.ots)),
      publishedOts: sum(measured.map((row) => row.publishedOts)),
    };
  }).sort((a, b) => a.completenessPercent - b.completenessPercent);
}

/**
 * Ver `BrandSingleCameraDuplication`. Se acota al circuito medible (mismos
 * formatos que `brandCampaignSummary`) para que `addedOts` reconcilie
 * exactamente: `summary.measuredOts - duplication.addedOts` es lo medido sin
 * ningún ajuste de negocio.
 */
export function brandSingleCameraDuplication(
  report: QuividiCampaignReport,
): BrandSingleCameraDuplication {
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  // Pares duplicados: 1 cámara configurada, o 2 cámaras fuera de zona
  // partida (el backend ya publicó la más alta × 2). En zona partida
  // `publishedOts === ots`, así que no entra.
  const rows = brandSupportDays(report).filter(
    (row) =>
      measurableSupports.has(row.support) &&
      row.status !== 'missing' &&
      (row.configuredCameras === 1 ||
        (row.configuredCameras === 2 && row.publishedOts > row.ots)),
  );

  const measuredOts = sum(rows.map((row) => row.ots));
  const publishedOts = sum(rows.map((row) => row.publishedOts));

  return {
    pairs: new Set(rows.map(pairKey)).size,
    measuredOts,
    publishedOts,
    addedOts: publishedOts - measuredOts,
  };
}

/**
 * Promedio ponderado por watchers publicados (no los crudos): si una tienda
 * de 1 sola cámara cuenta el doble de audiencia, su dwell/attention time debe
 * pesar el doble al combinarse con otras tiendas — el tiempo por persona no
 * cambia, pero cuánto pesa esa tienda en el promedio del circuito sí.
 */
function weightedAverage(
  rows: readonly QuividiSupportDay[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number {
  const totalWatchers = sum(rows.map((row) => row.publishedWatchers));
  if (totalWatchers <= 0) return 0;
  return (
    sum(rows.map((row) => row[field] * row.publishedWatchers)) / totalWatchers
  );
}

/**
 * Dwell time promedio del circuito medible, ponderado por watchers.
 *
 * Un promedio simple entre tiendas trataría igual a una tienda con mucho
 * tráfico que a una con poco; ponderar por watchers es lo que evita que una
 * tienda pequeña deforme la cifra que va a portada, igual que ya hace el
 * Excel técnico para su detalle por soporte.
 */
export function brandDwellTime(report: QuividiCampaignReport): number {
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  const rows = brandSupportDays(report).filter(
    (row) => measurableSupports.has(row.support) && row.status !== 'missing',
  );
  return weightedAverage(rows, 'dwellSeconds');
}

/**
 * Aportación de cada tienda a la cifra publicada, con su OTS ajustado
 * (propio dato más los huecos de la tienda completados al promedio de su
 * formato) y si tuvo medición en algún momento de la vigencia.
 *
 * Es la base de «Tiendas TOP» y del pie discreto de portada. Sólo cubre
 * tiendas con al menos una fila en `supportDays` (cámara instalada en algún
 * soporte medible): las tiendas sin cámara no tienen identidad en el reporte,
 * así que su aportación queda como el residuo entre `estimatedOts` y la suma
 * de las tiendas conocidas — la reconciliación es exacta porque
 * `brandCampaignSummary` extrapola con los mismos promedios por formato.
 */
export function brandStoreAttribution(
  report: QuividiCampaignReport,
): BrandStoreAttributionSummary {
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  const rateByFormat = new Map(
    scope.measurable.map((format) => [
      format.support,
      format.measuredPairDays > 0
        ? format.measuredOts / format.measuredPairDays
        : 0,
    ]),
  );
  const rows = brandSupportDays(report).filter((row) =>
    measurableSupports.has(row.support),
  );
  // El día incompleto suma a cada tienda sólo lo medido, igual que en la
  // portada: sin esto «Tiendas TOP» no conciliaba con la cifra publicada.
  const partialRows = brandPartialSupportDays(report).filter(
    (row) => measurableSupports.has(row.support) && row.status !== 'missing',
  );

  const byStore = new Map<
    string,
    {
      storeName: string;
      rowsByFormat: Map<string, QuividiSupportDay[]>;
      partialRows: QuividiSupportDay[];
    }
  >();
  const storeOf = (row: QuividiSupportDay) => {
    const store = byStore.get(row.storeNumber) ?? {
      storeName: row.storeName,
      rowsByFormat: new Map<string, QuividiSupportDay[]>(),
      partialRows: [],
    };
    byStore.set(row.storeNumber, store);
    return store;
  };
  for (const row of rows) {
    const store = storeOf(row);
    const formatRows = store.rowsByFormat.get(row.support) ?? [];
    formatRows.push(row);
    store.rowsByFormat.set(row.support, formatRows);
  }
  for (const row of partialRows) storeOf(row).partialRows.push(row);

  const stores: BrandStoreAttribution[] = Array.from(
    byStore,
    ([storeNumber, data]) => {
      let adjustedOts = 0;
      let measuredOts = 0;
      let everMeasured = false;
      const measuredRows: QuividiSupportDay[] = [];
      for (const [support, formatRows] of data.rowsByFormat) {
        const rate = rateByFormat.get(support) ?? 0;
        const measured = formatRows.filter((row) => row.status !== 'missing');
        // El dato propio de la tienda se conserva tal cual; sólo sus propios
        // huecos (filas `missing`) se completan al promedio del formato. Usar
        // `rate * formatRows.length` para todas las tiendas —sin restar su
        // propio dato— las igualaba a todas al mismo valor, perdiendo
        // exactamente lo que «Tiendas TOP» necesita mostrar: quién rinde más.
        const formatMeasuredOts = sum(measured.map((row) => row.publishedOts));
        const gap = Math.max(0, formatRows.length - measured.length);
        adjustedOts += formatMeasuredOts + gap * rate;
        measuredOts += formatMeasuredOts;
        if (measured.length > 0) everMeasured = true;
        measuredRows.push(...measured);
      }
      const partialOts = sum(data.partialRows.map((row) => row.publishedOts));
      adjustedOts += partialOts;
      measuredOts += partialOts;
      if (data.partialRows.length > 0) everMeasured = true;
      measuredRows.push(...data.partialRows);
      return {
        storeNumber,
        storeName: data.storeName,
        measuredOts,
        adjustedOts,
        partialOts,
        dwellSeconds: weightedAverage(measuredRows, 'dwellSeconds'),
        everMeasured,
      };
    },
  ).sort((a, b) => b.adjustedOts - a.adjustedOts);

  const estimatedOts = brandCampaignSummary(report).estimatedOts;
  const measuredStoresOts = sum(
    stores
      .filter((store) => store.everMeasured)
      .map((store) => store.adjustedOts),
  );
  const unmeasuredStoresOts = Math.max(0, estimatedOts - measuredStoresOts);

  return {
    stores,
    measuredStoresOts,
    unmeasuredStoresOts,
    measuredStoresSharePercent:
      estimatedOts > 0 ? (measuredStoresOts / estimatedOts) * 100 : 0,
    unmeasuredStoresSharePercent:
      estimatedOts > 0 ? (unmeasuredStoresOts / estimatedOts) * 100 : 0,
  };
}

/**
 * Franja horaria operativa de cara a la marca: 10:00–22:00 (hora 22 excluida).
 *
 * Es una regla comercial deliberadamente simple, no un horario real por
 * soporte — SIGNAM no tiene esa fuente (ver el bloqueo de Fase 2 arriba). Una
 * franja fuera de este rango puede tener medición válida (tráfico de personal,
 * limpieza, seguridad) que operativamente está bien pero que a la marca no le
 * interesa: mostrarla como audiencia comercial sugeriría tráfico fuera del
 * horario de la tienda. La usan `brandHourlyDistribution` (reparto horario) y
 * `brandOperationalReport` (OTS/dwell time de portada, evolución, Tiendas TOP
 * y dwell time del PDF comercial). El Excel técnico NO la usa: sigue leyendo
 * `report.supportDays` sin recortar, el dato tal cual lo agrega Quividi por
 * día completo (00:00–23:59) — ver AGENTS.md para la divergencia resultante
 * entre el total del PDF y el de la hoja «Auditoría de cifras».
 */
export const BRAND_OPERATIONAL_START_HOUR = 10;
export const BRAND_OPERATIONAL_END_HOUR = 22;

/**
 * Reconstruye filas «por día» (forma de `QuividiSupportDay`) a partir de
 * `supportHours`, sumando únicamente las horas dentro de la franja operativa
 * de cara a la marca. Es la única manera de acotar el OTS por hora: el
 * export diario de Quividi que llena `report.supportDays` ya viene
 * pre-sumado 00:00–23:59 y no se puede recortar después del hecho.
 *
 * Sólo emite una fila para (fecha, tienda, soporte) que tengan al menos una
 * hora — medida o no — dentro de la franja; una fecha sin ninguna hora en
 * `supportHours` dentro de 10:00–22:00 no genera fila (no se fabrica un
 * "sin dato" a partir de un total diario que no se puede recortar).
 */
export function brandOperationalSupportDays(
  report: QuividiCampaignReport,
): QuividiSupportDay[] {
  const inWindow = report.supportHours.filter(
    (row) =>
      row.hour >= BRAND_OPERATIONAL_START_HOUR &&
      row.hour < BRAND_OPERATIONAL_END_HOUR,
  );

  const groups = new Map<string, (typeof inWindow)[number][]>();
  for (const row of inWindow) {
    const key = supportDayKey(row);
    const current = groups.get(key) ?? [];
    current.push(row);
    groups.set(key, current);
  }

  return Array.from(groups.values(), (hours) => {
    const first = hours[0]!;
    const measured = hours.filter((hour) => hour.status !== 'missing');
    const watchersTotal = sum(measured.map((hour) => hour.watchers));
    const status: QuividiMeasurementStatus =
      measured.length === 0
        ? 'missing'
        : hours.every((hour) => hour.status === 'complete')
          ? 'complete'
          : 'partial';
    return {
      date: first.date,
      storeNumber: first.storeNumber,
      storeName: first.storeName,
      support: first.support,
      configuredCameras: Math.max(
        ...hours.map((hour) => hour.configuredCameras),
      ),
      measuredCameras: Math.max(...hours.map((hour) => hour.measuredCameras)),
      status,
      ots: sum(measured.map((hour) => hour.ots)),
      effectiveOts: sum(measured.map((hour) => hour.effectiveOts)),
      watchers: watchersTotal,
      publishedOts: sum(measured.map((hour) => hour.publishedOts)),
      publishedEffectiveOts: sum(
        measured.map((hour) => hour.publishedEffectiveOts),
      ),
      publishedWatchers: sum(measured.map((hour) => hour.publishedWatchers)),
      attentionSeconds:
        watchersTotal > 0
          ? sum(measured.map((hour) => hour.attentionSeconds * hour.watchers)) /
            watchersTotal
          : 0,
      dwellSeconds:
        watchersTotal > 0
          ? sum(measured.map((hour) => hour.dwellSeconds * hour.watchers)) /
            watchersTotal
          : 0,
    };
  });
}

/**
 * Vista del reporte que consume el PDF comercial: mismos `supportHours` y
 * `demographics` (no tienen hora, no se pueden acotar — ver el cruce
 * hora × demografía bloqueado más abajo), pero `supportDays` reconstruido con
 * `brandOperationalSupportDays` dentro de la franja operativa.
 *
 * Si el reporte no trae `supportHours` (schema anterior, o el export horario
 * falló), degrada a `report` sin tocarlo: mostrar cero por falta de detalle
 * horario sería peor que mostrar el total sin acotar.
 */
export function brandOperationalReport(
  report: QuividiCampaignReport,
): QuividiCampaignReport {
  if (report.supportHours.length === 0) return report;
  return {
    ...report,
    supportDays: brandOperationalSupportDays(report),
  };
}

/**
 * Distribución horaria de los OTS con medición directa, acotada a la franja
 * operativa de cara a la marca (`BRAND_OPERATIONAL_START_HOUR`–`BRAND_OPERATIONAL_END_HOUR`).
 *
 * Se calcula sobre `supportHours`, que no todos los reportes traen: cuando
 * falta, devuelve una lista vacía y el informe omite el bloque en vez de
 * dibujar ceros. A diferencia de `brandDaily`/`brandWeeklyEvolution`, esta
 * distribución **no completa horas sin dato**: SIGNAM no tiene hoy una fuente
 * fiable del horario de operación esperado por soporte que permita distinguir
 * una hora sin medición de una hora en la que el soporte estaba apagado, así
 * que el reparto describe únicamente lo observado, no un total ajustado por
 * hora. Extrapolar hora a hora queda para cuando exista esa fuente.
 */
export function brandHourlyDistribution(
  report: QuividiCampaignReport,
): BrandHourlyPoint[] {
  const measured = report.supportHours.filter(
    (row) =>
      row.status !== 'missing' &&
      row.hour >= BRAND_OPERATIONAL_START_HOUR &&
      row.hour < BRAND_OPERATIONAL_END_HOUR,
  );
  if (measured.length === 0) return [];

  const totals = new Map<number, number>();
  for (const row of measured) {
    totals.set(
      row.hour,
      (totals.get(row.hour) ?? 0) + numeric(row.publishedOts),
    );
  }
  const total = sum(Array.from(totals.values()));
  if (total <= 0) return [];

  return Array.from(totals, ([hour, ots]) => ({
    hour,
    share: (ots / total) * 100,
  })).sort((a, b) => a.hour - b.hour);
}

/**
 * Composición por género de cada día, en porcentaje sobre lo observado ese
 * día. El género «no identificado» se conserva tal cual lo reporta Quividi;
 * nunca se reparte entre mujeres y hombres para forzar que ambos sumen 100.
 */
export function brandGenderByDay(
  report: QuividiCampaignReport,
): BrandGenderDayPoint[] {
  const byDate = new Map<
    string,
    { female: number; male: number; unknown: number }
  >();
  for (const row of brandDemographics(report)) {
    const current = byDate.get(row.date) ?? {
      female: 0,
      male: 0,
      unknown: 0,
    };
    const watchers = numeric(row.watchers);
    if (row.gender === 2) current.female += watchers;
    else if (row.gender === 1) current.male += watchers;
    else current.unknown += watchers;
    byDate.set(row.date, current);
  }

  const partial = brandPartialDay(report);
  return Array.from(byDate, ([date, counts]) => {
    const total = counts.female + counts.male + counts.unknown;
    return {
      date,
      female: total > 0 ? (counts.female / total) * 100 : 0,
      male: total > 0 ? (counts.male / total) * 100 : 0,
      unknown: total > 0 ? (counts.unknown / total) * 100 : 0,
      totalWatchers: total,
      ...(partial?.date === date ? { partialUntil: partial.until } : {}),
    };
  })
    .filter((point) => point.totalWatchers > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Perfil cruzado de género y edad.
 *
 * Los porcentajes se expresan sobre el total de la audiencia, no sobre cada
 * género, de modo que «mujer adulta» y «hombre adulto» se comparan
 * directamente y el conjunto de la tabla suma 100. Sólo se cruzan los géneros
 * identificados: el código 0 de Quividi es «desconocido» y repartirlo entre
 * hombre y mujer sería inventar el dato.
 */
export function brandGenderAge(
  report: QuividiCampaignReport,
): BrandGenderAgeRow[] {
  const known = brandDemographics(report).filter(
    (row) => row.gender === 1 || row.gender === 2,
  );
  const total = sum(known.map((row) => numeric(row.watchers)));
  if (total <= 0) return [];

  const byAge = new Map<number, { female: number; male: number }>();
  for (const row of known) {
    const current = byAge.get(row.age) ?? { female: 0, male: 0 };
    if (row.gender === 2) current.female += numeric(row.watchers);
    else current.male += numeric(row.watchers);
    byAge.set(row.age, current);
  }

  return Array.from(byAge, ([age, counts]) => ({
    age: QUIVIDI_AGE_LABELS[age] ?? `Código ${age}`,
    female: (counts.female / total) * 100,
    male: (counts.male / total) * 100,
  }))
    .filter((row) => row.female + row.male > 0)
    .sort((a, b) => b.female + b.male - (a.female + a.male));
}

/**
 * Desglose del circuito por formato de soporte.
 *
 * El universo por formato sale de `coverage.bySupport`, que lo resuelve el
 * backend a partir del alcance de campaña. Cuando ese desglose falta —reportes
 * antiguos—, se reconstruye desde las filas medidas, que sólo existen para
 * soportes con cámara: en ese caso el circuito sin medición queda fuera del
 * detalle, nunca dentro de la cifra.
 */
export function brandSupportFormats(
  report: QuividiCampaignReport,
): BrandSupportFormat[] {
  const rows = brandSupportDays(report);
  const days = measuredPeriodDays(report);

  const partial = new Map<string, { pairs: number; ots: number }>();
  for (const row of brandPartialSupportDays(report)) {
    if (row.status === 'missing') continue;
    const current = partial.get(row.support) ?? { pairs: 0, ots: 0 };
    current.pairs += 1;
    current.ots += numeric(row.publishedOts);
    partial.set(row.support, current);
  }

  const measured = new Map<string, { pairDays: number; ots: number }>();
  const mapped = new Map<string, Set<string>>();
  for (const row of rows) {
    const seen = mapped.get(row.support) ?? new Set<string>();
    seen.add(row.storeNumber);
    mapped.set(row.support, seen);
    if (row.status === 'missing') continue;
    const current = measured.get(row.support) ?? { pairDays: 0, ots: 0 };
    current.pairDays += 1;
    current.ots += numeric(row.publishedOts);
    measured.set(row.support, current);
  }

  const universe = new Map<string, { pairs: number; mappedPairs: number }>();
  for (const entry of report.coverage.bySupport ?? []) {
    universe.set(entry.support, {
      pairs: entry.totalPairs,
      mappedPairs: entry.mappedPairs,
    });
  }
  for (const row of brandPartialSupportDays(report)) {
    const seen = mapped.get(row.support) ?? new Set<string>();
    seen.add(row.storeNumber);
    mapped.set(row.support, seen);
  }
  for (const [support, stores] of mapped) {
    if (universe.has(support)) continue;
    universe.set(support, { pairs: stores.size, mappedPairs: stores.size });
  }

  // Sin `bySupport` no se sabe a qué formato pertenecen los soportes del
  // universo sin cámara, que no dejan fila. Con un único formato no hay
  // ambigüedad y se le atribuyen todos; con varios se quedan fuera de la cifra
  // antes que repartirlos a ojo.
  const onlyFormat = universe.size === 1 ? [...universe.keys()][0] : undefined;
  const entry = onlyFormat ? universe.get(onlyFormat) : undefined;
  if (onlyFormat && entry && report.coverage.totalPairs > entry.pairs) {
    universe.set(onlyFormat, {
      pairs: report.coverage.totalPairs,
      mappedPairs: entry.mappedPairs,
    });
  }

  return Array.from(universe, ([support, counts]) => {
    const stats = measured.get(support);
    const today = partial.get(support);
    return {
      support,
      pairs: counts.pairs,
      mappedPairs: counts.mappedPairs,
      pairDays: counts.pairs * days,
      measuredPairDays: stats?.pairDays ?? 0,
      measuredOts: stats?.ots ?? 0,
      partialPairs: today?.pairs ?? 0,
      partialOts: today?.ots ?? 0,
      measurable: (stats?.pairDays ?? 0) > 0 || (today?.pairs ?? 0) > 0,
    };
  }).sort(
    (a, b) => b.pairs - a.pairs || a.support.localeCompare(b.support, 'es'),
  );
}

/** Separa el circuito medible del que no lo es. */
export function brandMeasurableScope(
  report: QuividiCampaignReport,
): BrandMeasurableScope {
  const formats = brandSupportFormats(report);
  const measurable = formats.filter((format) => format.measurable);
  const excluded = formats.filter((format) => !format.measurable);
  const measurablePairDays = sum(measurable.map((format) => format.pairDays));
  const measuredPairDays = sum(
    measurable.map((format) => format.measuredPairDays),
  );

  return {
    days: measuredPeriodDays(report),
    formats,
    measurable,
    excluded,
    measurablePairs: sum(measurable.map((format) => format.pairs)),
    excludedPairs: sum(excluded.map((format) => format.pairs)),
    measurablePairDays,
    measuredPairDays,
    measuredPercent:
      measurablePairDays > 0
        ? (measuredPairDays / measurablePairDays) * 100
        : 0,
  };
}
