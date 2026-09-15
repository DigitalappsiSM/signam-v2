import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import { writeInChunks } from './batchWrite';
import {
  summarizeAdmiraPassUnits,
  type AdmiraPassAnalysis,
  type AdmiraPassAnalysisUnit,
} from '@/modules/low-occupancy/admiraPasses';
import type { Actor } from '@/modules/admira-catalog/screenFactory';

const STATE_COLLECTION = 'admiraPassAnalysisState';
const SNAPSHOT_COLLECTION = 'admiraPassAnalysisSnapshots';
const CURRENT_DOCUMENT = 'current';
const SCHEMA_VERSION = 1;
const DELETE_BATCH_SIZE = 400;

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

export interface AdmiraPassSnapshotMetadata {
  id: string;
  fileName: string;
  sheetName: string;
  validRows: number;
  omittedRows: number;
  playerCount: number;
  dates: string[];
  unitCount: number;
  createdAt: number;
  createdByUid: string;
  createdByEmail: string;
  schemaVersion: number;
}

export interface StoredAdmiraPassAnalysis {
  metadata: AdmiraPassSnapshotMetadata;
  analysis: AdmiraPassAnalysis;
}

export interface SaveAdmiraPassAnalysisInput {
  fileName: string;
  sheetName: string;
  validRows: number;
  omittedRows: number;
  playerCount: number;
  analysis: AdmiraPassAnalysis;
  actor: Actor;
}

async function deleteSnapshot(snapshotId: string): Promise<void> {
  const database = db();
  const snapshotRef = doc(database, SNAPSHOT_COLLECTION, snapshotId);
  const unitDocs = await getDocs(collection(snapshotRef, 'units'));
  for (
    let index = 0;
    index < unitDocs.docs.length;
    index += DELETE_BATCH_SIZE
  ) {
    const batch = writeBatch(database);
    for (const unit of unitDocs.docs.slice(index, index + DELETE_BATCH_SIZE)) {
      batch.delete(unit.ref);
    }
    await batch.commit();
  }
  await deleteDoc(snapshotRef);
}

/**
 * Lee únicamente el diagnóstico vigente. Los snapshots reemplazados no se
 * exponen como historial y se eliminan después de publicar el nuevo resultado.
 */
export async function getCurrentAdmiraPassAnalysis(): Promise<StoredAdmiraPassAnalysis | null> {
  const database = db();
  const state = await getDoc(doc(database, STATE_COLLECTION, CURRENT_DOCUMENT));
  const snapshotId = state.exists() ? state.data().snapshotId : null;
  if (typeof snapshotId !== 'string' || !snapshotId) return null;

  const snapshotRef = doc(database, SNAPSHOT_COLLECTION, snapshotId);
  const snapshot = await getDoc(snapshotRef);
  if (!snapshot.exists() || snapshot.data().status !== 'completed') return null;

  const unitSnapshot = await getDocs(
    query(collection(snapshotRef, 'units'), orderBy('position')),
  );
  const units = unitSnapshot.docs
    .map((unit) => unit.data().unit as AdmiraPassAnalysisUnit | undefined)
    .filter((unit): unit is AdmiraPassAnalysisUnit => Boolean(unit));
  const data = snapshot.data();
  const metadata: AdmiraPassSnapshotMetadata = {
    id: snapshot.id,
    fileName: String(data.fileName ?? ''),
    sheetName: String(data.sheetName ?? ''),
    validRows: Number(data.validRows ?? 0),
    omittedRows: Number(data.omittedRows ?? 0),
    playerCount: Number(data.playerCount ?? 0),
    dates: Array.isArray(data.dates) ? data.dates.map(String) : [],
    unitCount: Number(data.unitCount ?? units.length),
    createdAt: Number(data.createdAt ?? 0),
    createdByUid: String(data.createdByUid ?? ''),
    createdByEmail: String(data.createdByEmail ?? ''),
    schemaVersion: Number(data.schemaVersion ?? SCHEMA_VERSION),
  };

  return {
    metadata,
    analysis: {
      units,
      dates: metadata.dates,
      summary: summarizeAdmiraPassUnits(units),
    },
  };
}

/**
 * Publica el análisis de forma segura: escribe el snapshot completo, cambia el
 * puntero vigente y solo entonces elimina el snapshot anterior. El Excel crudo
 * no se conserva y no existe una consulta de históricos.
 */
export async function saveCurrentAdmiraPassAnalysis(
  input: SaveAdmiraPassAnalysisInput,
): Promise<StoredAdmiraPassAnalysis> {
  const database = db();
  const stateRef = doc(database, STATE_COLLECTION, CURRENT_DOCUMENT);
  const previousState = await getDoc(stateRef);
  const previousSnapshotId = previousState.exists()
    ? previousState.data().snapshotId
    : null;
  const snapshotRef = doc(collection(database, SNAPSHOT_COLLECTION));
  const now = Date.now();
  const metadata: Omit<AdmiraPassSnapshotMetadata, 'id'> = {
    fileName: input.fileName,
    sheetName: input.sheetName,
    validRows: input.validRows,
    omittedRows: input.omittedRows,
    playerCount: input.playerCount,
    dates: [...input.analysis.dates],
    unitCount: input.analysis.units.length,
    createdAt: now,
    createdByUid: input.actor.uid,
    createdByEmail: input.actor.email,
    schemaVersion: SCHEMA_VERSION,
  };

  await setDoc(snapshotRef, { ...metadata, status: 'processing' });
  try {
    await writeInChunks(
      database,
      input.analysis.units.map((unit, position) => ({ unit, position })),
      () => doc(collection(snapshotRef, 'units')),
      (item) => item,
    );
    await updateDoc(snapshotRef, { status: 'completed' });
    await setDoc(stateRef, {
      snapshotId: snapshotRef.id,
      updatedAt: now,
      updatedByUid: input.actor.uid,
      updatedByEmail: input.actor.email,
    });
  } catch (error) {
    await deleteSnapshot(snapshotRef.id).catch(async () => {
      await updateDoc(snapshotRef, { status: 'failed' }).catch(() => undefined);
    });
    throw error;
  }

  if (
    typeof previousSnapshotId === 'string' &&
    previousSnapshotId &&
    previousSnapshotId !== snapshotRef.id
  ) {
    await deleteSnapshot(previousSnapshotId).catch(() => undefined);
  }

  return {
    metadata: { id: snapshotRef.id, ...metadata },
    analysis: input.analysis,
  };
}
