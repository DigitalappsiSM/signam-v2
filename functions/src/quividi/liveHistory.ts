import { gunzipSync } from 'node:zlib';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError } from 'firebase-functions/v2/https';
import { fetchQuividiExport, type QuividiExportPayload } from './exportClient';
import { saveRaw } from './historyIngestion';
import {
  historyRowCivilDate,
  LIVERPOOL_NETWORK_ID,
  quividiApiExportSpec,
  rowsFingerprint,
} from './historyModel';
import type {
  PersistedHistoryLoad,
  PersistedHistorySpec,
} from './historyReader';
import { measurementCutoff, PARTIAL_DAY_CACHE_MS } from './measurement';

/** Today's provisional data never marks a closed-day source partition complete. */
export async function loadLiveHistory(
  requestedLocations: readonly number[],
  date: string,
  specs: readonly PersistedHistorySpec[],
  now: number,
): Promise<PersistedHistoryLoad & { asOf: number }> {
  const db = getFirestore();
  const inventory = await db.collection('quividiHistoryInventory').get();
  const locations = inventory.docs
    .filter((doc) => doc.get('networkId') === LIVERPOOL_NETWORK_ID)
    .map((doc) => Number(doc.id))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
  const requested = new Set(requestedLocations);
  if (
    !locations.length ||
    requestedLocations.some((id) => !locations.includes(id))
  ) {
    throw new HttpsError(
      'failed-precondition',
      'El inventario de audiencia debe sincronizarse antes de actualizar el día actual.',
    );
  }
  const cutoff = measurementCutoff(date, date, now);
  const phase = cutoff.partialDate ? 'partial' : 'closed';
  const rowsBySpec = new Map<string, Record<string, unknown>[]>();
  let asOf = now;
  for (const spec of specs) {
    const apiSpec = quividiApiExportSpec(spec.type);
    // A network-wide key shares the same four live exports across overlapping campaigns.
    const key = rowsFingerprint([
      { date, phase, type: spec.type, resolution: spec.resolution, locations },
    ]);
    const ref = db
      .collection('quividiHistoryControl')
      .doc('liverpool')
      .collection('liveExports')
      .doc(key);
    const readCached = async (): Promise<QuividiExportPayload | null> => {
      const saved = await ref.get();
      const capturedAt = Number(saved.get('capturedAt') ?? 0);
      const path = saved.get('rawPath') as string | undefined;
      if (
        !path ||
        capturedAt > Date.now() ||
        Date.now() - capturedAt >= PARTIAL_DAY_CACHE_MS
      )
        return null;
      const [bytes] = await getStorage().bucket().file(path).download();
      const payload = JSON.parse(
        gunzipSync(bytes).toString('utf8'),
      ) as QuividiExportPayload;
      if (payload.state !== 'finished' || !Array.isArray(payload.data))
        return null;
      asOf = Math.min(asOf, capturedAt);
      return payload;
    };
    let payload = await readCached();
    if (!payload) {
      const params: Record<string, string> = {
        locations: locations.join(','),
        start: `${date}T00:00:00`,
        end: `${date}T23:59:59`,
        data_type: apiSpec.dataType,
        time_resolution: spec.resolution,
      };
      if (apiSpec.groupByDemographics) params.group_by_demographics = '1';
      payload = await fetchQuividiExport(
        params,
        'live',
        readCached,
        async (result) => {
          if (
            (result.data ?? []).some(
              (row) =>
                historyRowCivilDate(row) !== date ||
                !locations.includes(Number(row.location_id)),
            )
          ) {
            throw new Error(
              'La exportación del día actual contiene fechas o ubicaciones inesperadas.',
            );
          }
          const capturedAt = Date.now();
          const path = `quividi-history/network-${LIVERPOOL_NETWORK_ID}/live/${date}/${key}/${rowsFingerprint(result.data ?? [])}.json.gz`;
          await saveRaw(path, result);
          await ref.set({
            date,
            phase,
            type: spec.type,
            resolution: spec.resolution,
            capturedAt,
            rawPath: path,
          });
        },
      );
    }
    if (payload.state !== 'finished')
      throw new HttpsError(
        'unavailable',
        'Los datos de audiencia del día actual no están disponibles.',
      );
    rowsBySpec.set(
      `${spec.type}__${spec.resolution}`,
      (payload.data ?? []).filter((row) =>
        requested.has(Number(row.location_id)),
      ),
    );
  }
  return { complete: true, rowsBySpec, missingPartitionIds: [], asOf };
}
