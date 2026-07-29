import { describe, it, expect } from 'vitest';
import { authErrorMessage } from './auth';

describe('authErrorMessage', () => {
  it('traduce credenciales inválidas a un mensaje único', () => {
    for (const code of [
      'auth/user-not-found',
      'auth/wrong-password',
      'auth/invalid-credential',
    ]) {
      expect(authErrorMessage({ code })).toBe(
        'Correo o contraseña incorrectos.',
      );
    }
  });

  it('traduce correo inválido', () => {
    expect(authErrorMessage({ code: 'auth/invalid-email' })).toBe(
      'El correo electrónico no es válido.',
    );
  });

  it('traduce demasiados intentos', () => {
    expect(authErrorMessage({ code: 'auth/too-many-requests' })).toContain(
      'Demasiados intentos',
    );
  });

  it('da un mensaje genérico para códigos desconocidos o entradas no-objeto', () => {
    expect(authErrorMessage({ code: 'auth/algo-raro' })).toBe(
      'No se pudo iniciar sesión. Inténtalo de nuevo.',
    );
    expect(authErrorMessage('boom')).toBe(
      'No se pudo iniciar sesión. Inténtalo de nuevo.',
    );
    expect(authErrorMessage(null)).toBe(
      'No se pudo iniciar sesión. Inténtalo de nuevo.',
    );
  });
});
