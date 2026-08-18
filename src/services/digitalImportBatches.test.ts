import { FirebaseError } from 'firebase/app';
import { describe, expect, it } from 'vitest';
import {
  digitalStorageErrorMessage,
  sanitizeDigitalFileName,
} from './digitalImportBatches';

describe('digitalImportBatches — errores de Storage', () => {
  it('explica el límite de reintentos sin sugerir continuar sin el original', () => {
    const message = digitalStorageErrorMessage(
      new FirebaseError('storage/retry-limit-exceeded', 'retry'),
    );

    expect(message).toContain('no escribió filas operativas');
    expect(message).toContain('VITE_FIREBASE_STORAGE_BUCKET');
    expect(message).toContain('digital-imports');
  });

  it('distingue permisos, bucket ausente y cuota', () => {
    expect(
      digitalStorageErrorMessage(
        new FirebaseError('storage/unauthorized', 'unauthorized'),
      ),
    ).toContain('admin/operator');
    expect(
      digitalStorageErrorMessage(
        new FirebaseError('storage/bucket-not-found', 'missing'),
      ),
    ).toContain('bucket configurado');
    expect(
      digitalStorageErrorMessage(
        new FirebaseError('storage/quota-exceeded', 'quota'),
      ),
    ).toContain('cuota');
  });

  it('conserva un mensaje no relacionado y sanitiza el nombre', () => {
    expect(digitalStorageErrorMessage(new Error('Firestore falló'))).toBe(
      'Firestore falló',
    );
    expect(sanitizeDigitalFileName('importación general (final).xlsx')).toBe(
      'importaci_n_general_final_.xlsx',
    );
  });
});
