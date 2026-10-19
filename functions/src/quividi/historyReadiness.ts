import { getFunctions } from 'firebase-admin/functions';
import { HttpsError } from 'firebase-functions/v2/https';
import { groupRecoveryTasks, historyRecoveryTask } from './ingestionPlan';
import { HISTORY_START_DATE, rowsFingerprint } from './historyModel';
import {
  loadPersistedHistory,
  type PersistedHistoryLoad,
  type PersistedHistorySpec,
} from './historyReader';

/** Consumers recover only missing source partitions, through the priority queue. */
export async function requirePersistedHistory(
  locationIds: readonly number[],
  dates: readonly string[],
  specs: readonly PersistedHistorySpec[],
): Promise<PersistedHistoryLoad> {
  const persisted = await loadPersistedHistory(locationIds, dates, specs);
  if (persisted.complete) return persisted;
  const queue = getFunctions().taskQueue('quividi-historyOperationalPartition');
  const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
  const ids = [...new Set(persisted.missingPartitionIds)];
  if (ids.some((id) => historyRecoveryTask(id).date < HISTORY_START_DATE)) {
    throw new HttpsError(
      'failed-precondition',
      'El periodo solicitado es anterior al histórico de audiencia disponible.',
    );
  }
  // Una tarea por serie con todas las ubicaciones y días faltantes: el trabajador la
  // convierte en el mínimo de exports, en vez de uno por ubicación y día.
  await Promise.all(
    groupRecoveryTasks(ids).map(async (task) => {
      try {
        await queue.enqueue(task, {
          id: rowsFingerprint([{ task, bucket }]),
          dispatchDeadlineSeconds: 540,
        });
      } catch (error) {
        if (
          (error as { code?: string }).code !== 'functions/task-already-exists'
        )
          throw error;
      }
    }),
  );
  throw new HttpsError(
    'unavailable',
    'Se está completando la información de audiencia. Reintenta en unos minutos.',
    { missingPartitions: ids.length },
  );
}
