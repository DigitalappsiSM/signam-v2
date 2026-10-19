import { gunzipSync } from 'node:zlib';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { canRebuildCommercialRollup, roleFromClaims } from '../access';
import { historyPartitionId, type StoreBinding } from '../historyModel';
import {
  dayList,
  lastCompleteMexicoDate,
  type OtsExportRow,
  type ViewerExportRow,
} from '../measurement';
import {
  aggregateHourlyCameraDay,
  buildCommercialDailyRow,
  type CommercialCameraDay,
  type CommercialDailyRow,
  type CommercialPair,
} from './commercialRollup';
import { MAX_AUDIT_DAYS, isValidAuditRange } from './dateRange';

/** Restringe la reconstrucción a una Tienda+Soporte (número a 3 dígitos). */
export interface CommercialRollupScope {
  storeNumber: string;
  support: string;
}

/**
 * Orquestación del rollup comercial (Fase 3): construye
 * `quividiCommercialDaily` leyendo exclusivamente lo que el histórico Fase 2
 * ya guardó (`quividiHistoryBindings`, `quividiHistoryPartitions`). Nunca
 * llama a VidiCenter ni modifica esas dos colecciones.
 */

export const COMMERCIAL_DAILY_COLLECTION = 'quividiCommercialDaily';
export const BINDINGS_COLLECTION = 'quividiHistoryBindings';
const PARTITIONS_COLLECTION = 'quividiHistoryPartitions';

export function commercialDailyDocId(
  date: string,
  storeNumber: string,
  support: string,
): string {
  return `${date}__${storeNumber}__${support}`;
}

export function bindingValidOn(binding: StoreBinding, date: string): boolean {
  return (
    binding.validFrom <= date && (binding.validTo === null || date <= binding.validTo)
  );
}

/** Agrupa bindings vigentes por Tienda+Soporte; cada binding es un punto configurado. */
function groupBindingsByPair(
  bindings: readonly StoreBinding[],
  date: string,
): Map<string, StoreBinding[]> {
  const groups = new Map<string, StoreBinding[]>();
  for (const binding of bindings) {
    if (!bindingValidOn(binding, date)) continue;
    const key = `${binding.storeId}|${binding.support}`;
    const group = groups.get(key) ?? [];
    group.push(binding);
    groups.set(key, group);
  }
  return groups;
}

export async function loadPartitionRows(
  db: Firestore,
  locationId: number,
  date: string,
  type: string,
  resolution: string,
): Promise<Record<string, unknown>[]> {
  const id = historyPartitionId(locationId, date, type, resolution);
  const doc = await db.collection(PARTITIONS_COLLECTION).doc(id).get();
  if (!doc.exists || doc.get('status') !== 'complete') return [];
  const rows = doc.get('rows') as Record<string, unknown>[] | undefined;
  if (rows) return rows;
  const rowCount = doc.get('rowCount') as number | undefined;
  const rawPath = doc.get('rawPath') as string | undefined;
  if (!rowCount || !rawPath) return [];
  // Partición grande: las filas se descartaron de Firestore, quedan en Storage.
  const [buffer] = await getStorage().bucket().file(rawPath).download();
  const payload = JSON.parse(gunzipSync(buffer).toString('utf8')) as {
    data?: Record<string, unknown>[];
  };
  return payload.data ?? [];
}

async function cameraDayFor(
  db: Firestore,
  binding: StoreBinding,
  date: string,
): Promise<CommercialCameraDay> {
  const [otsRows, viewerRows] = await Promise.all([
    loadPartitionRows(db, binding.locationId, date, 'ots', '1h'),
    loadPartitionRows(db, binding.locationId, date, 'viewers', '1h'),
  ]);
  return aggregateHourlyCameraDay(
    binding.locationId,
    binding.pointId,
    otsRows as OtsExportRow[],
    viewerRows as ViewerExportRow[],
  );
}

/**
 * Construye el rollup comercial de una sola fecha. Idempotente: sobrescribe
 * el mismo doc id si se corre de nuevo (p. ej. datos tardíos de Fase 2).
 */
