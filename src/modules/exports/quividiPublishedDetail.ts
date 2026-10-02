import type {
  QuividiCameraDay,
  QuividiCampaignReport,
  QuividiSupportDay,
} from '@/domain';
import {
  brandDemographics,
  brandFormatRates,
  brandMeasurableScope,
  brandPartialDay,
  brandUncoveredPairsByDate,
  partialDayLabel,
  type BrandDemographicRow,
} from './quividiBrandReport';

/**
 * Detalle «Quividi sin modificar → cifra publicada» para el Excel.
 *
 * Cada fila pone lado a lado la lectura tal cual de cada cámara, la cifra que
 * publica el informe comercial y una frase con la regla que llevó de una a la
 * otra. Consume las mismas funciones puras que el PDF (`quividiBrandReport`),
 * así que la suma de lo publicado concilia con `brandCampaignSummary` sobre el
 * día completo (la portada del PDF acota a 10:00–22:00 y puede quedar un poco
 * por debajo).
 */

/** Lectura tal cual de una cámara del par ese día. */
export interface DetailCameraReading {
  locationId: number;
  locationName: string;
  ots: number;
  effectiveOts: number;
  watchers: number;
  status: QuividiCameraDay['status'];
}

export type PublishedDetailOrigin =
  'measured' | 'partial' | 'missing' | 'uncovered' | 'excluded';

export interface PublishedSupportDetailRow {
  date: string;
  storeNumber: string;
  storeName: string;
  support: string;
  /** Estado de medición del par ese día (vacío en filas sin cámara). */
  status: QuividiSupportDay['status'] | '';
  configuredCameras: number;
  cameras: DetailCameraReading[];
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  origin: PublishedDetailOrigin;
  rationale: string;
}

function isZoneSplit(row: QuividiSupportDay): boolean {
  if (row.zoneSplit !== undefined) return row.zoneSplit;
  // Reportes anteriores a v7: 2+ cámaras cuya cifra publicada no se duplicó.
  return (
    row.configuredCameras >= 2 && row.publishedOts === row.ots && row.ots > 0
  );
}

/** Frase con la regla de cámaras aplicada a una fila medida. */
export function cameraRuleRationale(
  row: QuividiSupportDay,
  cameras: readonly DetailCameraReading[],
): string {
  if (row.configuredCameras <= 1) return '1 cámara: lectura × 2';
  if (isZoneSplit(row)) {
    return 'Zona partida: suma de ambas cámaras, sin duplicar';
  }
  if (row.configuredCameras >= 3) {
    return `${row.configuredCameras} cámaras: la más alta, sin duplicar`;
  }
  const reporting = cameras.filter((camera) => camera.status !== 'missing');
  if (reporting.length <= 1) return '2 cámaras, reportó 1: esa lectura × 2';
  let highest = 0;
  cameras.forEach((camera, index) => {
    if (camera.ots > (cameras[highest]?.ots ?? 0)) highest = index;
  });
  return `2 cámaras: la más alta (Cám. ${highest + 1}) × 2`;
}

function pairKey(date: string, storeNumber: string, support: string): string {
  return `${date}|${storeNumber}|${support}`;
}

function camerasByPair(
  report: QuividiCampaignReport,
): Map<string, DetailCameraReading[]> {
  const result = new Map<string, DetailCameraReading[]>();
  for (const camera of report.cameraDays) {
    const key = pairKey(camera.date, camera.storeNumber, camera.support);
    const list = result.get(key) ?? [];
    list.push({
      locationId: camera.locationId,
      locationName: camera.locationName,
      ots: camera.ots,
      effectiveOts: camera.effectiveOts,
      watchers: camera.watchers,
      status: camera.status,
    });
    result.set(key, list);
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.locationId - b.locationId);
  }
  return result;
}

function formatInt(value: number): string {
  return Math.round(value).toLocaleString('es-MX');
}

