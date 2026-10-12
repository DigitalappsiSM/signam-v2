import { gunzipSync } from 'node:zlib';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { canUseCommercialIntelligence, roleFromClaims } from '../access';
import { combineCameraValues, isZoneSplitPair } from '../cameraCombination';
import type { StoreBinding } from '../historyModel';
import {
  dayList,
  numeric,
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

async function fase1FigureFor(
  campaignId: string,
  storeNumber: string,
  support: string,
  date: string,
): Promise<Fase1Figure | null> {
  const doc = await getFirestore().collection(SNAPSHOT_COLLECTION).doc(campaignId).get();
  if (!doc.exists) return null;
  const supportDays = decodeFase1SupportDays(doc.get('compressedReport'));
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
  if (
    !storeNumber ||
    !support ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
    endDate < startDate
  ) {
    throw new HttpsError('invalid-argument', 'Tienda, soporte y rango de fechas son obligatorios.');
  }

  const db = getFirestore();
  const [bindingsSnap, dates] = [
    await db.collection(BINDINGS_COLLECTION).get(),
    dayList(startDate, endDate),
  ];
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
      const [raw, commercialDoc, fase1] = await Promise.all([
        rawPointDaysFor(storeNumber, support, date, bindings),
        db
          .collection(COMMERCIAL_DAILY_COLLECTION)
          .doc(commercialDailyDocId(date, storeNumber, support))
          .get(),
        campaignId ? fase1FigureFor(campaignId, storeNumber, support, date) : null,
      ]);
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
