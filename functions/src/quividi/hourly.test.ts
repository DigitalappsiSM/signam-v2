import { describe, expect, it } from 'vitest';
import {
  buildSupportHours,
  type HourlyOtsExportRow,
  type HourlyPair,
  type HourlyViewerExportRow,
} from './hourly';

/**
 * Pruebas de caracterización de la capa horaria Quividi.
 *
 * Congelan la regla multi-cámara del dato de una hora: se promedian las
 * cámaras que realmente entregaron OTS salvo Insurgentes, cuyas cámaras están
 * en pisos distintos y se suman como zonas independientes.
 */

function pair(over: Partial<HourlyPair> = {}): HourlyPair {
  return {
    storeNumber: '7',
    storeName: 'LIVERPOOL SANTA FE',
    support: 'BANNER DIGITAL',
    cameras: [{ id: 1 }, { id: 2 }],
    ...over,
  };
}

function ots(
  locationId: number,
  periodStart: string,
  over: Partial<HourlyOtsExportRow> = {},
): HourlyOtsExportRow {
  return {
    location_id: locationId,
    period_start: periodStart,
    duration: 3600,
    ots_count: 100,
    effective_ots_count: 60,
    ...over,
  };
}

function viewer(
  locationId: number,
  periodStart: string,
  over: Partial<HourlyViewerExportRow> = {},
): HourlyViewerExportRow {
  return {
    location_id: locationId,
    period_start: periodStart,
    watcher_count: 20,
    attention_time_in_tenths_of_sec: 200,
    dwell_time_in_tenths_of_sec: 400,
    ...over,
  };
}

const HOUR = '2026-03-01T10:00:00';

describe('buildSupportHours · regla multi-cámara', () => {
  it('promedia las cámaras válidas en lugar de sumarlas', () => {
    const rows = buildSupportHours(
      [pair()],
      [
        ots(1, HOUR),
        ots(2, HOUR, { ots_count: 300, effective_ots_count: 100 }),
      ],
      [
        viewer(1, HOUR),
        viewer(2, HOUR, {
          watcher_count: 30,
          attention_time_in_tenths_of_sec: 600,
          dwell_time_in_tenths_of_sec: 900,
        }),
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-03-01',
      hour: 10,
      storeNumber: '7',
      support: 'BANNER DIGITAL',
      configuredCameras: 2,
      measuredCameras: 2,
      status: 'complete',
      ots: 200,
      effectiveOts: 80,
      watchers: 25,
    });
  });

  it('suma OTS únicamente en Insurgentes por tratarse de pisos distintos', () => {
    const rows = buildSupportHours(
      [pair({ storeName: 'LIVERPOOL INSURGENTES' })],
      [
        ots(1, HOUR),
        ots(2, HOUR, { ots_count: 300, effective_ots_count: 100 }),
      ],
      [],
    );

    expect(rows[0]).toMatchObject({
      configuredCameras: 2,
      measuredCameras: 2,
      status: 'complete',
      ots: 400,
      effectiveOts: 160,
    });
  });

  it('pondera Attention y Dwell por Watchers, no por cámara', () => {
    const rows = buildSupportHours(
      [pair()],
      [ots(1, HOUR), ots(2, HOUR)],
      [
        viewer(1, HOUR),
        viewer(2, HOUR, {
          watcher_count: 30,
          attention_time_in_tenths_of_sec: 600,
          dwell_time_in_tenths_of_sec: 900,
        }),
      ],
    );

    // (200 + 600) décimas / 50 watchers / 10 = 1.6 s
    expect(rows[0]?.attentionSeconds).toBeCloseTo(1.6, 10);
    // (400 + 900) décimas / 50 watchers / 10 = 2.6 s
    expect(rows[0]?.dwellSeconds).toBeCloseTo(2.6, 10);
  });

  it('marca la hora como parcial cuando solo una de varias cámaras reporta', () => {
    const rows = buildSupportHours([pair()], [ots(1, HOUR)], [viewer(1, HOUR)]);

    expect(rows[0]).toMatchObject({
      configuredCameras: 2,
      measuredCameras: 1,
      status: 'partial',
      ots: 100,
      watchers: 20,
    });
    expect(rows[0]?.attentionSeconds).toBeCloseTo(1, 10);
  });

  it('descarta las cámaras con duración cero y omite la hora si ninguna mide', () => {
    const rows = buildSupportHours(
      [pair()],
      [ots(1, HOUR, { duration: 0 }), ots(2, HOUR, { duration: 0 })],
      [viewer(1, HOUR), viewer(2, HOUR)],
    );

    expect(rows).toEqual([]);
  });

  it('acumula varias filas del mismo location y periodo antes de promediar', () => {
    const rows = buildSupportHours(
      [pair({ cameras: [{ id: 1 }] })],
      [
        ots(1, HOUR, {
          duration: 1800,
          ots_count: 40,
          effective_ots_count: 10,
        }),
        ots(1, HOUR, {
          duration: 1800,
          ots_count: 60,
          effective_ots_count: 20,
        }),
      ],
      [viewer(1, HOUR)],
    );

    expect(rows[0]).toMatchObject({
      measuredCameras: 1,
      status: 'complete',
      ots: 100,
      effectiveOts: 30,
    });
  });

  it('no emite filas para pares sin cámaras configuradas', () => {
    const rows = buildSupportHours(
      [pair({ cameras: [] })],
      [ots(1, HOUR)],
      [viewer(1, HOUR)],
    );

    expect(rows).toEqual([]);
  });

  it('tolera horas con OTS pero sin fila de viewers', () => {
    const rows = buildSupportHours(
      [pair({ cameras: [{ id: 1 }] })],
      [ots(1, HOUR)],
      [],
    );

    expect(rows[0]).toMatchObject({
      status: 'complete',
      watchers: 0,
      attentionSeconds: 0,
      dwellSeconds: 0,
    });
  });

  it('ignora periodos con marca de tiempo no interpretable', () => {
    const rows = buildSupportHours(
      [pair({ cameras: [{ id: 1 }] })],
      [ots(1, '2026-03-01'), ots(1, 'sin fecha')],
      [],
    );

    expect(rows).toEqual([]);
  });
});

describe('buildSupportHours · orden del resultado', () => {
  it('ordena por fecha, hora, tienda y soporte', () => {
    const rows = buildSupportHours(
      [
        pair({ storeNumber: '78', cameras: [{ id: 2 }] }),
        pair({ storeNumber: '7', cameras: [{ id: 1 }] }),
      ],
      [
        ots(1, '2026-03-02T09:00:00'),
        ots(1, '2026-03-01T11:00:00'),
        ots(2, '2026-03-01T11:00:00'),
      ],
      [],
    );

    expect(
      rows.map((row) => `${row.date} ${row.hour} ${row.storeNumber}`),
    ).toEqual(['2026-03-01 11 7', '2026-03-01 11 78', '2026-03-02 9 7']);
  });
});
