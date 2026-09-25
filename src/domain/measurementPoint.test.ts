import { describe, expect, it } from 'vitest';
import {
  buildMeasurementPointId,
  measurementPointCodeError,
} from './measurementPoint';

describe('measurementPoint', () => {
  it('construye una identidad estable con tienda normalizada', () => {
    expect(buildMeasurementPointId('7', 'VIDEO WALL CRIUS', 'P1')).toBe(
      'LIV-007-CRIUS-P1',
    );
    expect(buildMeasurementPointId('199', 'MEGA MUPI DIGITAL', '2')).toBe(
      'LIV-199-MUPI-2',
    );
  });

  it('acepta punto vacío para registros legacy', () => {
    expect(buildMeasurementPointId('7', 'VIDEO WALL CRIUS', '')).toBeNull();
  });

  it('bloquea códigos fuera de nomenclatura', () => {
    expect(measurementPointCodeError('p1')).not.toBeNull();
    expect(measurementPointCodeError('P 1')).not.toBeNull();
    expect(measurementPointCodeError('P-1')).not.toBeNull();
    expect(() =>
      buildMeasurementPointId('7', 'VIDEO WALL CRIUS', 'p1'),
    ).toThrow(/Punto SIGNAM inválido/);
  });

  it('no inventa códigos para soportes desconocidos', () => {
    expect(() => buildMeasurementPointId('7', 'NUEVO SOPORTE', '1')).toThrow(
      /no tiene una nomenclatura/,
    );
  });
});
