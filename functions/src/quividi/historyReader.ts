import { gunzipSync } from 'node:zlib';
import { getFirestore, type DocumentData } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { historyPartitionId } from './historyModel';

const PARTITIONS = 'quividiHistoryPartitions';

export interface PersistedHistorySpec {
  type: string;
  resolution: string;
}

export interface PersistedHistoryLoad {
  complete: boolean;
  rowsBySpec: Map<string, Record<string, unknown>[]>;
  missingPartitionIds: string[];
}

function specKey(spec: PersistedHistorySpec): string {
  return `${spec.type}__${spec.resolution}`;
}

async function partitionRows(
  data: DocumentData,
): Promise<Record<string, unknown>[]> {
  if (Array.isArray(data.rows)) {
    return data.rows as Record<string, unknown>[];
  }
  if (typeof data.rawPath !== 'string' || !data.rawPath) return [];
  const [bytes] = await getStorage().bucket().file(data.rawPath).download();
  const payload = JSON.parse(gunzipSync(bytes).toString('utf8')) as {
    data?: unknown;
  };
  return Array.isArray(payload.data)
    ? (payload.data as Record<string, unknown>[])
    : [];
}

/**
 * Reads only persisted Quividi history. It never calls VidiCenter.
 *
 * Completeness is intentionally all-or-nothing: every expected
 * location × day × series partition must exist with status=complete before a
 * consumer is allowed to use these rows. This prevents mixed local/API reports.
 */
export async function loadPersistedHistory(
  locationIds: readonly number[],
  dates: readonly string[],
  specs: readonly PersistedHistorySpec[],
): Promise<PersistedHistoryLoad> {
  const db = getFirestore();
  const uniqueLocations = [...new Set(locationIds)].sort((a, b) => a - b);
  const uniqueDates = [...new Set(dates)].sort();
  const rowsBySpec = new Map<string, Record<string, unknown>[]>(
    specs.map((spec) => [specKey(spec), []]),
  );

  const expected = uniqueLocations.flatMap((locationId) =>
    uniqueDates.flatMap((date) =>
      specs.map((spec) => ({
        id: historyPartitionId(
          locationId,
          date,
          spec.type,
          spec.resolution,
        ),
        spec,
      })),
    ),
  );

  const missingPartitionIds: string[] = [];
  for (let offset = 0; offset < expected.length; offset += 250) {
    const page = expected.slice(offset, offset + 250);
    const refs = page.map(({ id }) => db.collection(PARTITIONS).doc(id));
    const snapshots = await db.getAll(...refs);

    for (let index = 0; index < page.length; index += 1) {
      const expectedPartition = page[index]!;
      const snapshot = snapshots[index]!;
      const data = snapshot.data();
      if (!snapshot.exists || data?.status !== 'complete') {
        missingPartitionIds.push(expectedPartition.id);
        continue;
      }
      const target = rowsBySpec.get(specKey(expectedPartition.spec))!;
      target.push(...(await partitionRows(data)));
    }
  }

  return {
    complete: missingPartitionIds.length === 0,
    rowsBySpec,
    missingPartitionIds,
  };
}

export function persistedHistoryRows(
  load: PersistedHistoryLoad,
  type: string,
  resolution: string,
): Record<string, unknown>[] {
  return load.rowsBySpec.get(`${type}__${resolution}`) ?? [];
}
