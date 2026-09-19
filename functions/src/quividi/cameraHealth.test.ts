import { describe, expect, it } from 'vitest';
import type { ScreenDoc } from './effectiveScope';
import {
  buildCameraHealthRecords,
  buildOperationalPairs,
  cameraHealthDocumentId,
  lookbackStartDate,
  prepareCameraHealthScope,
} from './cameraHealth';
import type {
  OtsExportRow,
  TopologyLocation,
  ViewerExportRow,
} from './measurement';

function screen(
  storeNumber: string,
  storeName: string,
  support: string,
  cameraName: string,
  active = true,
): ScreenDoc {
  return {
    original: {
      'Numero de Tienda': storeNumber,
      'Nombre de tienda': storeName,
    },
    metadata: {
      active,
      calendarSupport: support,
      quividiCameraName: cameraName,
    },
  };
}

function topology(id: number, name: string): TopologyLocation {
  return {
    id,
    name,
    active: true,
    box_id: id * 10,
    site_id: 1,
    last_seen: '2026-09-18T21:00:00',
  };
}

function ots(
  locationId: number,
  date: string,
  duration: number,
  otsCount: number,
): OtsExportRow {
  return {
    location_id: locationId,
    period_start: `${date}T00:00:00`,
    duration,
    ots_count: otsCount,
    effective_ots_count: otsCount / 2,
  };
}

function hourlyOts(
  locationId: number,
  date: string,
  hour: number,
  duration: number,
  otsCount: number,
): OtsExportRow {
  return {
    location_id: locationId,
    period_start: `${date}T${String(hour).padStart(2, '0')}:00:00`,
    duration,
    ots_count: otsCount,
    effective_ots_count: otsCount / 2,
  };
}

function viewer(
  locationId: number,
  date: string,
  watchers: number,
): ViewerExportRow {
  return {
    location_id: locationId,
    period_start: `${date}T00:00:00`,
    watcher_count: watchers,
    attention_time_in_tenths_of_sec: watchers * 10,
    dwell_time_in_tenths_of_sec: watchers * 20,
  };
}

describe('buildOperationalPairs', () => {
  it('agrupa cámaras activas por tienda + soporte y omite incompletas/inactivas', () => {
    const result = buildOperationalPairs([
      screen('007', 'Santa Fe', 'Banner Digital', 'CAM-A'),
      screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-B'),
      screen('8', 'Perisur', 'BANNER DIGITAL', '', true),
      screen('9', 'Polanco', 'BANNER DIGITAL', 'CAM-Z', false),
    ]);

    expect(result.unconfiguredScreens).toBe(1);
    expect(result.duplicateCameraNames).toEqual([]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({
      storeNumber: '7',
      support: 'BANNER DIGITAL',
      cameraNames: ['CAM-A', 'CAM-B'],
    });
  });

  it('excluye un nombre de cámara asignado a más de una tienda', () => {
    const result = buildOperationalPairs([
      screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-X'),
      screen('8', 'Perisur', 'BANNER DIGITAL', 'CAM-X'),
      screen('8', 'Perisur', 'BANNER DIGITAL', 'CAM-Y'),
    ]);

    expect(result.duplicateCameraNames).toEqual(['CAM-X']);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]?.cameraNames).toEqual(['CAM-Y']);
  });
});

describe('prepareCameraHealthScope', () => {
  it('resuelve únicamente cámaras con correspondencia única en VidiCenter', () => {
    const scope = prepareCameraHealthScope(
      [
        screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-A'),
        screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-B'),
      ],
      [topology(1, 'CAM-A')],
    );

    expect(scope.mappedLocationIds).toEqual([1]);
    expect(scope.mapping).toMatchObject({
      activeConfiguredPairs: 1,
      configuredCameraNames: 2,
      mappedCameras: 1,
      unmappedCameraNames: ['CAM-B'],
    });
  });
});

