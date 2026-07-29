import { describe, it, expect } from 'vitest';
import { resolveAppEnv } from './env';

const fullEnv = {
  VITE_FIREBASE_API_KEY: 'key',
  VITE_FIREBASE_AUTH_DOMAIN: 'signam-v2-dev.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'signam-v2-dev',
  VITE_FIREBASE_STORAGE_BUCKET: 'signam-v2-dev.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123',
  VITE_FIREBASE_APP_ID: '1:123:web:abc',
};

describe('resolveAppEnv', () => {
  it('devuelve config completa cuando todas las claves están presentes', () => {
    const env = resolveAppEnv(fullEnv);
    expect(env.firebase).not.toBeNull();
    expect(env.firebase?.projectId).toBe('signam-v2-dev');
  });

  it('devuelve firebase null si falta alguna clave obligatoria', () => {
    const { VITE_FIREBASE_APP_ID: _omit, ...partial } = fullEnv;
    expect(resolveAppEnv(partial).firebase).toBeNull();
  });

  it('trata valores vacíos como faltantes', () => {
    const env = resolveAppEnv({ ...fullEnv, VITE_FIREBASE_API_KEY: '   ' });
    expect(env.firebase).toBeNull();
  });

  it('activa emuladores solo con el string "true"', () => {
    expect(
      resolveAppEnv({ VITE_USE_FIREBASE_EMULATORS: 'true' }).useEmulators,
    ).toBe(true);
    expect(
      resolveAppEnv({ VITE_USE_FIREBASE_EMULATORS: 'false' }).useEmulators,
    ).toBe(false);
    expect(resolveAppEnv({}).useEmulators).toBe(false);
  });

  it('usa host de emulador por defecto', () => {
    expect(resolveAppEnv({}).emulatorHost).toBe('127.0.0.1');
  });
});
