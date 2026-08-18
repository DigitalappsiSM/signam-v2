import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ref,
  uploadBytesResumable,
  type UploadTaskSnapshot,
} from 'firebase/storage';
import { FirebaseError } from 'firebase/app';
import { getFirebase } from './firebase';
import {
  aggregateOperationalItems,
  diffPlacementRows,
  DIGITAL_SCHEMA_VERSION,
  DIGITAL_SOURCE_SCHEMA,
  type Actor,
  type DigitalImportBatch,
  type DigitalImportResolution,
  type DigitalPlacementRow,
  type DigitalSupportProfile,
} from '@/domain/digital-operations';
import {
  listDigitalPlacementRows,
  saveDigitalPlacementRows,
} from './digitalPlacementRows';
import { saveDigitalOperationalItems } from './digitalOperationalItems';
import { ensureDigitalTracking } from './digitalOperationalTracking';
import { saveDigitalResolutions } from './digitalImportResolutions';
import { saveDigitalRevisions } from './digitalRevisions';
function firebase() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb;
}
const NAME = 'digitalImportBatches';
export function sanitizeDigitalFileName(name: string) {
  return (
    name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'importacion.xlsx'
  );
}

/**
 * Storage reintenta silenciosamente los errores transitorios durante varios
 * minutos. En la pantalla eso parecía una importación colgada y terminaba con
 * el opaco `storage/retry-limit-exceeded`. Vigilamos la falta de progreso y convertimos
 * los códigos de Storage en mensajes operables, sin continuar la importación:
 * el original sigue siendo obligatorio y no se escribe ninguna fila digital si
 * no quedó preservado primero.
 */
const DIGITAL_UPLOAD_INACTIVITY_MS = 45_000;

export function digitalStorageErrorMessage(error: unknown): string {
  const code = error instanceof FirebaseError ? error.code : '';
  if (code === 'storage/retry-limit-exceeded')
    return (
      'No se pudo guardar el archivo original porque Firebase Storage no ' +
      'respondió dentro del tiempo de reintento. La importación no escribió ' +
      'filas operativas. Verifica que Storage esté habilitado para el proyecto, ' +
      'que VITE_FIREBASE_STORAGE_BUCKET apunte al bucket correcto y que las ' +
      'reglas digital-imports estén publicadas; después vuelve a intentarlo.'
    );
  if (code === 'storage/unauthorized')
    return (
      'Firebase Storage rechazó la carga. La importación no escribió filas ' +
      'operativas. Verifica que tu sesión tenga rol admin/operator y que las ' +
      'reglas de Storage con la ruta digital-imports estén publicadas.'
    );
  if (code === 'storage/bucket-not-found')
    return (
      'No existe el bucket configurado para Firebase Storage. Revisa ' +
      'VITE_FIREBASE_STORAGE_BUCKET y habilita Storage antes de reintentar.'
    );
  if (code === 'storage/quota-exceeded')
    return 'Firebase Storage no tiene cuota disponible; la importación fue detenida sin escribir filas operativas.';
  return error instanceof Error
    ? error.message
    : 'No se pudo guardar el archivo original en Firebase Storage.';
}

