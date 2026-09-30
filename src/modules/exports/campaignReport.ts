import type { AdmiraScreen } from '@/domain';
import {
  buildScreenIndex,
  matchCampaignScreens,
  normalizeStore,
  type ScreenIndex,
} from '@/modules/consolidation/consolidate';
import { parseCampaignDate } from '@/modules/campaigns/dateFilter';
import type { ConsolidationIssue } from '@/modules/consolidation/consolidate';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';

/**
 * Modelo puro del reporte de desglose de campañas (Excel).
 *
 * Produce una fila por cada combinación única de identidad de campaña + número
 * Ekon + configuración de pantalla (tienda, soporte, tipo, modelo, circuito,
 * resolución, formato y nombre en plataforma). NO cuenta pantallas: si varias
 * pantallas físicas comparten esos campos, colapsan en una sola fila.
 *
 * El cruce calendario ↔ catálogo reutiliza `buildScreenIndex` /
 * `matchCampaignScreens` de la consolidación (pantallas activas, cruce por
 * tienda + `calendarSupport`, excepción de Guadalajara y exclusión de InStore
 * Media / ISM). No se reusa el índice de consolidaciones agrupado por
 * `campaignName`, porque mezclaría campañas homónimas con datos o fechas
 * distintas: aquí se cruza cada `StoredCampaign` por separado.
 */

/** Una fila del desglose: identidad de campaña + una configuración de pantalla. */
export interface CampaignReportRow {
  /** Número de campaña Ekon (repetido en cada fila); `null` si no está asociado. */
  ekonNumber: number | null;
  campaignName: string;
  /** Campo `tipo` de la campaña, tal como está guardado en SIGNAM. */
  campaignType: string;
  /** Fecha de inicio, texto literal del calendario (se formatea al exportar). */
  startDate: string;
  endDate: string;
  storeNumber: string;
  storeName: string;
  /** Soporte Liverpool (`AdmiraScreen.metadata.calendarSupport`). */
  liverpoolSupport: string;
  screenType: string;
  model: string;
  circuit: string;
  resolution: string;
  format: string;
  platformName: string;
}

/** Una incidencia del reporte (cruce fallido o soporte/pantalla excluido). */
export interface CampaignReportIssue {
  ekonNumber: number | null;
  campaignName: string;
  campaignType: string;
  startDate: string;
  endDate: string;
  support: string;
  store?: string;
  /** Código estructurado (de la consolidación o propio del reporte). */
  code: string;
  message: string;
}

export interface CampaignReport {
  rows: CampaignReportRow[];
  issues: CampaignReportIssue[];
}

/** Convierte una pantalla del catálogo en una fila del desglose. */
function screenToRow(
  campaign: StoredCampaign,
  ekonNumber: number | null,
  screen: AdmiraScreen,
): CampaignReportRow {
  return {
    ekonNumber,
    campaignName: campaign.name,
    campaignType: campaign.tipo.trim(),
    startDate: campaign.fechaInicio,
    endDate: campaign.fechaFin,
    storeNumber: normalizeStore(screen.original['Numero de Tienda']),
    storeName: (screen.original['Nombre de tienda'] ?? '').trim(),
    liverpoolSupport: (screen.metadata.calendarSupport ?? '').trim(),
    screenType: (screen.original['TIPO DE pantallas'] ?? '').trim(),
    model: (screen.original.Modelo ?? '').trim(),
    circuit: (screen.original.CIRCUITO ?? '').trim(),
    resolution: (screen.original.RESOLUCION ?? '').trim(),
    format: (screen.original.FORMATO ?? '').trim(),
    platformName: (screen.original['Nombre en plataforma'] ?? '').trim(),
  };
}

/** Clave de deduplicación de una configuración dentro de una misma campaña. */
function configKey(r: CampaignReportRow): string {
  return JSON.stringify([
    r.storeNumber,
    r.storeName,
    r.liverpoolSupport,
    r.screenType,
    r.model,
    r.circuit,
    r.resolution,
    r.format,
    r.platformName,
  ]);
}

