import { describe, it, expect } from 'vitest';
import {
  bumpMetadata,
  emptyOriginal,
  newScreenMetadata,
  sanitizeOriginal,
} from './screenFactory';
import { ADMIRA_CATALOG_HEADERS } from '@/domain';

const actor = { uid: 'u1', email: 'admin@signam.mx' };

describe('emptyOriginal', () => {
  it('incluye exactamente los 12 encabezados oficiales, vacíos', () => {
    const o = emptyOriginal();
    expect(Object.keys(o).sort()).toEqual([...ADMIRA_CATALOG_HEADERS].sort());
    expect(Object.values(o).every((v) => v === '')).toBe(true);
  });
});

describe('sanitizeOriginal', () => {
  it('recorta valores y descarta claves no oficiales', () => {
    const result = sanitizeOriginal({
      Modelo: '  CRIUS  ',
      // @ts-expect-error campo no oficial que debe ignorarse
      Pases: 'algo',
    });
    expect(result.Modelo).toBe('CRIUS');
    expect('Pases' in result).toBe(false);
  });
});

describe('newScreenMetadata', () => {
  it('crea metadatos activos versión 1 con el actor', () => {
    const m = newScreenMetadata(actor, 1000);
    expect(m).toMatchObject({
      active: true,
      version: 1,
      createdBy: 'admin@signam.mx',
      updatedBy: 'admin@signam.mx',
      createdAt: 1000,
      updatedAt: 1000,
      source: 'manual',
      deactivationReason: null,
    });
  });
});

describe('bumpMetadata', () => {
  it('incrementa versión, conserva createdAt y aplica cambios', () => {
    const base = newScreenMetadata(actor, 1000);
    const next = bumpMetadata(
      base,
      { uid: 'u2', email: 'op@signam.mx' },
      2000,
      {
        active: false,
        deactivationReason: 'Fuera de servicio',
      },
    );
    expect(next.version).toBe(2);
    expect(next.createdAt).toBe(1000);
    expect(next.updatedAt).toBe(2000);
    expect(next.updatedBy).toBe('op@signam.mx');
    expect(next.active).toBe(false);
    expect(next.deactivationReason).toBe('Fuera de servicio');
  });
});
