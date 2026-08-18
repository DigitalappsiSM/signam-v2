import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
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
    await uploadBytes(ref(fb.storage, storagePath), input.file, {
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      customMetadata: { contentHash: input.contentHash, batchId },
    });
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
    await updateDoc(refDoc, {
      status: 'failed',
      updatedAt: Date.now(),
      failureMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
