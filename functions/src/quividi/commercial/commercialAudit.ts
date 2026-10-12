import { gunzipSync } from 'node:zlib';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { canUseCommercialIntelligence, roleFromClaims } from '../access';
import { combineCameraValues, isZoneSplitPair } from '../cameraCombination';
import {
  buildEffectiveSupportPairs,
  type CampaignDoc,
  type ScreenDoc,
} from '../effectiveScope';
import type { StoreBinding } from '../historyModel';
import {
  dayList,
  inputSignature,
  numeric,
  parseCivilDate,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotIsFresh,
  type OtsExportRow,
  type SupportDay,
  type ViewerExportRow,
} from '../measurement';
import {
  BINDINGS_COLLECTION,
  COMMERCIAL_DAILY_COLLECTION,
  bindingValidOn,
  commercialDailyDocId,
  loadPartitionRows,
} from './commercialRollupJob';
import type { CommercialDailyRow } from './commercialRollup';

/**
 * Auditoría de consistencia (Fase 3): visor de solo lectura, sin acción
 * automática. Nunca dispara alertas ni corrige nada; solo muestra, para una
 * Tienda+Soporte+rango, el crudo ya guardado por Fase 2, el rollup comercial
 * ya persistido (`quividiCommercialDaily`) y, si se indica una campaña con
 * snapshot vigente, la cifra ya publicada por Fase 1. El backend compara por
 * `locationId`/punto; el cliente siempre rotula por Tienda+Soporte.
 */

const SNAPSHOT_COLLECTION = 'campaignAudienceSnapshots';

/**
 * Rango máximo (días, inclusive) de una auditoría. Cada día dispara varias
 * lecturas de Firestore/Storage; sin tope, una llamada directa al callable con
 * `0000-01-01`…`9999-12-31` materializaría millones de fechas.
 */
export const MAX_AUDIT_DAYS = 93;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Rango válido: fechas reales, fin ≥ inicio y como máximo `MAX_AUDIT_DAYS`. */
export function isValidAuditRange(startDate: string, endDate: string): boolean {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return false;
  if (endDate < startDate) return false;
  const days =
    (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) /
      86_400_000 +
    1;
  return days <= MAX_AUDIT_DAYS;
}

export interface RawPointDay {
  locationId: number;
  pointId: string | null;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
  measured: boolean;
}

export interface Fase1Figure {
  zoneSplit: boolean;
  ots: number;
  effectiveOts: number;
  watchers: number;
  publishedOts: number;
  publishedEffectiveOts: number;
  publishedWatchers: number;
  attentionSeconds: number;
  dwellSeconds: number;
}

/**
 * Consistencia entre el crudo (recombinado con la misma regla de
 * `cameraCombination.ts`) y el rollup ya persistido. Solo informativa: una
 * discrepancia sugiere reconstruir el rollup (`quividi-commercialRollupBuild`),
 * nunca dispara una corrección automática.
 */
export type ConsistencyFlag = 'ok' | 'mismatch' | 'no-data';

export interface CommercialAuditDay {
  date: string;
  raw: RawPointDay[];
  commercial: CommercialDailyRow | null;
  fase1: Fase1Figure | null;
  consistency: ConsistencyFlag;
}

export interface CommercialAuditResult {
  storeNumber: string;
  storeName: string;
  support: string;
  days: CommercialAuditDay[];
}

function tenthsToSeconds(tenths: number, watchers: number): number {
  return watchers > 0 ? tenths / watchers / 10 : 0;
}

