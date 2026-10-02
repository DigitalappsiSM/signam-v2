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
   * tienen 2 pantallas en el mismo sitio. Insurgentes y BANNER DIGITAL (zona
   * partida) suman sus cámaras y no se duplican. Calculado en el backend
   * (`functions/src/quividi/cameraCombination.ts`); el informe comercial lo
   * usa, el Excel técnico sigue usando `ots`/`effectiveOts`/`watchers`
   * (lo medido, sin duplicar).
   */
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
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
}

export interface QuividiDemographicRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  gender: number;
  age: number;
  watchers: number;
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
  schemaVersion: 3 | 4 | 5 | 6 | 7;
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