describe('buildCameraHealthRecords', () => {
  it('persiste señales crudas y conserva por separado estado de medición y OTS', () => {
    const scope = prepareCameraHealthScope(
      [screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-A')],
      [topology(1, 'CAM-A')],
    );
    const dates = ['2026-09-16', '2026-09-17', '2026-09-18'];
    const otsRows = [
      ots(1, dates[0]!, 100, 1000),
      ots(1, dates[1]!, 50, 500),
      ots(1, dates[2]!, 100, 0),
    ];
    const viewerRows = [
      viewer(1, dates[0]!, 20),
      viewer(1, dates[1]!, 10),
      viewer(1, dates[2]!, 5),
    ];

    const records = buildCameraHealthRecords(
      scope,
      dates,
      otsRows,
      viewerRows,
      [],
      1234,
    );

    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      date: '2026-09-16',
      measurementStatus: 'complete',
      hasMeasurement: true,
      hasOts: true,
      attentionSeconds: 1,
      dwellSeconds: 2,
      computedAt: 1234,
    });
    expect(records[1]).toMatchObject({
      date: '2026-09-17',
      measurementStatus: 'partial',
      hasMeasurement: true,
      hasOts: true,
    });
    expect(records[2]).toMatchObject({
      date: '2026-09-18',
      measurementStatus: 'complete',
      hasMeasurement: true,
      hasOts: false,
      ots: 0,
    });
  });

  it('genera missing cuando no existe export para el día', () => {
    const scope = prepareCameraHealthScope(
      [screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-A')],
      [topology(1, 'CAM-A')],
    );

    const records = buildCameraHealthRecords(
      scope,
      ['2026-09-17', '2026-09-18'],
      [ots(1, '2026-09-17', 100, 100)],
      [],
      [],
      1,
    );

    expect(records[1]).toMatchObject({
      date: '2026-09-18',
      measurementStatus: 'missing',
      hasMeasurement: false,
      hasOts: false,
      operationalMeasuredHours: 0,
      coreMeasuredHours: 0,
    });
  });

  it('tolera arranque a las 11 y conserva completa la ventana núcleo 11–22', () => {
    const date = '2026-09-18';
    const scope = prepareCameraHealthScope(
      [screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-A')],
      [topology(1, 'CAM-A')],
    );
    const hourlyRows = Array.from({ length: 11 }, (_, index) =>
      hourlyOts(1, date, 11 + index, 3600, 100),
    );

    const records = buildCameraHealthRecords(
      scope,
      [date],
      [ots(1, date, 39600, 1100)],
      [viewer(1, date, 50)],
      hourlyRows,
      1,
    );

    expect(records[0]).toMatchObject({
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
      operationalOts: 1100,
      coreOts: 1100,
    });
  });

  it('ignora datos horarios fuera de 10–22 para la salud operativa', () => {
    const date = '2026-09-18';
    const scope = prepareCameraHealthScope(
      [screen('7', 'Santa Fe', 'BANNER DIGITAL', 'CAM-A')],
      [topology(1, 'CAM-A')],
    );

    const records = buildCameraHealthRecords(
      scope,
      [date],
      [ots(1, date, 3600, 100)],
      [],
      [
        hourlyOts(1, date, 8, 3600, 50),
        hourlyOts(1, date, 10, 3600, 25),
        hourlyOts(1, date, 22, 3600, 25),
      ],
      1,
    );

    expect(records[0]).toMatchObject({
      operationalMeasuredHours: 1,
      operationalOtsHours: 1,
      coreMeasuredHours: 0,
      coreOtsHours: 0,
      firstMeasuredHour: 10,
      lastMeasuredHour: 10,
      operationalOts: 25,
      coreOts: 0,
    });
  });
});

describe('camera health helpers', () => {
  it('calcula ventanas inclusivas y ids idempotentes', () => {
    expect(lookbackStartDate('2026-09-18', 28)).toBe('2026-08-22');
    expect(cameraHealthDocumentId('2026-09-18', 123)).toBe(
      '2026-09-18__123',
    );
  });

  it('rechaza ventanas inválidas', () => {
    expect(() => lookbackStartDate('18/09/2026', 28)).toThrow(RangeError);
    expect(() => lookbackStartDate('2026-09-18', 0)).toThrow(RangeError);
  });
});
