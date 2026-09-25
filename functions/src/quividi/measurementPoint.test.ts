import { describe, expect, it } from 'vitest';
import { buildMeasurementPointId } from './measurementPoint';

describe('buildMeasurementPointId', () => {
  it('normaliza tienda y soporte', () => {
    expect(buildMeasurementPointId('007', 'video wall crius', 'P1')).toBe(
      'LIV-007-CRIUS-P1',
    );
  });

  it('mantiene punto vacío como legacy sin identidad estable', () => {
    expect(buildMeasurementPointId('7', 'VIDEO WALL CRIUS', '')).toBeNull();
  });

  it('rechaza nomenclatura inválida', () => {
    expect(() => buildMeasurementPointId('7', 'VIDEO WALL CRIUS', 'p1')).toThrow(
      /Punto SIGNAM inválido/,
    );
  });
});
