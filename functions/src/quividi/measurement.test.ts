import { describe, expect, it } from 'vitest';
import {
  buildCoverage,
  buildMeasurementRows,
  dayList,
  inputSignature,
  measurableEndDate,
  parseCivilDate,
  resolvePairs,
  snapshotIsFresh,
  type OtsExportRow,
  type SupportPair,
  type TopologyLocation,
  type ViewerExportRow,
} from './measurement';
import type { CampaignDoc, EffectiveSupportPair } from './effectiveScope';

/**
 * Pruebas de caracterización de la medición Quividi.
 *
 * Congelan el comportamiento vigente: ponderación multi-cámara, umbral del
 * 80 % para declarar medición parcial, recorte del periodo medible y frescura
 * del snapshot. Si una cambia, cambió una regla de negocio.
 */

function location(
  id: number,
  name: string,
  over: Partial<TopologyLocation> = {},
): TopologyLocation {
  return { id, name, box_id: id * 10, site_id: 1, active: true, ...over };
}

function pair(over: Partial<SupportPair> = {}): SupportPair {
  return {
    storeNumber: '7',
    storeName: 'LIVERPOOL SANTA FE',
    support: 'BANNER DIGITAL',
    cameraNames: ['CAM-7'],
    source: 'calendar-selected',
    ekonNumber: null,
    cameras: [location(1, 'CAM-7')],
    ...over,
  };
}

function ots(
  locationId: number,
  date: string,
  over: Partial<OtsExportRow> = {},
): OtsExportRow {
  return {
    location_id: locationId,
    period_start: `${date}T00:00:00`,
    duration: 36000,
    ots_count: 100,
    effective_ots_count: 60,
    ...over,
  };
}

function viewer(
  locationId: number,
  date: string,
  over: Partial<ViewerExportRow> = {},
): ViewerExportRow {
  return {
    location_id: locationId,
    period_start: `${date}T00:00:00`,
    watcher_count: 20,
    attention_time_in_tenths_of_sec: 200,
    dwell_time_in_tenths_of_sec: 400,
    gender: 1,
    age: 3,
    ...over,
  };
}

describe('parseCivilDate', () => {
  it('acepta ISO y dd/mm/aaaa, y rechaza lo demás', () => {
    expect(parseCivilDate('2026-3-5')).toBe('2026-03-05');
    expect(parseCivilDate(' 2026-03-05 ')).toBe('2026-03-05');
    expect(parseCivilDate('5/3/2026')).toBe('2026-03-05');
    expect(parseCivilDate('05-03-2026')).toBe('2026-03-05');
    expect(parseCivilDate('marzo 2026')).toBeNull();
  });
});

describe('dayList', () => {
  it('enumera días civiles inclusive en ambos extremos', () => {
    expect(dayList('2026-03-01', '2026-03-04')).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
    ]);
    expect(dayList('2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
  });
});

describe('measurableEndDate', () => {
  const now = Date.parse('2026-03-10T08:00:00Z');

  it('recorta al último día UTC completo cuando la campaña sigue vigente', () => {
    expect(measurableEndDate('2026-03-01', '2026-03-31', now)).toBe(
      '2026-03-09',
    );
  });

  it('respeta el fin de la campaña cuando ya terminó', () => {
    expect(measurableEndDate('2026-03-01', '2026-03-05', now)).toBe(
      '2026-03-05',
    );
  });

  it('devuelve null si aún no hay ningún día completo medible', () => {
    expect(measurableEndDate('2026-03-10', '2026-03-31', now)).toBeNull();
  });
});

describe('snapshotIsFresh', () => {
  const endDate = '2026-03-31';
  const duranteLaCampana = Date.parse('2026-03-10T08:00:00Z');
  const trasElCierre = Date.parse('2026-04-02T08:00:00Z');

  it('reutiliza el snapshot de una campaña vigente por 24 horas', () => {
    expect(
      snapshotIsFresh(duranteLaCampana - 60_000, endDate, duranteLaCampana),
    ).toBe(true);
    expect(
      snapshotIsFresh(
        duranteLaCampana - 25 * 60 * 60 * 1000,
        endDate,
        duranteLaCampana,
      ),
    ).toBe(false);
  });

  it('da por definitivo el snapshot generado después del cierre', () => {
    expect(
      snapshotIsFresh(
        Date.parse('2026-04-01T00:00:00Z'),
        endDate,
        trasElCierre,
      ),
    ).toBe(true);
    expect(
      snapshotIsFresh(
        Date.parse('2026-03-20T00:00:00Z'),
        endDate,
        trasElCierre,
      ),
    ).toBe(false);
  });
});

