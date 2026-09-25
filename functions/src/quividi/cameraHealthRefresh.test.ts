import { describe, expect, it } from 'vitest';
import {
  CAMERA_HEALTH_REFRESH_COOLDOWN_MS,
  cameraHealthRefreshBlockReason,
  normalizeCameraHealthRefreshState,
} from './cameraHealthRefresh';

describe('cameraHealthRefresh', () => {
  it('normaliza un documento vacío a estado idle seguro', () => {
    expect(normalizeCameraHealthRefreshState(undefined)).toMatchObject({
      status: 'idle',
      stage: null,
      trigger: null,
      runId: null,
      lastError: null,
    });
  });

  it('bloquea cualquier segundo proceso mientras el lock está vigente', () => {
    const now = 1_000;
    const state = normalizeCameraHealthRefreshState({
      status: 'running',
      stage: 'analyzing',
      trigger: 'manual',
      runId: 'manual_1_user',
      lockExpiresAt: now + 60_000,
    });

    expect(cameraHealthRefreshBlockReason(state, 'manual', now)).toEqual({
      reason: 'running',
      retryAt: now + 60_000,
    });
    expect(cameraHealthRefreshBlockReason(state, 'automatic', now)).toEqual({
      reason: 'running',
      retryAt: now + 60_000,
    });
  });

  it('aplica cooldown de 5 minutos solo al refresco manual', () => {
    const now = 2_000;
    const state = normalizeCameraHealthRefreshState({
      status: 'success',
      stage: 'completed',
      trigger: 'manual',
      cooldownUntil: now + CAMERA_HEALTH_REFRESH_COOLDOWN_MS,
    });

    expect(cameraHealthRefreshBlockReason(state, 'manual', now)).toEqual({
      reason: 'cooldown',
      retryAt: now + CAMERA_HEALTH_REFRESH_COOLDOWN_MS,
    });
    expect(cameraHealthRefreshBlockReason(state, 'automatic', now)).toBeNull();
  });

  it('permite reintentar cuando un lock ya expiró', () => {
    const now = 10_000;
    const state = normalizeCameraHealthRefreshState({
      status: 'running',
      stage: 'syncing_odoo',
      trigger: 'manual',
      runId: 'stale',
      lockExpiresAt: now - 1,
      cooldownUntil: now - 1,
    });

    expect(cameraHealthRefreshBlockReason(state, 'manual', now)).toBeNull();
  });
});