async function rawPointDaysFor(
  storeNumber: string,
  support: string,
  date: string,
  bindings: readonly StoreBinding[],
): Promise<RawPointDay[]> {
  const storeId = `LIV-${storeNumber}`;
  const matching = bindings.filter(
    (binding) =>
      binding.storeId === storeId &&
      binding.support === support &&
      bindingValidOn(binding, date),
  );
  return Promise.all(
    matching.map(async (binding) => {
      const [otsRows, viewerRows] = await Promise.all([
        loadPartitionRows(
          getFirestore(),
          binding.locationId,
          date,
          'ots',
          '1h',
        ),
        loadPartitionRows(
          getFirestore(),
          binding.locationId,
          date,
          'viewers',
          '1h',
        ),
      ]);
      const ots = (otsRows as OtsExportRow[]).reduce(
        (sum, row) => sum + numeric(row.ots_count),
        0,
      );
      const effectiveOts = (otsRows as OtsExportRow[]).reduce(
        (sum, row) => sum + numeric(row.effective_ots_count),
        0,
      );
      const watchers = (viewerRows as ViewerExportRow[]).reduce(
        (sum, row) => sum + numeric(row.watcher_count),
        0,
      );
      const attentionTenths = (viewerRows as ViewerExportRow[]).reduce(
        (sum, row) => sum + numeric(row.attention_time_in_tenths_of_sec),
        0,
      );
      const dwellTenths = (viewerRows as ViewerExportRow[]).reduce(
        (sum, row) => sum + numeric(row.dwell_time_in_tenths_of_sec),
        0,
      );
      return {
        locationId: binding.locationId,
        pointId: binding.pointId,
        ots,
        effectiveOts,
        watchers,
        attentionSeconds: tenthsToSeconds(attentionTenths, watchers),
        dwellSeconds: tenthsToSeconds(dwellTenths, watchers),
        measured: otsRows.length > 0 || viewerRows.length > 0,
      };
    }),
  );
}

const CONSISTENCY_TOLERANCE = 0.5;

/**
 * Recombina el crudo medido con la misma regla que ya aplicó el rollup
 * (`cameraCombination.ts`) y lo compara contra lo persistido en
 * `quividiCommercialDaily`. No corrige nada: solo señala si el rollup está
 * desalineado con el crudo actual (por ejemplo, datos tardíos de Fase 2 que
 * aún no reconstruyeron el rollup del día).
 */
function consistencyFor(
  raw: readonly RawPointDay[],
  commercial: CommercialDailyRow | null,
  zoneSplit: boolean,
): ConsistencyFlag {
  const measured = raw.filter((point) => point.measured);
  if (!commercial || commercial.status === 'missing') {
    return measured.length === 0 ? 'no-data' : 'mismatch';
  }
  if (measured.length === 0) return 'no-data';
  const recombined = combineCameraValues(measured.map((point) => point.ots), zoneSplit);
  return Math.abs(recombined - commercial.ots) <= CONSISTENCY_TOLERANCE
    ? 'ok'
    : 'mismatch';
}

/**
 * Decodificación mínima del snapshot Fase 1 (`campaignAudienceSnapshots`),
 * solo para leer `supportDays` como referencia de auditoría. Deliberadamente
 * no importa `functions/src/quividi/index.ts` para no crear un ciclo
 * (index.ts re-exporta este módulo).
 */
function decodeFase1SupportDays(value: unknown): SupportDay[] | null {
  try {
    if (!(value instanceof Buffer) && !(value instanceof Uint8Array)) return null;
    const json = gunzipSync(Buffer.from(value)).toString('utf8');
    const parsed = JSON.parse(json) as { supportDays?: SupportDay[] };
    return Array.isArray(parsed.supportDays) ? parsed.supportDays : null;
  } catch {
    return null;
  }
}

/**
 * `supportDays` del snapshot Fase 1 **sólo si sigue vigente**, con las mismas
 * comprobaciones que el reporte por campaña (`index.ts`): versión de esquema,
 * firma de entradas (campaña, alcance y vigencia) y frescura del corte. Un
 * snapshot que Fase 1 rechazaría y regeneraría no se muestra como referencia.
 */
async function loadValidFase1SupportDays(
  db: Firestore,
  campaignId: string,
): Promise<SupportDay[] | null> {
  const [campaignSnap, snapshot] = await Promise.all([
    db.collection('campaigns').doc(campaignId).get(),
    db.collection(SNAPSHOT_COLLECTION).doc(campaignId).get(),
  ]);
  if (!campaignSnap.exists || !snapshot.exists) return null;
  const saved = snapshot.data();
  if (
    saved?.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    typeof saved?.generatedAt !== 'number'
  ) {
    return null;
  }
  const campaign = campaignSnap.data() as CampaignDoc;
  const startDate = parseCivilDate(campaign.fechaInicio ?? '');
  const endDate = parseCivilDate(campaign.fechaFin ?? '');
  if (!startDate || !endDate) return null;
  if (!snapshotIsFresh(saved.generatedAt, startDate, endDate, Date.now())) {
    return null;
  }
  const screensSnap = await db.collection('screens').get();
  const screens = screensSnap.docs.map((doc) => doc.data() as ScreenDoc);
  const scope = await buildEffectiveSupportPairs(db, campaignId, campaign, screens);
  const signature = inputSignature(
    campaign,
    scope.pairs,
    scope.origins,
    startDate,
    endDate,
  );
  if (saved.inputSignature !== signature) return null;
  return decodeFase1SupportDays(saved.compressedReport);
}