describe('inputSignature', () => {
  const campaign: CampaignDoc = { name: 'CAMPAÑA DEMO' };
  const base: EffectiveSupportPair = {
    storeNumber: '7',
    storeName: 'LIVERPOOL SANTA FE',
    support: 'BANNER DIGITAL',
    cameraNames: ['CAM-A', 'CAM-B'],
    source: 'calendar-selected',
    ekonNumber: null,
  };
  const otro: EffectiveSupportPair = { ...base, storeNumber: '78' };

  it('no depende del orden de pares ni de cámaras', () => {
    const a = inputSignature(
      campaign,
      [base, otro],
      [],
      '2026-03-01',
      '2026-03-31',
    );
    const b = inputSignature(
      campaign,
      [otro, { ...base, cameraNames: ['CAM-B', 'CAM-A'] }],
      [],
      '2026-03-01',
      '2026-03-31',
    );
    expect(a).toBe(b);
  });

  it('cambia si cambia el alcance o la vigencia', () => {
    const a = inputSignature(campaign, [base], [], '2026-03-01', '2026-03-31');
    expect(
      inputSignature(campaign, [base], [], '2026-03-02', '2026-03-31'),
    ).not.toBe(a);
    expect(
      inputSignature(
        campaign,
        [{ ...base, cameraNames: ['CAM-A'] }],
        [],
        '2026-03-01',
        '2026-03-31',
      ),
    ).not.toBe(a);
  });
});

describe('resolvePairs', () => {
  const base: EffectiveSupportPair = {
    storeNumber: '7',
    storeName: 'LIVERPOOL SANTA FE',
    support: 'BANNER DIGITAL',
    cameraNames: ['CAM-7'],
    source: 'calendar-selected',
    ekonNumber: null,
  };

  it('resuelve por nombre exacto de location', () => {
    const result = resolvePairs(
      [base],
      [location(1, 'CAM-7'), location(2, 'CAM-78')],
    );

    expect(result.pairs[0]?.cameras.map((camera) => camera.id)).toEqual([1]);
    expect(result.unmappedCameraNames).toEqual([]);
  });

  it('reporta el nombre que no existe en VidiCenter', () => {
    const result = resolvePairs([base], [location(2, 'CAM-78')]);

    expect(result.pairs[0]?.cameras).toEqual([]);
    expect(result.unmappedCameraNames).toEqual(['CAM-7']);
  });

  it('descarta y marca el nombre duplicado en VidiCenter', () => {
    const result = resolvePairs(
      [base],
      [location(1, 'CAM-7'), location(3, 'CAM-7')],
    );

    expect(result.pairs[0]?.cameras).toEqual([]);
    expect(result.unmappedCameraNames).toEqual([
      'CAM-7 (duplicada en Quividi)',
    ]);
  });

  it('usa label cuando la location no trae name', () => {
    const result = resolvePairs(
      [base],
      [{ id: 5, label: 'CAM-7' } as TopologyLocation],
    );

    expect(result.pairs[0]?.cameras.map((camera) => camera.id)).toEqual([5]);
  });
});

describe('buildCoverage', () => {
  it('calcula cobertura general y por soporte', () => {
    const coverage = buildCoverage([
      pair(),
      pair({ storeNumber: '78', cameraNames: [], cameras: [] }),
      pair({
        storeNumber: '12',
        support: 'MEGA MUPI DIGITAL',
        cameras: [location(9, 'CAM-12')],
      }),
    ]);

    expect(coverage).toMatchObject({ totalPairs: 3, mappedPairs: 2 });
    expect(coverage.percent).toBeCloseTo(66.666, 2);
    expect(coverage.bySupport).toEqual([
      { support: 'BANNER DIGITAL', totalPairs: 2, mappedPairs: 1, percent: 50 },
      {
        support: 'MEGA MUPI DIGITAL',
        totalPairs: 1,
        mappedPairs: 1,
        percent: 100,
      },
    ]);
  });

  it('no divide entre cero cuando no hay pares', () => {
    expect(buildCoverage([])).toEqual({
      totalPairs: 0,
      mappedPairs: 0,
      percent: 0,
      bySupport: [],
    });
  });
});

describe('buildMeasurementRows · umbral de medición parcial', () => {
  const dates = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'];

  it('marca parcial el día cuya duración baja del 80 % de la mediana', () => {
    const rows = buildMeasurementRows(
      [pair()],
      dates,
      [
        ots(1, dates[0]!),
        ots(1, dates[1]!),
        ots(1, dates[2]!),
        // 79 % de la mediana (36000) → parcial
        ots(1, dates[3]!, { duration: 28_000 }),
      ],
      [],
    );

    expect(rows.cameraDays.map((row) => row.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'partial',
    ]);
  });

  it('no marca parcial una duración justo en el 80 %', () => {
    const rows = buildMeasurementRows(
      [pair()],
      dates,
      [
        ots(1, dates[0]!),
        ots(1, dates[1]!),
        ots(1, dates[2]!),
        ots(1, dates[3]!, { duration: 36_000 * 0.8 }),
      ],
      [],
    );

    expect(rows.cameraDays[3]?.status).toBe('complete');
  });

  it('marca missing el día sin fila de OTS y no lo rellena con cero', () => {
    const rows = buildMeasurementRows(
      [pair()],
      ['2026-03-01', '2026-03-02'],
      [ots(1, '2026-03-01')],
      [],
    );

    expect(rows.cameraDays[1]).toMatchObject({
      date: '2026-03-02',
      status: 'missing',
      ots: 0,
    });
    expect(rows.supportDays[1]).toMatchObject({
      status: 'missing',
      measuredCameras: 0,
    });
  });
});

