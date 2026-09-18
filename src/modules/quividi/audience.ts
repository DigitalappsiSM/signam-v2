export interface QuividiCameraRef {
  locationId: number;
  boxId?: number | null;
  siteId?: number | null;
  name: string;
}

export interface DemographicBuckets {
  gender: Record<string, number>;
  age: Record<string, number>;
  ageGender: Record<string, number>;
}

export interface QuividiDailyCameraMetrics {
  date: string;
  locationId: number;
  cameraName: string;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number | null;
  dwellSeconds: number | null;
  durationSeconds: number | null;
  demographics?: DemographicBuckets;
}

export type MeasurementStatus = 'complete' | 'partial' | 'missing';

export interface QuividiSupportMapping {
  key: string;
  retailer: string;
  storeNumber: string;
  storeName: string;
  support: string;
  cameras: QuividiCameraRef[];
}

export interface SupportDayMetrics {
  date: string;
  supportKey: string;
  status: MeasurementStatus;
  expectedCameras: number;
  validCameras: number;
  missingCameraNames: string[];
  ots: number | null;
  effectiveOts: number | null;
  watchers: number | null;
  attentionSeconds: number | null;
  dwellSeconds: number | null;
  durationSeconds: number | null;
  demographics: DemographicBuckets;
}

export interface MeasurementIncident {
  supportKey: string;
  cameraName: string;
  startDate: string;
  endDate: string;
  days: number;
}

export const QUIVIDI_INDICATOR_DEFINITIONS = {
  ots: 'Personas que tuvieron la oportunidad de estar expuestas al soporte.',
  effectiveOts:
    'Personas que, por su posición o recorrido, realmente pudieron ver la pantalla.',
  watchers: 'Personas que dirigieron la mirada hacia la pantalla.',
  attentionRate: 'De las personas expuestas, qué porcentaje miró la pantalla.',
  attentionTime:
    'Tiempo promedio que las personas estuvieron mirando la pantalla.',
  dwellTime:
    'Tiempo promedio que las personas permanecieron frente o cerca del soporte.',
  footfall: 'Personas que pasaron por la zona donde está instalado el soporte.',
  quividiCoverage:
    'Qué parte de los soportes de la campaña cuenta con medición de audiencia.',
  measurementCoverage:
    'Qué parte del periodo de campaña tuvo datos válidos disponibles.',
  age: 'Distribución estimada de la audiencia por grupos de edad.',
  gender: 'Distribución estimada de la audiencia detectada por género.',
} as const;

function emptyDemographics(): DemographicBuckets {
  return { gender: {}, age: {}, ageGender: {} };
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function watcherWeightedMean(
  rows: readonly QuividiDailyCameraMetrics[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number | null {
  const usable = rows.filter((row) => row[field] != null && row.watchers > 0);
  const watchers = usable.reduce((sum, row) => sum + row.watchers, 0);
  if (watchers <= 0) return null;
  return (
    usable.reduce((sum, row) => sum + (row[field] ?? 0) * row.watchers, 0) /
    watchers
  );
}

function averageBuckets(
  rows: readonly QuividiDailyCameraMetrics[],
): DemographicBuckets {
  const result = emptyDemographics();
  for (const dimension of ['gender', 'age', 'ageGender'] as const) {
    const keys = new Set(
      rows.flatMap((row) => Object.keys(row.demographics?.[dimension] ?? {})),
    );
    for (const key of keys) {
      const values = rows.map(
        (row) => row.demographics?.[dimension]?.[key] ?? 0,
      );
      result[dimension][key] = mean(values) ?? 0;
    }
  }
  return result;
}

/**
 * Regla acordada: la ponderación ocurre día a día.
 * - 1 cámara configurada: se usa su dato directamente.
 * - N cámaras con dato: se promedian sus conteos para evitar duplicar tráfico.
 * - Si una cámara cae pero otra sigue midiendo: se usa la disponible y el día
 *   queda marcado como partial.
 * - Si ninguna cámara tiene dato: el día queda missing, nunca se imputa cero.
 */
export function aggregateSupportDay(
  mapping: QuividiSupportMapping,
  date: string,
  rows: readonly QuividiDailyCameraMetrics[],
): SupportDayMetrics {
  const expectedIds = new Set(
    mapping.cameras.map((camera) => camera.locationId),
  );
  const valid = rows.filter(
    (row) => row.date === date && expectedIds.has(row.locationId),
  );
  const presentIds = new Set(valid.map((row) => row.locationId));
  const missing = mapping.cameras.filter(
    (camera) => !presentIds.has(camera.locationId),
  );
  const status: MeasurementStatus =
    valid.length === 0
      ? 'missing'
      : missing.length > 0
        ? 'partial'
        : 'complete';

  return {
    date,
    supportKey: mapping.key,
    status,
    expectedCameras: mapping.cameras.length,
    validCameras: valid.length,
    missingCameraNames: missing.map((camera) => camera.name),
    ots: mean(valid.map((row) => row.ots)),
    effectiveOts: mean(valid.map((row) => row.effectiveOts)),
    watchers: mean(valid.map((row) => row.watchers)),
    attentionSeconds: watcherWeightedMean(valid, 'attentionSeconds'),
    dwellSeconds: watcherWeightedMean(valid, 'dwellSeconds'),
    durationSeconds: mean(
      valid.flatMap((row) =>
        row.durationSeconds == null ? [] : [row.durationSeconds],
      ),
    ),
    demographics: averageBuckets(valid),
  };
}

export function buildMeasurementIncidents(
  mapping: QuividiSupportMapping,
  days: readonly SupportDayMetrics[],
): MeasurementIncident[] {
  const incidents: MeasurementIncident[] = [];
  for (const camera of mapping.cameras) {
    const affected = days
      .filter((day) => day.missingCameraNames.includes(camera.name))
      .map((day) => day.date)
      .sort();
    let start: string | null = null;
    let previous: string | null = null;
    let count = 0;

    const flush = () => {
      if (!start || !previous || count === 0) return;
      incidents.push({
        supportKey: mapping.key,
        cameraName: camera.name,
        startDate: start,
        endDate: previous,
        days: count,
      });
      start = null;
      previous = null;
      count = 0;
    };

    for (const date of affected) {
      if (!start) {
        start = date;
        previous = date;
        count = 1;
        continue;
      }
      const previousDate = previous ?? date;
      const prevDate: Date = new Date(previousDate + 'T00:00:00Z');
      prevDate.setUTCDate(prevDate.getUTCDate() + 1);
      const nextExpected: string = prevDate.toISOString().slice(0, 10);
      if (date !== nextExpected) flush();
      if (!start) start = date;
      previous = date;
      count += 1;
    }
    flush();
  }
  return incidents;
}

export function measurementCoverage(
  days: readonly SupportDayMetrics[],
): number {
  if (days.length === 0) return 0;
  return days.filter((day) => day.status !== 'missing').length / days.length;
}
