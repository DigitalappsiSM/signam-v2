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

/** Reparto porcentual de los OTS entre franjas horarias del día. */
export interface BrandTimeBand {
  label: string;
  hours: string;
  share: number;
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
 * El factor se recalcula día a día. Con un factor constante, una jornada en la
 * que la mitad del circuito no midió se dibujaba como una caída de audiencia
 * que nunca ocurrió; escalando por los pares realmente medidos ese día, la
 * serie sólo refleja variación de audiencia.
 */
export function brandDaily(report: QuividiCampaignReport): BrandDailyPoint[] {
  const scope = brandMeasurableScope(report);
  const measurableSupports = new Set(
    scope.measurable.map((format) => format.support),
  );
  const rows = brandSupportDays(report).filter((row) =>
    measurableSupports.has(row.support),
  );
  const basis = brandExtrapolationBasis(report);
  const measured = new Map<string, number>();
  const pairs = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.status === 'missing') continue;
    measured.set(row.date, (measured.get(row.date) ?? 0) + numeric(row.ots));
    const seen = pairs.get(row.date) ?? new Set<string>();
    seen.add(pairKey(row));
    pairs.set(row.date, seen);
  }

  // Toda fecha de la vigencia aparece, incluso si nadie midió ese día.
  const dates = Array.from(new Set(rows.map((row) => row.date))).sort();

  return dates.map((date) => {
    const measuredOts = measured.get(date) ?? 0;
    const measuredPairs = pairs.get(date)?.size ?? 0;
    const factor = measuredPairs > 0 ? basis.totalPairs / measuredPairs : 0;
    return {
      date,
      label: date.slice(8, 10),
      measuredOts,
      estimatedOts: measuredOts * factor,
      measuredPairs,
      factor,
    };
  });
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

/**
 * Bandas horarias del informe comercial. Cubren las 24 horas sin solapes: la
 * madrugada se agrupa con la noche porque el circuito está cerrado y sus OTS
 * son residuales, pero no se descartan para que los porcentajes sumen 100.
 */
const BRAND_TIME_BANDS = [
  {
    label: 'Mañana',
    hours: '06:00 — 12:00',
    covers: (hour: number) => hour >= 6 && hour < 12,
  },
  {
    label: 'Tarde',
    hours: '12:00 — 18:00',
    covers: (hour: number) => hour >= 12 && hour < 18,
  },
  {
    label: 'Noche',
    hours: '18:00 — 06:00',
    covers: (hour: number) => hour >= 18 || hour < 6,
  },
] as const;

/**
 * Reparto de los OTS medidos entre mañana, tarde y noche.
 *
 * Se calcula sobre `supportHours`, que no todos los reportes traen: cuando
 * falta, devuelve una lista vacía y el informe omite el bloque en vez de
 * dibujar ceros.
 */
export function brandTimeOfDay(report: QuividiCampaignReport): BrandTimeBand[] {
  const measured = report.supportHours.filter(
    (row) => row.status !== 'missing',
  );
  if (measured.length === 0) return [];

  const totals = BRAND_TIME_BANDS.map((band) =>
    sum(measured.filter((row) => band.covers(row.hour)).map((row) => row.ots)),
  );

  const total = sum(totals);
  if (total <= 0) return [];

  return BRAND_TIME_BANDS.map((band, index) => ({
    label: band.label,
    hours: band.hours,
    share: ((totals[index] ?? 0) / total) * 100,
  }));
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
