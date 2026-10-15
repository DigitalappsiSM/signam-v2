/**
 * Tipos compartidos de la integración Quividi.
 *
 * La relación comercial se evalúa por Tienda + Soporte. Una combinación puede
 * tener una o varias cámaras (locations) y, cuando hay varias, SIGNAM promedia
 * únicamente las cámaras con medición válida en cada día.
 */

export type QuividiMeasurementStatus = 'complete' | 'partial' | 'missing';

export type QuividiScopeSource =
  | 'calendar-selected'
  | 'calendar-all'
  | 'calendar-full-circuit'
  | 'ekon'
  | 'unresolved';

export interface QuividiScopeOrigin {
  support: string;
  source: QuividiScopeSource;
  pairCount: number;
  ekonNumber: number | null;
}

export interface QuividiCameraIdentity {
  locationId: number;
  locationName: string;
  boxId: number | null;
  siteId: number | null;
  active: boolean;
  lastSeen: string | null;
}

export interface QuividiCameraDay extends QuividiCameraIdentity {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  durationSeconds: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionTenths: number;
  dwellTenths: number;
  status: QuividiMeasurementStatus;
}

export interface QuividiSupportDay {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  status: QuividiMeasurementStatus;
  ots: number;
  effectiveOts: number;
  watchers: number;
  /**
   * Cifra de cara a marca: igual a `ots`/`effectiveOts`/`watchers` salvo que
   * el circuito tenga 1 cámara configurada, o 2 fuera de zona partida (la
   * más alta), caso en el que se duplica — la mayoría de esos circuitos
   * tienen 2 pantallas en el mismo sitio. El Mupi de Insurgentes y BANNER
   * DIGITAL (zona partida) suman sus cámaras y no se duplican; el Mupi de
   * Polanco (pantalla única) se publica tal cual. Calculado en el backend
   * (`functions/src/quividi/cameraCombination.ts`); el informe comercial lo
   * usa, el Excel técnico sigue usando `ots`/`effectiveOts`/`watchers`
   * (lo medido, sin duplicar).
   */
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  /** Zona partida (Mupi de Insurgentes, BANNER DIGITAL): suma sus cámaras (v7). */
  zoneSplit?: boolean;
  /** Factor de la cifra publicada sobre la medida: 1 o 2 (desde v10). */
  publishedFactor?: number;
  /**
   * Parte **estimada** de la fila, ya incluida en `ots`/`published*`. Nunca
   * viene del backend: la añade el informe comercial al rellenar con el
   * promedio propio de la pantalla (`quividiGapFill.ts`). `full` indica que
   * el par-día entero es estimado (ninguna cámara reportó).
   */
  gapFill?: QuividiGapFillAmount;
}

/** Cantidad estimada por relleno de huecos (cruda y publicada). */
export interface QuividiGapFillAmount {
  full: boolean;
  ots: number;
  effectiveOts: number;
  watchers: number;
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
}

/** Lectura de una cámara en una hora (v9 zona partida; v10 todo par de 2+ cámaras). */
export interface QuividiCameraHourReading {
  locationId: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
}

export interface QuividiSupportHour {
  date: string;
  hour: number;
  storeNumber: string;
  storeName: string;
  support: string;
  configuredCameras: number;
  measuredCameras: number;
  status: QuividiMeasurementStatus;
  ots: number;
  effectiveOts: number;
  watchers: number;
  /** Ver `QuividiSupportDay.publishedOts`. */
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  /** Zona partida: suma sus cámaras (desde v10). */
  zoneSplit?: boolean;
  /** Factor de la cifra publicada sobre la medida: 1 o 2 (desde v10). */
  publishedFactor?: number;
  /**
   * Lectura de cada cámara que reportó: v9 sólo zona partida con 2+ cámaras;
   * desde v10 todo par de 2+ cámaras (relleno cámara por cámara).
   */
  cameraReadings?: QuividiCameraHourReading[];
}

export interface QuividiDemographicRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  gender: number;
  age: number;
  /** Combinado con la misma regla que `QuividiSupportDay.watchers`. */
  watchers: number;
  /** `watchers` duplicado donde aplica (desde schema v7). */
  publishedWatchers?: number;
  /** Lectura tal cual de cada cámara del par (desde schema v7). */
  cameraWatchers?: Array<{ locationId: number; watchers: number }>;
  /** Fila estimada por relleno de huecos (sólo en cliente, nunca del backend). */
  estimated?: boolean;
}

