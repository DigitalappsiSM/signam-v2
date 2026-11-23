import { describe, expect, it } from 'vitest';
import { summarizeChedrauiMeasurement } from './chedrauiCameraMeasurement';

const date = '2026-11-22';

function row(id: number, hour: number, ots: number, duration = 3600) {
  return {
    location_id: id,
    period_start: `${date}T${String(hour).padStart(2, '0')}:00:00`,
    ots_count: ots,
    duration,
  };
}

describe('medición de salud de cámaras Chedraui', () => {
  it('comparte la ventana 11–22 y distingue horas medidas de horas con OTS', () => {
    const rows = [
      row(7, 10, 100),
      row(7, 11, 34),
      row(7, 12, 0),
      row(7, 22, 100),
      ...Array.from({ length: 11 }, (_, i) => row(8, i + 11, 0)),
      ...Array.from({ length: 9 }, (_, i) => row(9, i + 11, 5)),
    ];
    expect(summarizeChedrauiMeasurement(rows, [7, 8, 9, 10], date)).toEqual({
      7: {
        expectedCoreHours: 11,
        coreMeasuredHours: 2,
        coreOtsHours: 1,
        coreOts: 34,
        status: 'partial_measurement',
      },
      8: {
        expectedCoreHours: 11,
        coreMeasuredHours: 11,
        coreOtsHours: 0,
        coreOts: 0,
        status: 'no_ots',
      },
      9: {
        expectedCoreHours: 11,
        coreMeasuredHours: 9,
        coreOtsHours: 9,
        coreOts: 45,
        status: 'normal',
      },
      10: {
        expectedCoreHours: 11,
        coreMeasuredHours: 0,
        coreOtsHours: 0,
        coreOts: 0,
        status: 'no_measurement',
      },
    });
  });

  it('rechaza ubicaciones o días que no se solicitaron', () => {
    expect(() =>
      summarizeChedrauiMeasurement([row(8, 11, 5)], [7], date),
    ).toThrow();
    expect(() =>
      summarizeChedrauiMeasurement([row(7, 11, 5)], [7], '2026-11-21'),
    ).toThrow();
  });
});