function fase1FigureFor(
  supportDays: readonly SupportDay[] | null,
  storeNumber: string,
  support: string,
  date: string,
): Fase1Figure | null {
  if (!supportDays) return null;
  const row = supportDays.find(
    (day) =>
      day.date === date &&
      day.storeNumber === storeNumber &&
      day.support === support,
  );
  if (!row) return null;
  return {
    zoneSplit: row.zoneSplit,
    ots: row.ots,
    effectiveOts: row.effectiveOts,
    watchers: row.watchers,
    publishedOts: row.publishedOts,
    publishedEffectiveOts: row.publishedEffectiveOts,
    publishedWatchers: row.publishedWatchers,
    attentionSeconds: row.attentionSeconds,
    dwellSeconds: row.dwellSeconds,
  };
}

export const commercialAudit = onCall(async (request) => {
  const role = roleFromClaims(request.auth?.token);
  if (!request.auth || !canUseCommercialIntelligence(role)) {
    throw new HttpsError(
      'permission-denied',
      'No autorizado para auditar la capa comercial.',
    );
  }
  const data = request.data as {
    storeNumber?: unknown;
    support?: unknown;
    startDate?: unknown;
    endDate?: unknown;
    campaignId?: unknown;
  };
  const storeNumber = typeof data.storeNumber === 'string' ? data.storeNumber.trim() : '';
  const support = typeof data.support === 'string' ? data.support.trim() : '';
  const startDate = typeof data.startDate === 'string' ? data.startDate : '';
  const endDate = typeof data.endDate === 'string' ? data.endDate : '';
  const campaignId = typeof data.campaignId === 'string' ? data.campaignId : null;
  if (!storeNumber || !support || !isValidAuditRange(startDate, endDate)) {
    throw new HttpsError(
      'invalid-argument',
      `Tienda, soporte y un rango de fechas válido (máximo ${MAX_AUDIT_DAYS} días) son obligatorios.`,
    );
  }

  const db = getFirestore();
  const [bindingsSnap, fase1SupportDays] = await Promise.all([
    db.collection(BINDINGS_COLLECTION).get(),
    campaignId ? loadValidFase1SupportDays(db, campaignId) : null,
  ]);
  const dates = dayList(startDate, endDate);
  const bindings = bindingsSnap.docs.map((doc) => doc.data() as StoreBinding);
  const storeBinding = bindings.find(
    (binding) => binding.storeId === `LIV-${storeNumber}` && binding.support === support,
  );
  const zoneSplit = isZoneSplitPair({
    storeName: storeBinding?.storeName ?? '',
    support,
  });

  const days: CommercialAuditDay[] = await Promise.all(
    dates.map(async (date) => {
      const [raw, commercialDoc] = await Promise.all([
        rawPointDaysFor(storeNumber, support, date, bindings),
        db
          .collection(COMMERCIAL_DAILY_COLLECTION)
          .doc(commercialDailyDocId(date, storeNumber, support))
          .get(),
      ]);
      const fase1 = fase1FigureFor(fase1SupportDays, storeNumber, support, date);
      const commercial = commercialDoc.exists
        ? (commercialDoc.data() as CommercialDailyRow)
        : null;
      return {
        date,
        raw,
        commercial,
        fase1,
        consistency: consistencyFor(raw, commercial, zoneSplit),
      };
    }),
  );

  return {
    storeNumber,
    storeName: storeBinding?.storeName ?? '',
    support,
    days,
  } satisfies CommercialAuditResult;
});