function uploadOriginalFile(
  storage: ReturnType<typeof firebase>['storage'],
  storagePath: string,
  file: File,
  contentHash: string,
  batchId: string,
): Promise<UploadTaskSnapshot> {
  const task = uploadBytesResumable(ref(storage, storagePath), file, {
    contentType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    customMetadata: { contentHash, batchId },
  });
  return new Promise((resolve, reject) => {
    let inactivityTimer: ReturnType<typeof setTimeout>;
    const armInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        task.cancel();
        reject(
          new FirebaseError(
            'storage/retry-limit-exceeded',
            'La carga no presentó progreso durante 45 segundos.',
          ),
        );
      }, DIGITAL_UPLOAD_INACTIVITY_MS);
    };
    armInactivityTimer();
    task.on(
      'state_changed',
      armInactivityTimer,
      (error) => {
        clearTimeout(inactivityTimer);
        reject(error);
      },
      () => {
        clearTimeout(inactivityTimer);
        resolve(task.snapshot);
      },
    );
  });
}
export async function findCompletedDigitalBatch(
  contentHash: string,
  periodIds: readonly string[],
  resolutionHash: string,
) {
  const s = await getDocs(
    query(
      collection(firebase().db, NAME),
      where('contentHash', '==', contentHash),
    ),
  );
  const scope = [...periodIds].sort().join(',');
  return (
    s.docs
      .map((d) => ({ id: d.id, ...d.data() }) as DigitalImportBatch)
      .find(
        (b) =>
          b.status === 'completed' &&
          [...b.confirmedPeriodIds].sort().join(',') === scope &&
          b.resolutionHash === resolutionHash,
      ) ?? null
  );
}
export interface CompleteDigitalImportInput {
  file: File;
  contentHash: string;
  resolutionHash: string;
  rows: readonly DigitalPlacementRow[];
  profiles: readonly DigitalSupportProfile[];
  periods: DigitalImportBatch['detectedPeriods'];
  confirmedPeriodIds: readonly string[];
  resolutions: readonly DigitalImportResolution[];
  sourceRows: number;
  ignored: number;
  rejected: number;
  actor: Actor;
}
export async function completeDigitalImport(input: CompleteDigitalImportInput) {
  const prior = await findCompletedDigitalBatch(
    input.contentHash,
    input.confirmedPeriodIds,
    input.resolutionHash,
  );
  if (prior) return { batch: prior, idempotent: true };
  const fb = firebase(),
    refDoc = doc(collection(fb.db, NAME)),
    batchId = refDoc.id,
    now = Date.now(),
    storagePath = `digital-imports/${batchId}/${sanitizeDigitalFileName(input.file.name)}`;
  const base: Omit<DigitalImportBatch, 'id'> = {
    sourceSchema: DIGITAL_SOURCE_SCHEMA,
    fileName: input.file.name,
    fileSize: input.file.size,
    storagePath,
    contentHash: input.contentHash,
    resolutionHash: input.resolutionHash,
    status: 'processing',
    detectedPeriods: input.periods,
    confirmedPeriodIds: [...input.confirmedPeriodIds],
    catalogProfileIds: [...new Set(input.rows.map((r) => r.profileId))],
    totals: {
      sourceRows: input.sourceRows,
      inScopeRows: input.rows.length,
      ignoredByCatalog: input.ignored,
      validRows: input.rows.length,
      rejectedRows: input.rejected,
      exactDuplicateGroups: input.resolutions.filter(
        (r) => r.kind === 'exact-duplicate',
      ).length,
      logicalConflictGroups: input.resolutions.filter(
        (r) => r.kind === 'logical-conflict',
      ).length,
      operationalItems: 0,
    },
    createdAt: now,
    createdByUid: input.actor.uid,
    createdByEmail: input.actor.email,
    updatedAt: now,
    completedAt: null,
    schemaVersion: DIGITAL_SCHEMA_VERSION,
  };
  await setDoc(refDoc, base);
  try {
    await uploadOriginalFile(
      fb.storage,
      storagePath,
      input.file,
      input.contentHash,
      batchId,
    );
    const previous = await listDigitalPlacementRows();
    const scoped = input.rows.map((r) => ({
      ...r,
      batchId,
      firstBatchId: batchId,
      lastBatchId: batchId,
    }));
    const diff = diffPlacementRows(
      previous,
      scoped,
      new Set(input.confirmedPeriodIds),
      batchId,
    );
    await saveDigitalPlacementRows(diff.map((e) => e.after));
    await saveDigitalRevisions(diff, batchId, input.actor);
    const items = aggregateOperationalItems(
      diff
        .filter(
          (e) =>
            e.after.active &&
            input.confirmedPeriodIds.includes(e.after.periodId),
        )
        .map((e) => e.after),
      input.profiles,
      batchId,
    );
    await saveDigitalOperationalItems(items);
    await ensureDigitalTracking(
      items.map((i) => i.id),
      input.actor,
    );
    await saveDigitalResolutions(
      input.resolutions.map((r) => ({ ...r, batchId })),
    );
    const totals = { ...base.totals, operationalItems: items.length };
    await updateDoc(refDoc, {
      status: 'completed',
      completedAt: Date.now(),
      updatedAt: Date.now(),
      totals,
    });
    return {
      batch: {
        id: batchId,
        ...base,
        status: 'completed' as const,
        completedAt: Date.now(),
        totals,
      },
      idempotent: false,
    };
  } catch (error) {
    const failureMessage = digitalStorageErrorMessage(error);
    await updateDoc(refDoc, {
      status: 'failed',
      updatedAt: Date.now(),
      failureMessage,
    });
    const wrapped = new Error(failureMessage) as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
}