/** Tiempo comparable de una fecha de campaña (0 si no es interpretable). */
function dateTime(value: string): number {
  return parseCampaignDate(value)?.getTime() ?? 0;
}

/** Compara números de tienda como enteros cuando ambos lo son; si no, texto. */
function compareStore(a: string, b: string): number {
  const na = /^\d+$/.test(a);
  const nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  return a.localeCompare(b, 'es');
}

/** Orden determinístico: por campaña, fechas y luego toda la configuración. */
function compareRows(a: CampaignReportRow, b: CampaignReportRow): number {
  return (
    a.campaignName.localeCompare(b.campaignName, 'es') ||
    dateTime(a.startDate) - dateTime(b.startDate) ||
    dateTime(a.endDate) - dateTime(b.endDate) ||
    compareStore(a.storeNumber, b.storeNumber) ||
    a.liverpoolSupport.localeCompare(b.liverpoolSupport, 'es') ||
    a.screenType.localeCompare(b.screenType, 'es') ||
    a.model.localeCompare(b.model, 'es') ||
    a.circuit.localeCompare(b.circuit, 'es') ||
    a.resolution.localeCompare(b.resolution, 'es') ||
    a.format.localeCompare(b.format, 'es') ||
    a.platformName.localeCompare(b.platformName, 'es')
  );
}

/**
 * Construye el reporte de desglose para un conjunto de campañas.
 *
 * El índice de pantallas se construye **una sola vez** por reporte y se
 * reutiliza para cada campaña. Cada `StoredCampaign` se cruza por separado, de
 * modo que dos campañas con el mismo nombre pero distintas fechas o soportes no
 * se mezclan. Dentro de cada campaña las configuraciones idénticas se colapsan
 * (no se cuenta cada pantalla física).
 */
export function buildCampaignReport(
  campaigns: readonly StoredCampaign[],
  screens: readonly AdmiraScreen[],
  ekonByKey: ReadonlyMap<string, number>,
  prebuiltIndex?: ScreenIndex,
  /**
   * Incidencias de la resolución de Mupi/Pendón sin detalle (ver
   * `consolidation/instoreEkon.ts`). Las campañas que se pasan aquí ya deben
   * venir con esos soportes resueltos.
   */
  extraIssues: readonly ConsolidationIssue[] = [],
): CampaignReport {
  const index = prebuiltIndex ?? buildScreenIndex(screens);
  const rows: CampaignReportRow[] = [];
  const issues: CampaignReportIssue[] = [];
  const reportedExtraNames = new Set<string>();

  for (const campaign of campaigns) {
    const ekonNumber = ekonByKey.get(campaign.id) ?? null;
    // Mismo criterio que el CSV: Mupi y Pendón se cruzan como cualquier soporte.
    const match = matchCampaignScreens(campaign, index, {
      includeInstore: true,
    });

    // Filas del desglose (deduplicadas por configuración dentro de la campaña).
    const seen = new Set<string>();
    for (const screen of match.matched) {
      const row = screenToRow(campaign, ekonNumber, screen);
      const key = configKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }

    // Incidencias: cruces fallidos e InStore Media excluidos.
    const ekonIssues = reportedExtraNames.has(campaign.name)
      ? []
      : extraIssues.filter((i) => i.campaign === campaign.name);
    reportedExtraNames.add(campaign.name);
    for (const issue of [...match.issues, ...ekonIssues]) {
      issues.push({
        ekonNumber,
        campaignName: campaign.name,
        campaignType: campaign.tipo.trim(),
        startDate: campaign.fechaInicio,
        endDate: campaign.fechaFin,
        support: issue.support,
        store: issue.store,
        code: issue.code,
        message: issue.message,
      });
    }
    for (const ex of match.excludedInstore) {
      issues.push({
        ekonNumber,
        campaignName: campaign.name,
        campaignType: campaign.tipo.trim(),
        startDate: campaign.fechaInicio,
        endDate: campaign.fechaFin,
        support: ex.support,
        code: 'instore-excluded',
        message: `Soporte InStore Media "${ex.support}" excluido del desglose en esta etapa. Campaña "${campaign.name}".`,
      });
    }
  }

  rows.sort(compareRows);
  return { rows, issues };
}