export function publishedSupportDetail(
  report: QuividiCampaignReport,
): PublishedSupportDetailRow[] {
  const scope = brandMeasurableScope(report);
  const measurable = new Set(scope.measurable.map((format) => format.support));
  const rates = brandFormatRates(report);
  const cameras = camerasByPair(report);
  const partial = brandPartialDay(report);
  const partialText = partial ? partialDayLabel(partial.until) : '';

  const rows: PublishedSupportDetailRow[] = report.supportDays.map((row) => {
    const readings =
      cameras.get(pairKey(row.date, row.storeNumber, row.support)) ?? [];
    const base = {
      date: row.date,
      storeNumber: row.storeNumber,
      storeName: row.storeName,
      support: row.support,
      status: row.status,
      configuredCameras: row.configuredCameras,
      cameras: readings,
      attentionSeconds: row.attentionSeconds,
      dwellSeconds: row.dwellSeconds,
    };
    const measured = row.status !== 'missing';
    const measuredValues = {
      publishedOts: measured ? row.publishedOts : 0,
      publishedEffectiveOts: measured ? row.publishedEffectiveOts : 0,
      publishedWatchers: measured ? row.publishedWatchers : 0,
    };

    if (partial && row.date === partial.date) {
      return {
        ...base,
        ...measuredValues,
        origin: 'partial' as const,
        rationale: measured
          ? `${partialText}: sólo lo medido · ${cameraRuleRationale(row, readings)}`
          : `${partialText}: aún sin dato, no se estima`,
      };
    }
    if (!measurable.has(row.support)) {
      return {
        ...base,
        publishedOts: 0,
        publishedEffectiveOts: 0,
        publishedWatchers: 0,
        origin: 'excluded' as const,
        rationale:
          'Formato sin ninguna medición: fuera de la cifra (alcance adicional)',
      };
    }
    if (!measured) {
      const rate = rates.get(row.support);
      return {
        ...base,
        publishedOts: rate?.ots ?? 0,
        publishedEffectiveOts: rate?.effectiveOts ?? 0,
        publishedWatchers: rate?.watchers ?? 0,
        origin: 'missing' as const,
        rationale: `Sin dato ese día: promedio del formato (${formatInt(rate?.ots ?? 0)} OTS por soporte-día)`,
      };
    }
    return {
      ...base,
      ...measuredValues,
      origin: 'measured' as const,
      rationale: cameraRuleRationale(row, readings),
    };
  });

  for (const gap of brandUncoveredPairsByDate(report)) {
    const rate = rates.get(gap.support);
    const label = gap.pairs === 1 ? 'soporte' : 'soportes';
    rows.push({
      date: gap.date,
      storeNumber: '',
      storeName: `Sin cámara (${gap.pairs} ${label})`,
      support: gap.support,
      status: '',
      configuredCameras: 0,
      cameras: [],
      publishedOts: (rate?.ots ?? 0) * gap.pairs,
      publishedEffectiveOts: (rate?.effectiveOts ?? 0) * gap.pairs,
      publishedWatchers: (rate?.watchers ?? 0) * gap.pairs,
      attentionSeconds: 0,
      dwellSeconds: 0,
      origin: 'uncovered',
      rationale: `Sin cámara: promedio del formato × ${gap.pairs} ${label}`,
    });
  }

  return rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.support.localeCompare(b.support, 'es') ||
      (a.storeNumber === '' ? 1 : 0) - (b.storeNumber === '' ? 1 : 0) ||
      a.storeNumber.localeCompare(b.storeNumber, 'es', { numeric: true }),
  );
}

export interface PublishedDemographicDetailRow extends BrandDemographicRow {
  /** Lectura tal cual de cada cámara (sólo filas medidas). */
  cameraWatchers: number[];
  rationale: string;
}

/** Demografía con la lectura de cada cámara, lo publicado y su origen. */
export function publishedDemographicDetail(
  report: QuividiCampaignReport,
): PublishedDemographicDetailRow[] {
  const partial = brandPartialDay(report);
  const partialText = partial ? partialDayLabel(partial.until) : '';
  const cameras = camerasByPair(report);
  const supportRows = new Map(
    report.supportDays.map((row) => [
      pairKey(row.date, row.storeNumber, row.support),
      row,
    ]),
  );
  const raw = new Map(
    report.demographics.map((row) => [
      `${pairKey(row.date, row.storeNumber, row.support)}|${row.gender}|${row.age}`,
      row,
    ]),
  );

  return brandDemographics(report)
    .map((row) => {
      const key = pairKey(row.date, row.storeNumber, row.support);
      const readings = cameras.get(key) ?? [];
      const source = raw.get(`${key}|${row.gender}|${row.age}`);
      const byCamera = new Map(
        (source?.cameraWatchers ?? []).map((item) => [
          item.locationId,
          item.watchers,
        ]),
      );
      const cameraWatchers =
        row.origin === 'measured' || row.origin === 'partial'
          ? readings.length > 0 && byCamera.size > 0
            ? readings.map((camera) => byCamera.get(camera.locationId) ?? 0)
            : [source?.watchers ?? 0]
          : [];
      const supportRow = supportRows.get(key);
      const rule = supportRow
        ? cameraRuleRationale(supportRow, readings)
        : 'Medido';
      const rationale =
        row.origin === 'measured'
          ? rule
          : row.origin === 'partial'
            ? `${partialText}: sólo lo medido · ${rule}`
            : row.origin === 'missing'
              ? 'Estimado: sin dato ese día (promedio y perfil del formato)'
              : `Estimado: sin cámara (promedio y perfil del formato × ${row.uncoveredPairs ?? 0})`;
      return { ...row, cameraWatchers, rationale };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.support.localeCompare(b.support, 'es') ||
        (a.storeNumber === '' ? 1 : 0) - (b.storeNumber === '' ? 1 : 0) ||
        a.storeNumber.localeCompare(b.storeNumber, 'es', { numeric: true }) ||
        a.gender - b.gender ||
        a.age - b.age,
    );
}
