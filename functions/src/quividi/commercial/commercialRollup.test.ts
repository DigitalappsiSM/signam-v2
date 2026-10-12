import { describe, expect, it } from 'vitest';
import {
  aggregateHourlyCameraDay,
  buildCommercialDailyRow,
  type CommercialCameraDay,
  type CommercialPair,
} from './commercialRollup';
import type { OtsExportRow, ViewerExportRow } from '../measurement';

/**
 * Pruebas de caracterización del rollup comercial (Fase 3).
 *
 * Congelan que reusa exactamente la regla de `cameraCombination.ts` ya
 * vigente en Fase 1: zona partida suma, cualquier otro caso toma la más
 * alta; se publica (duplica ×2) con 1 punto, o 2 fuera de zona partida.
 */

const DATE = '2026-03-10';

function ots(over: Partial<OtsExportRow> = {}): OtsExportRow {
  return {
    location_id: 1,
    period_start: `${DATE}T10:00:00`,
    ots_count: 100,
    effective_ots_count: 60,
    ...over,
  };
}

function viewer(over: Partial<ViewerExportRow> = {}): ViewerExportRow {
  return {
    location_id: 1,
    period_start: `${DATE}T10:00:00`,
    watcher_count: 40,
    attention_time_in_tenths_of_sec: 400,
    dwell_time_in_tenths_of_sec: 800,
    ...over,
  };
}

function camera(over: Partial<CommercialCameraDay> = {}): CommercialCameraDay {
  return {
    locationId: 1,
    pointId: 'LIV-199-MUPI-P1',
    ots: 100,
    effectiveOts: 60,
    watchers: 40,
    attentionTenths: 400,
    dwellTenths: 800,
    measured: true,
    ...over,
  };
}

function pair(over: Partial<CommercialPair> = {}): CommercialPair {
  return {
    storeNumber: '199',
    storeName: 'LIVERPOOL SATELITE',
    support: 'MEGA MUPI DIGITAL',
    configuredPointIds: ['LIV-199-MUPI-P1'],
    ...over,
  };
}

describe('aggregateHourlyCameraDay', () => {
  it('suma las horas del día y marca measured cuando hay filas', () => {
    const result = aggregateHourlyCameraDay(
      1,
      'LIV-199-MUPI-P1',
      [ots({ ots_count: 10 }), ots({ ots_count: 20, period_start: `${DATE}T11:00:00` })],
      [viewer({ watcher_count: 5 }), viewer({ watcher_count: 7, period_start: `${DATE}T11:00:00` })],
    );
    expect(result.ots).toBe(30);
    expect(result.watchers).toBe(12);
    expect(result.measured).toBe(true);
  });

  it('marca measured=false sin filas, nunca rellena con cero inventado', () => {
    const result = aggregateHourlyCameraDay(1, null, [], []);
    expect(result.measured).toBe(false);
    expect(result.ots).toBe(0);
  });
});

