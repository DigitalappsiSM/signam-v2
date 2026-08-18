import type {
  Actor,
  DigitalCheckKey,
  DigitalOperationalTracking,
} from './models';
export class DigitalTrackingError extends Error {}
export const DIGITAL_CHECK_KEYS: DigitalCheckKey[] = [
  'downloadLink',
  'retailerValidation',
  'cmsProgramming',
];
export function createDigitalTracking(
  id: string,
  actor: Actor,
  now = Date.now(),
): DigitalOperationalTracking {
  const check = {
    completed: false,
    source: 'manual' as const,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
  return {
    id,
    operationalItemId: id,
    lifecycleStatus: 'active',
    cancellationReason: null,
    checks: {
      downloadLink: { ...check },
      retailerValidation: { ...check },
      cmsProgramming: { ...check },
    },
    comments: [],
    createdAt: now,
    createdByUid: actor.uid,
    createdByEmail: actor.email,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}
function stamp(
  tracking: DigitalOperationalTracking,
  actor: Actor,
  now: number,
) {
  return {
    ...tracking,
    updatedAt: now,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
}
export function updateDigitalCheck(
  tracking: DigitalOperationalTracking,
  key: DigitalCheckKey,
  completed: boolean,
  actor: Actor,
  now = Date.now(),
): DigitalOperationalTracking {
  if (tracking.lifecycleStatus === 'cancelled')
    throw new DigitalTrackingError(
      'No se editan checks de una operación cancelada.',
    );
  return stamp(
    {
      ...tracking,
      checks: {
        ...tracking.checks,
        [key]: {
          completed,
          source: 'manual',
          updatedAt: now,
          updatedByUid: actor.uid,
          updatedByEmail: actor.email,
        },
      },
    },
    actor,
    now,
  );
}
export function cancelDigitalTracking(
  t: DigitalOperationalTracking,
  reason: string,
  actor: Actor,
  now = Date.now(),
) {
  return stamp(
    {
      ...t,
      lifecycleStatus: 'cancelled' as const,
      cancellationReason: reason.trim() || null,
    },
    actor,
    now,
  );
}
export function reactivateDigitalTracking(
  t: DigitalOperationalTracking,
  actor: Actor,
  now = Date.now(),
) {
  return stamp(
    { ...t, lifecycleStatus: 'active' as const, cancellationReason: null },
    actor,
    now,
  );
}
export function addDigitalComment(
  t: DigitalOperationalTracking,
  text: string,
  actor: Actor,
  now = Date.now(),
) {
  if (!text.trim())
    throw new DigitalTrackingError('El comentario no puede estar vacío.');
  return stamp(
    {
      ...t,
      comments: [
        ...t.comments,
        {
          id: `${now}-${actor.uid}`,
          text: text.trim(),
          createdAt: now,
          createdByUid: actor.uid,
          createdByEmail: actor.email,
        },
      ],
    },
    actor,
    now,
  );
}
export function digitalProgress(t: DigitalOperationalTracking): number | null {
  return t.lifecycleStatus === 'cancelled'
    ? null
    : DIGITAL_CHECK_KEYS.filter((k) => t.checks[k].completed).length / 3;
}