describe('buildMeasurementRows · ponderación multi-cámara', () => {
  const dates = ['2026-03-01'];
  const dos = pair({
    cameraNames: ['CAM-A', 'CAM-B'],
    cameras: [location(1, 'CAM-A'), location(2, 'CAM-B')],
  });

  it('promedia las cámaras completas en lugar de sumarlas', () => {
    const rows = buildMeasurementRows(
      [dos],
      dates,
      [ots(1, dates[0]!), ots(2, dates[0]!, { ots_count: 300 })],
      [
        viewer(1, dates[0]!),
        viewer(2, dates[0]!, {
          watcher_count: 30,
          attention_time_in_tenths_of_sec: 600,
          dwell_time_in_tenths_of_sec: 900,
        }),
      ],
    );

    expect(rows.supportDays[0]).toMatchObject({
      status: 'complete',
      configuredCameras: 2,
      measuredCameras: 2,
      ots: 200,
      watchers: 25,
    });
    // (200 + 600) décimas / 50 watchers / 10 = 1.6 s
    expect(rows.supportDays[0]?.attentionSeconds).toBeCloseTo(1.6, 10);
    expect(rows.supportDays[0]?.dwellSeconds).toBeCloseTo(2.6, 10);
  });

  it('excluye las cámaras parciales cuando existe alguna completa', () => {
    const rows = buildMeasurementRows(
      [dos],
      ['2026-03-01', '2026-03-02', '2026-03-03'],
      [
        ots(1, '2026-03-01'),
        ots(1, '2026-03-02'),
        ots(1, '2026-03-03'),
        ots(2, '2026-03-01'),
        ots(2, '2026-03-02'),
        ots(2, '2026-03-03', { duration: 1_000, ots_count: 5 }),
      ],
      [],
    );

    const tercerDia = rows.supportDays[2];
    expect(tercerDia).toMatchObject({
      status: 'partial',
      measuredCameras: 1,
      ots: 100,
    });
  });

  it('usa las parciales cuando no hay ninguna completa', () => {
    const rows = buildMeasurementRows(
      [dos],
      ['2026-03-01', '2026-03-02', '2026-03-03'],
      [
        ots(1, '2026-03-01'),
        ots(1, '2026-03-02'),
        ots(1, '2026-03-03', { duration: 1_000, ots_count: 5 }),
        ots(2, '2026-03-01'),
        ots(2, '2026-03-02'),
        ots(2, '2026-03-03', { duration: 1_000, ots_count: 15 }),
      ],
      [],
    );

    expect(rows.supportDays[2]).toMatchObject({
      status: 'partial',
      measuredCameras: 2,
      ots: 10,
    });
  });

  it('omite del agregado los pares sin cámara resuelta', () => {
    const rows = buildMeasurementRows(
      [pair({ cameraNames: [], cameras: [] })],
      dates,
      [],
      [],
    );

    expect(rows.cameraDays).toEqual([]);
    expect(rows.supportDays).toEqual([]);
  });
});

describe('buildMeasurementRows · demografía e incidencias', () => {
  const dates = ['2026-03-01'];

  it('pondera la demografía con la misma regla multi-cámara', () => {
    const dos = pair({
      cameraNames: ['CAM-A', 'CAM-B'],
      cameras: [location(1, 'CAM-A'), location(2, 'CAM-B')],
    });
    const rows = buildMeasurementRows(
      [dos],
      dates,
      [ots(1, dates[0]!), ots(2, dates[0]!)],
      [
        viewer(1, dates[0]!, { gender: 1, age: 3, watcher_count: 20 }),
        viewer(2, dates[0]!, { gender: 1, age: 3, watcher_count: 40 }),
      ],
    );

    expect(rows.demographics).toEqual([
      expect.objectContaining({ gender: 1, age: 3, watchers: 30 }),
    ]);
  });

  it('agrupa las incidencias por cámara y estado', () => {
    const rows = buildMeasurementRows(
      [pair()],
      ['2026-03-01', '2026-03-02', '2026-03-03'],
      [ots(1, '2026-03-01')],
      [],
    );

    expect(rows.incidents).toEqual([
      expect.objectContaining({
        locationId: 1,
        status: 'missing',
        dates: ['2026-03-02', '2026-03-03'],
      }),
    ]);
  });

  it('no emite incidencias cuando todos los días están completos', () => {
    const rows = buildMeasurementRows(
      [pair()],
      dates,
      [ots(1, dates[0]!)],
      [viewer(1, dates[0]!)],
    );

    expect(rows.incidents).toEqual([]);
  });
});