export async function buildCommercialRollupForDate(
  date: string,
  scope?: CommercialRollupScope,
  preloadedBindings?: readonly StoreBinding[],
): Promise<CommercialDailyRow[]> {
  const db = getFirestore();
  const bindings =
    preloadedBindings ??
    (await db.collection(BINDINGS_COLLECTION).get()).docs.map(
      (doc) => doc.data() as StoreBinding,
    );
  const scoped = scope
    ? bindings.filter(
        (binding) =>
          binding.storeId === `LIV-${scope.storeNumber}` &&
          binding.support === scope.support,
      )
    : bindings;
  const groups = groupBindingsByPair(scoped, date);

  const rows: CommercialDailyRow[] = [];
  for (const [, group] of groups) {
    const first = group[0]!;
    const configuredPointIds = group.map(
      (binding) => binding.pointId ?? `unresolved:${binding.locationId}`,
    );
    const pair: CommercialPair = {
      storeNumber: first.storeId.replace(/^LIV-/, ''),
      storeName: first.storeName,
      support: first.support,
      configuredPointIds,
    };
    const cameraDays = await Promise.all(
      group.map((binding) => cameraDayFor(db, binding, date)),
    );
    const row = buildCommercialDailyRow(pair, date, cameraDays);
    if (row) rows.push(row);
  }

  const batchSize = 400;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = db.batch();
    for (const row of rows.slice(offset, offset + batchSize)) {
      batch.set(
        db
          .collection(COMMERCIAL_DAILY_COLLECTION)
          .doc(commercialDailyDocId(row.date, row.storeNumber, row.support)),
        row,
      );
    }
    await batch.commit();
  }

  return rows;
}

/**
 * Backfill/soporte manual. No dispara llamadas a Quividi: solo relee lo ya
 * ingerido por Fase 2. Reservado a admin/operator — viewer observa, no
 * recalcula (`canRebuildCommercialRollup`, espejo de
 * `quividi.commercial.rebuild`).
 *
 * Acepta `{ date }` (todas las Tienda+Soporte de ese día) o
 * `{ storeNumber, support, startDate, endDate }` (una sola Tienda+Soporte en
 * un rango de hasta `MAX_AUDIT_DAYS` días, lo que usa el botón «Reconstruir
 * rollup» del visor de auditoría).
 */
export const commercialRollupBuild = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    const role = roleFromClaims(request.auth?.token);
    if (!request.auth || !canRebuildCommercialRollup(role)) {
      throw new HttpsError(
        'permission-denied',
        'Solo admin u operator pueden construir el rollup comercial.',
      );
    }
    const data = (request.data ?? {}) as {
      date?: unknown;
      storeNumber?: unknown;
      support?: unknown;
      startDate?: unknown;
      endDate?: unknown;
    };

    if (data.startDate !== undefined || data.endDate !== undefined) {
      const storeNumber =
        typeof data.storeNumber === 'string' ? data.storeNumber.trim() : '';
      const support = typeof data.support === 'string' ? data.support.trim() : '';
      const startDate = typeof data.startDate === 'string' ? data.startDate : '';
      const endDate = typeof data.endDate === 'string' ? data.endDate : '';
      if (!storeNumber || !support || !isValidAuditRange(startDate, endDate)) {
        throw new HttpsError(
          'invalid-argument',
          `Tienda, soporte y un rango válido (máximo ${MAX_AUDIT_DAYS} días) son obligatorios.`,
        );
      }
      const db = getFirestore();
      const bindings = (await db.collection(BINDINGS_COLLECTION).get()).docs.map(
        (doc) => doc.data() as StoreBinding,
      );
      let rowsWritten = 0;
      for (const date of dayList(startDate, endDate)) {
        const rows = await buildCommercialRollupForDate(
          date,
          { storeNumber, support },
          bindings,
        );
        rowsWritten += rows.length;
      }
      return { startDate, endDate, storeNumber, support, rowsWritten };
    }

    const date = data.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError('invalid-argument', 'Fecha inválida (YYYY-MM-DD).');
    }
    const rows = await buildCommercialRollupForDate(date);
    return { date, rowsWritten: rows.length };
  },
);

/** Reconstruye el último día completo cada madrugada, igual que el resto de Fase 2/salud. */
export const commercialRollupDaily = onSchedule(
  {
    schedule: '30 8 * * *',
    timeZone: 'America/Mexico_City',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const date = lastCompleteMexicoDate(Date.now());
    await buildCommercialRollupForDate(date);
  },
);
