import { describe, expect, it } from 'vitest';
import {
  buildCurrentCameraHealthEvaluations,
  cameraHealthAlertId,
  classifyCameraHealth,
  daysInclusive,
  previousCivilDate,
} from './cameraAlerts';
import type { CameraHealthRecord } from './cameraHealth';

function healthRecord(
  date: string,
  over: Partial<CameraHealthRecord> = {},
): CameraHealthRecord {
  return {
    schemaVersion: 1,
    source: 'quividi',
    date,
    locationId: 101,
    locationName: 'SATELITE CAM 01',
    storeNumber: '25',
    storeName: 'LIVERPOOL SATELITE',
    support: 'MEGA MUPI DIGITAL',
    boxId: 1,
    siteId: 1,
    topologyActive: true,
    lastSeen: null,
    durationSeconds: 39600,
    ots: 1000,
    effectiveOts: 500,
    watchers: 200,
    attentionSeconds: 2,
    dwellSeconds: 4,
    measurementStatus: 'complete',
    hasMeasurement: true,
    hasOts: true,
    operationalWindowStartHour: 10,
    operationalGraceUntilHour: 11,
    operationalWindowEndHour: 22,
    expectedOperationalHours: 12,
    expectedCoreHours: 11,
    operationalMeasuredHours: 11,
    operationalOtsHours: 11,
    coreMeasuredHours: 11,
    coreOtsHours: 11,
    firstMeasuredHour: 11,
    lastMeasuredHour: 21,
    firstOtsHour: 11,
    lastOtsHour: 21,
    operationalOts: 1000,
    coreOts: 1000,
    computedAt: 1,
    ...over,
  };
}

describe('classifyCameraHealth', () => {
  it('tolera que la cámara arranque a las 11 si cubre la ventana núcleo', () => {
    expect(classifyCameraHealth(healthRecord('2026-09-18'))).toBe('normal');
  });

  it('clasifica ausencia total de medición en 11–22', () => {
    expect(
      classifyCameraHealth(
        healthRecord('2026-09-18', {
          coreMeasuredHours: 0,
          coreOtsHours: 0,
          coreOts: 0,
        }),
      ),
    ).toBe('no_measurement');
  });

  it('clasifica como parcial una cobertura inferior al 80%', () => {
    expect(
      classifyCameraHealth(
        healthRecord('2026-09-18', {
          coreMeasuredHours: 8,
          coreOtsHours: 8,
          coreOts: 600,
        }),
      ),
    ).toBe('partial_measurement');
  });

  it('considera suficiente 9 de 11 horas y separa OTS=0 de pérdida de medición', () => {
    expect(
      classifyCameraHealth(
        healthRecord('2026-09-18', {
          coreMeasuredHours: 9,
          coreOtsHours: 0,
          coreOts: 0,
        }),
      ),
    ).toBe('no_ots');
  });
});

describe('buildCurrentCameraHealthEvaluations', () => {
  it('no genera una anomalía actual por una caída histórica ya recuperada', () => {
    const records = [
      healthRecord('2026-09-12', {
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-13', {
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-14'),
      healthRecord('2026-09-15'),
      healthRecord('2026-09-16'),
      healthRecord('2026-09-17'),
      healthRecord('2026-09-18'),
    ];

    const evaluation = buildCurrentCameraHealthEvaluations(
      records,
      '2026-09-18',
    )[0]!;

    expect(evaluation.currentStatus).toBe('normal');
    expect(evaluation.incidentStartDate).toBeNull();
    expect(evaluation.consecutiveDays).toBe(0);
  });

  it('usa el histórico solo para calcular desde cuándo continúa una anomalía vigente', () => {
    const records = [
      healthRecord('2026-09-12'),
      healthRecord('2026-09-13', {
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-14', {
        coreMeasuredHours: 3,
        coreOtsHours: 3,
        coreOts: 200,
      }),
      healthRecord('2026-09-15', {
        coreMeasuredHours: 8,
        coreOtsHours: 8,
        coreOts: 500,
      }),
      healthRecord('2026-09-16', {
        coreMeasuredHours: 9,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-17', {
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-18', {
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
      }),
    ];

    const evaluation = buildCurrentCameraHealthEvaluations(
      records,
      '2026-09-18',
    )[0]!;

    expect(evaluation.currentStatus).toBe('no_measurement');
    expect(evaluation.severity).toBe('critical');
    expect(evaluation.incidentStartDate).toBe('2026-09-13');
    expect(evaluation.consecutiveDays).toBe(6);
  });

  it('corta la antigüedad al encontrar el último día normal', () => {
    const records = [
      healthRecord('2026-09-14', {
        coreMeasuredHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-15'),
      healthRecord('2026-09-16', {
        coreMeasuredHours: 9,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-17', {
        coreMeasuredHours: 9,
        coreOtsHours: 0,
        coreOts: 0,
      }),
      healthRecord('2026-09-18', {
        coreMeasuredHours: 9,
        coreOtsHours: 0,
        coreOts: 0,
      }),
    ];

    const evaluation = buildCurrentCameraHealthEvaluations(
      records,
      '2026-09-18',
    )[0]!;

    expect(evaluation.currentStatus).toBe('no_ots');
    expect(evaluation.incidentStartDate).toBe('2026-09-16');
    expect(evaluation.consecutiveDays).toBe(3);
  });

  it('omite cámaras sin registro del último día evaluado', () => {
    const evaluations = buildCurrentCameraHealthEvaluations(
      [healthRecord('2026-09-17')],
      '2026-09-18',
    );
    expect(evaluations).toEqual([]);
  });
});

describe('camera alert helpers', () => {
  it('genera ids estables y fechas civiles', () => {
    expect(cameraHealthAlertId(101, '2026-09-16')).toBe('101__2026-09-16');
    expect(previousCivilDate('2026-09-16')).toBe('2026-09-15');
    expect(daysInclusive('2026-09-13', '2026-09-18')).toBe(6);
  });
});
