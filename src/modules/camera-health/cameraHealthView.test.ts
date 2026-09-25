import { describe, expect, it } from 'vitest';
import type { QuividiCameraHealthRow } from '@/domain';
import {
  cameraHealthStatusLabel,
  filterCameraHealthRows,
  formatHealthDate,
} from './cameraHealthView';

function camera(
  over: Partial<QuividiCameraHealthRow> = {},
): QuividiCameraHealthRow {
  return {
    locationId: 184,
    locationName: 'SATELITE MUPI 02',
    storeNumber: '25',
    storeName: 'LIVERPOOL SATELITE',
    support: 'MEGA MUPI DIGITAL',
    monitored: true,
    currentStatus: 'normal',
    severity: 'none',
    latestDate: '2026-09-20',
    activeAlertId: null,
    startedDate: null,
    consecutiveDays: 0,
    expectedCoreHours: 11,
    coreMeasuredHours: 11,
    coreOtsHours: 11,
    coreOts: 14000,
    firstMeasuredHour: 11,
    lastMeasuredHour: 21,
    firstOtsHour: 11,
    lastOtsHour: 21,
    lastEvaluatedAt: 1,
    measurementPointId: null,
    measurementPointCode: null,
    ticketAction: 'none',
    ticketStatus: 'not_needed',
    ticketId: null,
    ticketError: null,
    canCreateTicket: false,
    ...over,
  };
}

describe('camera health view', () => {
  it('distingue una cámara fuera de alcance de una recuperada/normal', () => {
    expect(cameraHealthStatusLabel(camera({ monitored: false }))).toBe(
      'Fuera de alcance',
    );
    expect(cameraHealthStatusLabel(camera())).toBe('Normal');
  });

  it('filtra alertas activas sin mezclar fuera de alcance', () => {
    const rows = [
      camera(),
      camera({
        locationId: 2,
        currentStatus: 'no_measurement',
        activeAlertId: '2__2026-09-20',
      }),
      camera({
        locationId: 3,
        monitored: false,
        activeAlertId: null,
      }),
    ];
    expect(
      filterCameraHealthRows(rows, '', 'alerts').map((row) => row.locationId),
    ).toEqual([2]);
  });

  it('busca por tienda, alias e ID', () => {
    const rows = [camera()];
    expect(filterCameraHealthRows(rows, 'satelite', 'all')).toHaveLength(1);
    expect(filterCameraHealthRows(rows, '184', 'all')).toHaveLength(1);
    expect(filterCameraHealthRows(rows, 'perisur', 'all')).toHaveLength(0);
  });

  it('formatea fechas civiles sin aplicar zona horaria', () => {
    expect(formatHealthDate('2026-09-20')).toBe('20/09/2026');
    expect(formatHealthDate(null)).toBe('—');
  });
});
