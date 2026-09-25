import { describe, expect, it } from 'vitest';
import {
  buildMeasurementPointId,
  measurementSupportCode,
  normalizedStoreCode,
  validateMeasurementPointCode,
} from './measurementPoint';

describe('measurementPoint', () => {
  it('construye una identidad estable Liverpool con soporte normalizado', () => {
    expect(
      buildMeasurementPointId({
        storeNumber: '199',
        support: 'VIDEO WALL CRIUS',
        pointCode: 'P1',
      }),
    ).toBe('LIV-199-CRIUS-P1');
  });

  it('normaliza determinantes numéricos a tres dígitos', () => {
    expect(normalizedStoreCode('7')).toBe('007');
    expect(normalizedStoreCode('007')).toBe('007');
  });

  it('rechaza puntos con minúsculas, espacios o guiones', () => {
    expect(() => validateMeasurementPointCode('p1')).toThrow();
    expect(() => validateMeasurementPointCode('P 1')).toThrow();
    expect(() => validateMeasurementPointCode('P-1')).toThrow();
  });

  it('acepta códigos alfanuméricos simples', () => {
    expect(validateMeasurementPointCode('1')).toBe('1');
    expect(validateMeasurementPointCode('P2')).toBe('P2');
    expect(validateMeasurementPointCode('PB')).toBe('PB');
  });

  it('no inventa códigos de soporte fuera del catálogo controlado', () => {
    expect(measurementSupportCode('SOPORTE NUEVO')).toBeNull();
  });
});
