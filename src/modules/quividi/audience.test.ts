import { describe, expect, it } from 'vitest';
import {
  aggregateSupportDay,
  buildMeasurementIncidents,
  measurementCoverage,
  type QuividiSupportMapping,
} from './audience';

const mapping: QuividiSupportMapping = {
  key: 'liverpool|7|mega-mupi-digital',
  retailer: 'Liverpool',
  storeNumber: '7',
  storeName: 'Santa Fe',
  support: 'MEGA MUPI DIGITAL',
  cameras: [
    { locationId: 1, name: 'Izquierda' },
    { locationId: 2, name: 'Derecha' },
  ],
};

describe('Quividi audience weighting', () => {
  it('promedia cámaras válidas del mismo soporte en el mismo día', () => {
    const day = aggregateSupportDay(mapping, '2026-09-01', [
      {
        date: '2026-09-01',
        locationId: 1,
        cameraName: 'Izquierda',
        ots: 100,
        effectiveOts: 80,
        watchers: 20,
        attentionSeconds: 4,
        dwellSeconds: 9,
        durationSeconds: 86400,
      },
      {
        date: '2026-09-01',
        locationId: 2,
        cameraName: 'Derecha',
        ots: 90,
        effectiveOts: 70,
        watchers: 10,
        attentionSeconds: 2,
        dwellSeconds: 6,
        durationSeconds: 86400,
      },
    ]);
    expect(day.status).toBe('complete');
    expect(day.ots).toBe(95);
    expect(day.watchers).toBe(15);
    expect(day.attentionSeconds).toBeCloseTo(10 / 3);
  });

  it('usa la cámara disponible y marca parcial cuando la otra cae', () => {
    const day = aggregateSupportDay(mapping, '2026-09-02', [
      {
        date: '2026-09-02',
        locationId: 1,
        cameraName: 'Izquierda',
        ots: 105,
        effectiveOts: 82,
        watchers: 21,
        attentionSeconds: 4,
        dwellSeconds: 8,
        durationSeconds: 86300,
      },
    ]);
    expect(day.status).toBe('partial');
    expect(day.ots).toBe(105);
    expect(day.missingCameraNames).toEqual(['Derecha']);
  });

  it('no convierte una caída total en cero audiencia', () => {
    const day = aggregateSupportDay(mapping, '2026-09-03', []);
    expect(day.status).toBe('missing');
    expect(day.ots).toBeNull();
    expect(day.watchers).toBeNull();
  });

  it('agrupa días consecutivos de caída y calcula cobertura', () => {
    const days = [
      aggregateSupportDay(mapping, '2026-09-01', [
        {
          date: '2026-09-01',
          locationId: 1,
          cameraName: 'Izquierda',
          ots: 100,
          effectiveOts: 80,
          watchers: 20,
          attentionSeconds: 4,
          dwellSeconds: 8,
          durationSeconds: 86400,
        },
        {
          date: '2026-09-01',
          locationId: 2,
          cameraName: 'Derecha',
          ots: 90,
          effectiveOts: 70,
          watchers: 10,
          attentionSeconds: 3,
          dwellSeconds: 7,
          durationSeconds: 86400,
        },
      ]),
      aggregateSupportDay(mapping, '2026-09-02', [
        {
          date: '2026-09-02',
          locationId: 1,
          cameraName: 'Izquierda',
          ots: 110,
          effectiveOts: 85,
          watchers: 22,
          attentionSeconds: 4,
          dwellSeconds: 8,
          durationSeconds: 86400,
        },
      ]),
      aggregateSupportDay(mapping, '2026-09-03', [
        {
          date: '2026-09-03',
          locationId: 1,
          cameraName: 'Izquierda',
          ots: 115,
          effectiveOts: 87,
          watchers: 23,
          attentionSeconds: 4,
          dwellSeconds: 8,
          durationSeconds: 86400,
        },
      ]),
      aggregateSupportDay(mapping, '2026-09-04', []),
    ];

    expect(buildMeasurementIncidents(mapping, days)).toContainEqual({
      supportKey: mapping.key,
      cameraName: 'Derecha',
      startDate: '2026-09-02',
      endDate: '2026-09-04',
      days: 3,
    });
    expect(measurementCoverage(days)).toBe(0.75);
  });
});