export interface QuividiCoverageBySupport {
  support: string;
  totalPairs: number;
  mappedPairs: number;
  percent: number;
}

export interface QuividiCoverage {
  totalPairs: number;
  mappedPairs: number;
  percent: number;
  bySupport: QuividiCoverageBySupport[];
  /** Soportes del universo sin punto de medición asignado (desde v10). */
  unmappedPairs?: Array<{
    storeNumber: string;
    storeName: string;
    support: string;
  }>;
}

/** Cobertura comercial por tiendas únicas del universo de campaña. */
export interface QuividiStoreCoverage {
  totalStores: number;
  mappedStores: number;
  percent: number;
}

export interface QuividiMeasurementIncident {
  storeNumber: string;
  storeName: string;
  support: string;
  locationId: number;
  locationName: string;
  dates: string[];
  status: 'partial' | 'missing';
}

export interface QuividiCampaignReport {
  // v5 agrega publishedOts/publishedEffectiveOts/publishedWatchers a
  // QuividiSupportDay/QuividiSupportHour (duplicación por cámara única).
  // v6 agrega el corte de medición (`measuredEndDate`, `partialDate`,
  // `partialUntil`): el día en curso en horario operativo (día incompleto).
  // v7: 2 cámaras fuera de zona partida → lectura más alta × 2.
  // v9: `supportHours[].cameraReadings` en zona partida con 2+ cámaras.
  // v10: `cameraReadings` en todo par de 2+ cámaras, `zoneSplit` y
  // `publishedFactor` por hora/día; zona partida sólo el Mupi de Insurgentes
  // y BANNER DIGITAL; el Mupi de Polanco no se duplica.
  schemaVersion: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  campaignId: string;
  campaignName: string;
  startDate: string;
  endDate: string;
  generatedAt: number;
  /** Último día consultado a Quividi (desde v6; puede ser hoy, incompleto). */
  measuredEndDate?: string | null;
  /** Día en curso incluido con datos parciales, 10:00–22:00 CDMX (desde v6). */
  partialDate?: string | null;
  /** Hora local `HH:MM` hasta la que se midió `partialDate` (desde v6). */
  partialUntil?: string | null;
  scopeOrigins: QuividiScopeOrigin[];
  coverage: QuividiCoverage;
  /** Disponible desde schema v4; permite extrapolar sin exponer tiendas individuales. */
  storeCoverage?: QuividiStoreCoverage;
  cameraDays: QuividiCameraDay[];
  supportDays: QuividiSupportDay[];
  supportHours: QuividiSupportHour[];
  demographics: QuividiDemographicRow[];
  incidents: QuividiMeasurementIncident[];
  unmappedCameraNames: string[];
  /** Ya pasó por el relleno de huecos del informe comercial (sólo cliente). */
  gapFilled?: boolean;
  /**
   * OTS publicados estimados por el relleno, hora a hora (sólo cliente): la
   * gráfica de horarios los suma a su hora exacta para cuadrar con portada.
   */
  estimatedHours?: Array<{
    date: string;
    storeNumber: string;
    support: string;
    hour: number;
    publishedOts: number;
  }>;
}

export const QUIVIDI_GENDER_LABELS: Record<number, string> = {
  0: 'Desconocido',
  1: 'Masculino',
  2: 'Femenino',
};

export const QUIVIDI_AGE_LABELS: Record<number, string> = {
  0: 'Desconocido',
  1: 'Niñez (1–15)',
  2: 'Adulto joven (16–30)',
  3: 'Adulto (31–65)',
  4: 'Senior (66+)',
};

export const QUIVIDI_KPI_EXPLANATIONS = {
  ots: 'Oportunidades de estar expuesto al soporte.',
  effectiveOts:
    'Oportunidades de exposición dentro del ángulo efectivo de visión.',
  watchers: 'Personas detectadas que dirigieron la mirada hacia la pantalla.',
  attentionRate:
    'De las oportunidades de exposición, qué porcentaje terminó mirando.',
  attentionTime:
    'Tiempo promedio que las personas estuvieron mirando la pantalla.',
  dwellTime:
    'Tiempo promedio que las personas permanecieron frente o cerca del soporte.',
  coverage:
    'Qué parte de los soportes de la campaña cuenta con medición Quividi.',
  measurementCoverage:
    'Qué parte del periodo tuvo datos de medición disponibles.',
  demographics:
    'Estimación estadística de la audiencia detectada; no identifica personas.',
  hourly:
    'Distribución horaria construida con agregados de una hora reportados por VidiCenter para cada ubicación.',
} as const;
