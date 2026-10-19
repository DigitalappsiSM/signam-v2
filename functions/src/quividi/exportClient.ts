import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError } from 'firebase-functions/v2/https';
import { rowsFingerprint } from './historyModel';

const USERNAME = defineSecret('QUIVIDI_API_USERNAME');
const TOKEN = defineSecret('QUIVIDI_API_TOKEN');
const BASE = 'https://vidicenter.quividi.com/api/v1';
export const EXPORT_LEASE_MS = 10 * 60 * 1000;
export type ExportSource =
  'daily' | 'archive_daily' | 'backfill' | 'recovery' | 'late_data' | 'live';
export interface QuividiExportPayload {
  state: string;
  data?: Record<string, unknown>[];
  httpStatus?: number;
  [key: string]: unknown;
}

/** Slot zero is reserved for operational work; archive work can only claim slot one. */
export function exportSlotOrder(
  source: ExportSource,
  operational = true,
): number[] {
  return source === 'backfill' || source === 'archive_daily' || !operational
    ? [1]
    : [0, 1];
}

export interface QuividiLocation {
  id: number;
  last_seen?: string | null;
}

/** Metadatos de la network (no es un export de audiencia): trae `last_seen` por ubicación. */
export async function fetchQuividiLocations(): Promise<QuividiLocation[]> {
  const response = await fetch(`${BASE}/network/3089/locations/`, {
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${USERNAME.value()}:${TOKEN.value()}`).toString('base64'),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Quividi HTTP ${response.status} (locations).`);
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error('Inventario Quividi inválido.');
  return payload.filter((item): item is QuividiLocation =>
    Number.isInteger((item as QuividiLocation).id),
  );
}

/** Shared across task queues AND interactive calls, not merely per function instance. */
export async function fetchQuividiExport(
  params: Record<string, string>,
  source: ExportSource,
  readCached?: () => Promise<QuividiExportPayload | null>,
  persist?: (payload: QuividiExportPayload) => Promise<void>,
  operational = true,
): Promise<QuividiExportPayload> {
  const db = getFirestore();
  const root = db.collection('quividiHistoryControl').doc('liverpool');
  const owner = randomUUID();
  const queryId = rowsFingerprint([
    Object.fromEntries(Object.entries(params).sort()),
  ]);
  const queryLock = root.collection('exportLocks').doc(queryId);
  const slots = exportSlotOrder(source, operational).map((slot) =>
    root.collection('exportSlots').doc(String(slot)),
  );
  const slot = await db.runTransaction(async (transaction) => {
    const [query, ...states] = await transaction.getAll(queryLock, ...slots);
    const now = Date.now();
    if (((query!.get('expiresAt') as number) ?? 0) > now) {
      throw new HttpsError(
        'resource-exhausted',
        'Los datos solicitados ya se están preparando. Reintenta en unos minutos.',
      );
    }
    const index = states.findIndex(
      (state) => ((state.get('expiresAt') as number) ?? 0) <= now,
    );
    if (index < 0)
      throw new HttpsError(
        'resource-exhausted',
        'La actualización de audiencias está en curso. Reintenta en unos minutos.',
      );
    const selected = slots[index]!;
    const lease = { owner, expiresAt: now + EXPORT_LEASE_MS, source };
    transaction.set(queryLock, lease);
    transaction.set(selected, lease);
    return selected;
  });

  const audit = root.collection('exportAudit').doc(owner);
  let polls = 0;
  let audited = false;
  let outcome = 'error';
  try {
    // Recheck under the query lock: two simultaneous readers must not both export.
    const cached = await readCached?.();
    if (cached) return cached;
    await audit.set({
      source,
      queryId,
      start: params.start,
      end: params.end,
      dataType: params.data_type,
      resolution: params.time_resolution,
      locations: params.locations ?? null,
      site: params.sites ?? null,
      demographics: params.group_by_demographics === '1',
      startedAt: Date.now(),
      status: 'running',
      polls: 0,
    });
    audited = true;
    const deadline = Date.now() + 240_000;
    const path = `${BASE}/data/?${new URLSearchParams(params).toString()}`;
    for (let attempt = 0; attempt < 35 && Date.now() < deadline; attempt++) {
      polls++;
      const response = await fetch(path, {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${USERNAME.value()}:${TOKEN.value()}`).toString(
              'base64',
            ),
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(
          Math.min(30_000, Math.max(1, deadline - Date.now())),
        ),
      });
      if ([400, 403, 404].includes(response.status)) {
        outcome = 'unsupported';
        return { state: 'unsupported', httpStatus: response.status };
      }
      if (response.status !== 429) {
        if (!response.ok)
          throw new Error(`Quividi export HTTP ${response.status}.`);
        const payload = (await response.json()) as QuividiExportPayload;
        if (payload.state === 'finished') {
          if (!Array.isArray(payload.data))
            throw new Error('Export terminado sin arreglo data.');
          await persist?.(payload);
          outcome = 'finished';
          return payload;
        }
        // A failed export can be transient (timeout); do not label it as unlicensed.
        if (payload.state === 'failed')
          throw new Error('Quividi no pudo preparar la exportación.');
        if (!['started', 'in_progress'].includes(payload.state))
          throw new Error('Estado de exportación Quividi inválido.');
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(8_000, 3_000 + attempt * 300)),
      );
    }
    throw new Error(
      'La exportación Quividi sigue en preparación; se reintentará.',
    );
  } finally {
    try {
      if (audited)
        await audit.update({ status: outcome, polls, completedAt: Date.now() });
    } finally {
      await db.runTransaction(async (transaction) => {
        const [query, state] = await transaction.getAll(queryLock, slot);
        if (query!.get('owner') === owner) transaction.delete(queryLock);
        if (state!.get('owner') === owner) transaction.delete(slot);
      });
    }
  }
}
