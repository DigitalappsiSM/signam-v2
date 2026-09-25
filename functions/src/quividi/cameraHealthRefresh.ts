import type { Firestore } from 'firebase-admin/firestore';

export const CAMERA_HEALTH_REFRESH_COLLECTION = 'quividiCameraHealthRefresh';
export const CAMERA_HEALTH_REFRESH_DOC = 'control';
export const CAMERA_HEALTH_REFRESH_COOLDOWN_MS = 5 * 60 * 1000;
export const CAMERA_HEALTH_REFRESH_ERROR_COOLDOWN_MS = 60 * 1000;
export const CAMERA_HEALTH_REFRESH_LOCK_MS = 12 * 60 * 1000;

export type CameraHealthRefreshTrigger = 'manual' | 'automatic';

export type CameraHealthRefreshStage =
  | 'connecting'
  | 'syncing_catalog'
  | 'analyzing'
  | 'reconciling_alerts'
  | 'syncing_odoo'
  | 'completed'
  | 'error';

export type CameraHealthRefreshStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error';

export interface CameraHealthRefreshActor {
  uid: string;
  email: string;
}

export interface CameraHealthRefreshStateDoc {
  schemaVersion: 1;
  status: CameraHealthRefreshStatus;
  stage: CameraHealthRefreshStage | null;
  trigger: CameraHealthRefreshTrigger | null;
  runId: string | null;
  startedAt: number | null;
  startedByUid: string | null;
  startedByEmail: string | null;
  completedAt: number | null;
  lockExpiresAt: number | null;
  cooldownUntil: number | null;
  lastManualCompletedAt: number | null;
  lastManualCompletedByEmail: string | null;
  lastAutomaticCompletedAt: number | null;
  lastError: string | null;
}

export interface CameraHealthRefreshAcquireResult {
  acquired: boolean;
  runId: string | null;
  reason: 'running' | 'cooldown' | null;
  retryAt: number | null;
}

function refreshRef(db: Firestore) {
  return db
    .collection(CAMERA_HEALTH_REFRESH_COLLECTION)
    .doc(CAMERA_HEALTH_REFRESH_DOC);
}

export function normalizeCameraHealthRefreshState(
  data: Partial<CameraHealthRefreshStateDoc> | undefined,
): CameraHealthRefreshStateDoc {
  const status =
    data?.status === 'running' ||
    data?.status === 'success' ||
    data?.status === 'error'
      ? data.status
      : 'idle';
  const stage =
    data?.stage === 'connecting' ||
    data?.stage === 'syncing_catalog' ||
    data?.stage === 'analyzing' ||
    data?.stage === 'reconciling_alerts' ||
    data?.stage === 'syncing_odoo' ||
    data?.stage === 'completed' ||
    data?.stage === 'error'
      ? data.stage
      : null;
  const trigger =
    data?.trigger === 'manual' || data?.trigger === 'automatic'
      ? data.trigger
      : null;

  return {
    schemaVersion: 1,
    status,
    stage,
    trigger,
    runId: typeof data?.runId === 'string' ? data.runId : null,
    startedAt: typeof data?.startedAt === 'number' ? data.startedAt : null,
    startedByUid:
      typeof data?.startedByUid === 'string' ? data.startedByUid : null,
    startedByEmail:
      typeof data?.startedByEmail === 'string' ? data.startedByEmail : null,
    completedAt:
      typeof data?.completedAt === 'number' ? data.completedAt : null,
    lockExpiresAt:
      typeof data?.lockExpiresAt === 'number' ? data.lockExpiresAt : null,
    cooldownUntil:
      typeof data?.cooldownUntil === 'number' ? data.cooldownUntil : null,
    lastManualCompletedAt:
      typeof data?.lastManualCompletedAt === 'number'
        ? data.lastManualCompletedAt
        : null,
    lastManualCompletedByEmail:
      typeof data?.lastManualCompletedByEmail === 'string'
        ? data.lastManualCompletedByEmail
        : null,
    lastAutomaticCompletedAt:
      typeof data?.lastAutomaticCompletedAt === 'number'
        ? data.lastAutomaticCompletedAt
        : null,
    lastError: typeof data?.lastError === 'string' ? data.lastError : null,
  };
}