describe('buildCommercialDailyRow', () => {
  it('con 1 solo punto configurado (no zona partida), publica el doble de lo medido', () => {
    const row = buildCommercialDailyRow(pair(), DATE, [camera()]);
    expect(row).toMatchObject({
      ots: 100,
      watchers: 40,
      zoneSplit: false,
      publishedOts: 200,
      publishedWatchers: 80,
    });
    // Attention/Dwell son promedio por watcher: nunca se duplican.
    expect(row?.attentionSeconds).toBeCloseTo(400 / 40 / 10);
  });

  it('con 2 puntos fuera de zona partida, combina con la más alta y publica el doble de ESA', () => {
    const lower = camera({ locationId: 1, pointId: 'LIV-199-MUPI-P1', ots: 80, watchers: 30 });
    const higher = camera({
      locationId: 2,
      pointId: 'LIV-199-MUPI-P2',
      ots: 120,
      effectiveOts: 70,
      watchers: 50,
      attentionTenths: 500,
      dwellTenths: 1000,
    });
    const row = buildCommercialDailyRow(
      pair({ configuredPointIds: ['LIV-199-MUPI-P1', 'LIV-199-MUPI-P2'] }),
      DATE,
      [lower, higher],
    );
    expect(row).toMatchObject({
      ots: 120,
      effectiveOts: 70,
      watchers: 50,
      publishedOts: 240,
      publishedEffectiveOts: 140,
      publishedWatchers: 100,
      pointIdsUsed: ['LIV-199-MUPI-P1', 'LIV-199-MUPI-P2'],
    });
    expect(row?.attentionSeconds).toBeCloseTo(500 / 50 / 10);
  });

  it('con 2 puntos pero solo 1 medido, publica el doble de la que reportó (queda partial)', () => {
    const measuredOnly = camera({ locationId: 1, pointId: 'LIV-199-MUPI-P1', ots: 90 });
    const row = buildCommercialDailyRow(
      pair({ configuredPointIds: ['LIV-199-MUPI-P1', 'LIV-199-MUPI-P2'] }),
      DATE,
      [measuredOnly, camera({ locationId: 2, pointId: 'LIV-199-MUPI-P2', measured: false })],
    );
    expect(row).toMatchObject({ ots: 90, publishedOts: 180, status: 'partial' });
  });

  it('con 3+ puntos configurados, combina con la más alta pero NO publica el doble', () => {
    const a = camera({ locationId: 1, ots: 80 });
    const b = camera({ locationId: 2, ots: 120 });
    const c = camera({ locationId: 3, ots: 60 });
    const row = buildCommercialDailyRow(
      pair({
        configuredPointIds: ['LIV-199-MUPI-P1', 'LIV-199-MUPI-P2', 'LIV-199-MUPI-P3'],
      }),
      DATE,
      [a, b, c],
    );
    expect(row).toMatchObject({ ots: 120, publishedOts: 120 });
  });

  it('zona partida (BANNER DIGITAL) suma sus puntos y nunca publica el doble', () => {
    const a = camera({ locationId: 1, ots: 80, watchers: 30 });
    const b = camera({ locationId: 2, ots: 120, watchers: 50 });
    const row = buildCommercialDailyRow(
      pair({
        support: 'BANNER DIGITAL',
        configuredPointIds: ['LIV-199-BANNER-P1', 'LIV-199-BANNER-P2'],
      }),
      DATE,
      [a, b],
    );
    expect(row).toMatchObject({
      zoneSplit: true,
      ots: 200,
      watchers: 80,
      publishedOts: 200,
      publishedWatchers: 80,
    });
  });

  it('zona partida por nombre de tienda (Insurgentes) suma aunque el soporte no sea Banner', () => {
    const a = camera({ locationId: 1, ots: 80 });
    const b = camera({ locationId: 2, ots: 120 });
    const row = buildCommercialDailyRow(
      pair({
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'APARADOR INSURGENTES',
        configuredPointIds: ['LIV-INS-APARADOR-P1', 'LIV-INS-APARADOR-P2'],
      }),
      DATE,
      [a, b],
    );
    expect(row).toMatchObject({ zoneSplit: true, ots: 200, publishedOts: 200 });
  });

  it('sin medición, devuelve fila missing en ceros sin inventar datos', () => {
    const row = buildCommercialDailyRow(
      pair({ configuredPointIds: ['LIV-199-MUPI-P1', 'LIV-199-MUPI-P2'] }),
      DATE,
      [camera({ measured: false }), camera({ locationId: 2, measured: false })],
    );
    expect(row).toMatchObject({ status: 'missing', ots: 0, publishedOts: 0 });
  });

  it('sin puntos configurados, no genera fila', () => {
    const row = buildCommercialDailyRow(pair({ configuredPointIds: [] }), DATE, [camera()]);
    expect(row).toBeNull();
  });
});
