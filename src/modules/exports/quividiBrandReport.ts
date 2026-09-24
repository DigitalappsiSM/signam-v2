import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  type QuividiCampaignReport,
  type QuividiCameraDay,
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
}

/** Evolución semanal (lunes a domingo) para vigencias de más de 28 días. */
export interface BrandWeeklyPoint {
  /** Primera fecha del periodo con dato, recortada a la vigencia. */
  weekStart: string;
  /** Última fecha del periodo con dato, recortada a la vigencia. */
  weekEnd: string;
  /** Suma (no promedio) de los OTS ajustados de los días del periodo. */
  estimatedOts: number;
}

/** Aportación de una tienda a la cifra publicada: la que sostiene «Tiendas TOP». */
export interface BrandStoreAttribution {
  storeNumber: string;
  storeName: string;
  /** OTS registrados directamente, sin completar huecos. */
  measuredOts: number;
  /** OTS ajustados: el propio dato más los huecos de la tienda completados al promedio de su formato. */
  adjustedOts: number;
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
  measuredOts: number;
}

function numeric(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function isInsurgentes(storeName: string): boolean {
  return normalize(storeName).includes('INSURGENTES');
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + numeric(value), 0);
}

function selectedCameraRows(
  rows: readonly QuividiCameraDay[],
): QuividiCameraDay[] {
  const complete = rows.filter((row) => row.status === 'complete');
  if (complete.length > 0) return complete;
  return rows.filter((row) => row.status === 'partial');
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

/** Días naturales cubiertos por la vigencia, ambos extremos incluidos. */
export function periodDays(report: QuividiCampaignReport): number {
  const start = Date.parse(`${report.startDate}T12:00:00Z`);
  const end = Date.parse(`${report.endDate}T12:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Mantiene la agregación vigente de tienda + soporte para todo el circuito.
 * Únicamente Insurgentes se corrige para el informe comercial: sus cámaras se
 * encuentran en pisos distintos, por lo que sus OTS se suman como zonas
 * independientes en lugar de promediarse.
 */
export function brandSupportDays(
  report: QuividiCampaignReport,
): QuividiSupportDay[] {
  if (report.cameraDays.length === 0) {
    return report.supportDays.map((row) => ({ ...row }));
  }

  const camerasByKey = new Map<string, QuividiCameraDay[]>();
  for (const camera of report.cameraDays) {
    if (!isInsurgentes(camera.storeName)) continue;
    const key = `${camera.date}|${camera.storeNumber}|${camera.support}`;
    const current = camerasByKey.get(key) ?? [];
    current.push(camera);
    camerasByKey.set(key, current);
  }

  return report.supportDays.map((row) => {
    if (!isInsurgentes(row.storeName)) return { ...row };
    const selected = selectedCameraRows(
      camerasByKey.get(supportDayKey(row)) ?? [],
    );
    if (selected.length === 0) return { ...row };
    return {
      ...row,
      measuredCameras: selected.length,
      ots: sum(selected.map((camera) => camera.ots)),
      effectiveOts: sum(selected.map((camera) => camera.effectiveOts)),
    };
  });
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
  const rows = report.supportDays;
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

  const days = periodDays(report);
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
    inScope.filter((row) => row.status !== 'missing').map((row) => row.ots),
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

  const measuredOts = sum(scope.measurable.map((format) => format.measuredOts));
  const estimatedOts = sum(
    scope.measurable.map((format) =>
      format.measuredPairDays > 0
        ? (format.measuredOts / format.measuredPairDays) * format.pairDays
        : 0,
    ),
  );
  const extrapolatedOts = Math.max(0, estimatedOts - measuredOts);
  const days = scope.days;
  // El divisor por tienda sigue siendo el universo de campaña. Una tienda que
  // sólo tenga formatos no medibles no aporta OTS a la cifra, así que el
  // reparto queda conservador; es el sentido seguro para un dato que va a
  // marca, y evita inventar cuántas tiendas tienen soporte medible, dato que
  // el reporte no desglosa.
  const stores = coverage.totalStores;

  return {
    measuredOts,
    extrapolatedOts,
    estimatedOts,
    dailyAverage: days > 0 ? estimatedOts / days : 0,
    dailyPerStore: days > 0 && stores > 0 ? estimatedOts / days / stores : 0,
    dailyPerSupport:
      days > 0 && scope.measurablePairs > 0
        ? estimatedOts / days / scope.measurablePairs
        : 0,
    coverage,
    basis,
    scope,
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

  return dates.map((date) => {
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
      const dayMeasuredOts = sum(measuredRows.map((row) => row.ots));
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
      return {
        weekStart: dates[0] ?? '',
        weekEnd: dates[dates.length - 1] ?? '',
        estimatedOts: sum(points.map((point) => point.estimatedOts)),
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function shareBy(
  report: QuividiCampaignReport,
  field: 'gender' | 'age',
  labels: Readonly<Record<number, string>>,
): BrandShare[] {
  const groups = new Map<number, number>();
  for (const row of report.demographics) {
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
  const days = periodDays(report);
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
    };
  }).sort((a, b) => a.completenessPercent - b.completenessPercent);
}

/** Promedio ponderado por watchers, igual que el Excel técnico. */
function weightedAverage(
  rows: readonly QuividiSupportDay[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number {
  const totalWatchers = sum(rows.map((row) => row.watchers));
  if (totalWatchers <= 0) return 0;
  return sum(rows.map((row) => row[field] * row.watchers)) / totalWatchers;
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

  const byStore = new Map<
    string,
    { storeName: string; rowsByFormat: Map<string, QuividiSupportDay[]> }
  >();
  for (const row of rows) {
    const store = byStore.get(row.storeNumber) ?? {
      storeName: row.storeName,
      rowsByFormat: new Map<string, QuividiSupportDay[]>(),
    };
    const formatRows = store.rowsByFormat.get(row.support) ?? [];
    formatRows.push(row);
    store.rowsByFormat.set(row.support, formatRows);
    byStore.set(row.storeNumber, store);
  }

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
        const formatMeasuredOts = sum(measured.map((row) => row.ots));
        const gap = Math.max(0, formatRows.length - measured.length);
        adjustedOts += formatMeasuredOts + gap * rate;
        measuredOts += formatMeasuredOts;
        if (measured.length > 0) everMeasured = true;
        measuredRows.push(...measured);
      }
      return {
        storeNumber,
        storeName: data.storeName,
        measuredOts,
        adjustedOts,
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
 * Distribución horaria de los OTS con medición directa, hora a hora (0-23).
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
    (row) => row.status !== 'missing',
  );
  if (measured.length === 0) return [];

  const totals = new Map<number, number>();
  for (const row of measured) {
    totals.set(row.hour, (totals.get(row.hour) ?? 0) + numeric(row.ots));
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
  for (const row of report.demographics) {
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

  return Array.from(byDate, ([date, counts]) => {
    const total = counts.female + counts.male + counts.unknown;
    return {
      date,
      female: total > 0 ? (counts.female / total) * 100 : 0,
      male: total > 0 ? (counts.male / total) * 100 : 0,
      unknown: total > 0 ? (counts.unknown / total) * 100 : 0,
      totalWatchers: total,
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
  const known = report.demographics.filter(
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
  const days = periodDays(report);

  const measured = new Map<string, { pairDays: number; ots: number }>();
  const mapped = new Map<string, Set<string>>();
  for (const row of rows) {
    const seen = mapped.get(row.support) ?? new Set<string>();
    seen.add(row.storeNumber);
    mapped.set(row.support, seen);
    if (row.status === 'missing') continue;
    const current = measured.get(row.support) ?? { pairDays: 0, ots: 0 };
    current.pairDays += 1;
    current.ots += numeric(row.ots);
    measured.set(row.support, current);
  }

  const universe = new Map<string, { pairs: number; mappedPairs: number }>();
  for (const entry of report.coverage.bySupport ?? []) {
    universe.set(entry.support, {
      pairs: entry.totalPairs,
      mappedPairs: entry.mappedPairs,
    });
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
    return {
      support,
      pairs: counts.pairs,
      mappedPairs: counts.mappedPairs,
      pairDays: counts.pairs * days,
      measuredPairDays: stats?.pairDays ?? 0,
      measuredOts: stats?.ots ?? 0,
      measurable: (stats?.pairDays ?? 0) > 0,
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
    days: periodDays(report),
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