export async function getCameraHealthRefreshState(
  db: Firestore,
): Promise<CameraHealthRefreshStateDoc> {
  const snap = await refreshRef(db).get();
  return normalizeCameraHealthRefreshState(
    snap.data() as Partial<CameraHealthRefreshStateDoc> | undefined,
  );
}

export function cameraHealthRefreshBlockReason(
  state: CameraHealthRefreshStateDoc,
  trigger: CameraHealthRefreshTrigger,
  now: number,
): Pick<CameraHealthRefreshAcquireResult, 'reason' | 'retryAt'> | null {
  if (state.status === 'running' && (state.lockExpiresAt ?? 0) > now) {
    return { reason: 'running', retryAt: state.lockExpiresAt };
  }
  if (trigger === 'manual' && (state.cooldownUntil ?? 0) > now) {
    return { reason: 'cooldown', retryAt: state.cooldownUntil };
  }
  return null;
}

export async function acquireCameraHealthRefresh(
  db: Firestore,
  trigger: CameraHealthRefreshTrigger,
  actor: CameraHealthRefreshActor,
  now: number,
): Promise<CameraHealthRefreshAcquireResult> {
  const ref = refreshRef(db);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const previous = normalizeCameraHealthRefreshState(
      snap.data() as Partial<CameraHealthRefreshStateDoc> | undefined,
    );

    const blocked = cameraHealthRefreshBlockReason(previous, trigger, now);
    if (blocked) {
      return {
        acquired: false,
        runId: blocked.reason === 'running' ? previous.runId : null,
        reason: blocked.reason,
        retryAt: blocked.retryAt,
      };
    }

    const runId = trigger + '_' + now + '_' + actor.uid;
    transaction.set(
      ref,
      {
        schemaVersion: 1,
        status: 'running',
        stage: 'connecting',
        trigger,
        runId,
        startedAt: now,
        startedByUid: actor.uid,
        startedByEmail: actor.email,
        completedAt: null,
        lockExpiresAt: now + CAMERA_HEALTH_REFRESH_LOCK_MS,
        lastError: null,
      },
      { merge: true },
    );

    return {
      acquired: true,
      runId,
      reason: null,
      retryAt: null,
    };
  });
}

export async function updateCameraHealthRefreshStage(
  db: Firestore,
  runId: string,
  stage: Exclude<CameraHealthRefreshStage, 'completed' | 'error'>,
): Promise<void> {
  const ref = refreshRef(db);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = normalizeCameraHealthRefreshState(
      snap.data() as Partial<CameraHealthRefreshStateDoc> | undefined,
    );
    if (current.runId !== runId || current.status !== 'running') return;
    transaction.set(ref, { stage }, { merge: true });
  });
}

export async function completeCameraHealthRefresh(
  db: Firestore,
  runId: string,
  trigger: CameraHealthRefreshTrigger,
  actor: CameraHealthRefreshActor,
  finishedAt: number,
): Promise<void> {
  const ref = refreshRef(db);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = normalizeCameraHealthRefreshState(
      snap.data() as Partial<CameraHealthRefreshStateDoc> | undefined,
    );
    if (current.runId !== runId) return;

    transaction.set(
      ref,
      {
        status: 'success',
        stage: 'completed',
        completedAt: finishedAt,
        lockExpiresAt: null,
        cooldownUntil: finishedAt + CAMERA_HEALTH_REFRESH_COOLDOWN_MS,
        lastError: null,
        ...(trigger === 'manual'
          ? {
              lastManualCompletedAt: finishedAt,
              lastManualCompletedByEmail: actor.email,
            }
          : { lastAutomaticCompletedAt: finishedAt }),
      },
      { merge: true },
    );
  });
}

export async function failCameraHealthRefresh(
  db: Firestore,
  runId: string,
  finishedAt: number,
  error: string,
): Promise<void> {
  const ref = refreshRef(db);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = normalizeCameraHealthRefreshState(
      snap.data() as Partial<CameraHealthRefreshStateDoc> | undefined,
    );
    if (current.runId !== runId) return;

    transaction.set(
      ref,
      {
        status: 'error',
        stage: 'error',
        completedAt: finishedAt,
        lockExpiresAt: null,
        cooldownUntil:
          finishedAt + CAMERA_HEALTH_REFRESH_ERROR_COOLDOWN_MS,
        lastError: error,
      },
      { merge: true },
    );
  });
}
