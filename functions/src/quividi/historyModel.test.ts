import { describe, expect, it } from 'vitest';
import {
  CONSUMER_HISTORY_EXPORTS,
  historyPartitionId,
  historyDateRange,
  historyDailyTaskAt,
  historyMonthRangeAt,
  historyRowCivilDate,
  quividiApiExportSpec,
  inferredCatalogBinding,
  earliestMeasuredDate,
  isMeasurementExport,
  exportDataClass,
  inventoryBindings,
  historyCatalogStores,
  validHistoryCatalogSelection,
  replaceHistoricalBinding,
  rawHistoryPath,
  resolveHistoricalBinding,
  rowsFingerprint,
} from './historyModel';

describe('Quividi Liverpool history', () => {

  it('splits monthly export ranges into the existing daily partition model', () => {
    expect(historyDateRange('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02',
    ]);
    expect(historyRowCivilDate({ period_start: '2026-09-15T11:00:00' })).toBe('2026-09-15');
    expect(historyRowCivilDate({ timestamp: '2026-09-16 08:30:00' })).toBe('2026-09-16');
    expect(historyRowCivilDate({ value: 10 })).toBeNull();
  });

  it('builds daily D-1 tasks without re-expanding historical ranges', () => {
    const plan = [
      { type: 'ots', resolution: '1d' },
      { type: 'viewers', resolution: '1d' },
    ];
    expect(historyDailyTaskAt(0, '2026-10-05', [11, 22], plan)).toEqual({
      startDate: '2026-10-05', endDate: '2026-10-05',
      locationId: 11, type: 'ots', resolution: '1d',
    });
    expect(historyDailyTaskAt(3, '2026-10-05', [11, 22], plan)).toEqual({
      startDate: '2026-10-05', endDate: '2026-10-05',
      locationId: 22, type: 'viewers', resolution: '1d',
    });
    expect(historyDailyTaskAt(4, '2026-10-05', [11, 22], plan)).toBeNull();
    expect(historyDailyTaskAt(0, 'invalid', [11], plan)).toBeNull();
  });

  it('builds one monthly Quividi export per location and data type, capped at D-1', () => {
    const plan = [
      { type: 'ots', resolution: '1h' },
      { type: 'viewers', resolution: '1h' },
    ];
    expect(historyMonthRangeAt(0, '2026-06-01', [11, 22], plan, '2026-08-14')).toEqual({
      startDate: '2026-06-01', endDate: '2026-06-30',
      locationId: 11, type: 'ots', resolution: '1h',
    });
    expect(historyMonthRangeAt(3, '2026-06-01', [11, 22], plan, '2026-08-14')).toEqual({
      startDate: '2026-06-01', endDate: '2026-06-30',
      locationId: 22, type: 'viewers', resolution: '1h',
    });
    expect(historyMonthRangeAt(4, '2026-06-01', [11, 22], plan, '2026-08-14')).toEqual({
      startDate: '2026-07-01', endDate: '2026-07-31',
      locationId: 11, type: 'ots', resolution: '1h',
    });
    expect(historyMonthRangeAt(8, '2026-06-01', [11, 22], plan, '2026-08-14')).toEqual({
      startDate: '2026-08-01', endDate: '2026-08-14',
      locationId: 11, type: 'ots', resolution: '1h',
    });
    expect(historyMonthRangeAt(12, '2026-06-01', [11, 22], plan, '2026-08-14')).toBeNull();
  });

  it('stores native daily series required by reports and camera health', () => {
    expect(CONSUMER_HISTORY_EXPORTS).toEqual([
      { type: 'ots', resolution: '1d' },
      { type: 'viewers', resolution: '1d' },
      { type: 'viewers_demographics', resolution: '1d' },
    ]);
    expect(quividiApiExportSpec('viewers_demographics')).toEqual({
      dataType: 'viewers',
      groupByDemographics: true,
    });
    expect(quividiApiExportSpec('ots')).toEqual({
      dataType: 'ots',
      groupByDemographics: false,
    });
    expect(historyPartitionId(22, '2026-09-01', 'ots', '1d')).toContain(
      '__ots__1d',
    );
    expect(
      historyPartitionId(
        22,
        '2026-09-01',
        'viewers_demographics',
        '1d',
      ),
    ).toContain('__viewers_demographics__1d');
    expect(isMeasurementExport('viewers_demographics')).toBe(true);
  });

  it('keeps one store identity across location replacement, with dated evidence', () => {
    const old = {
      locationId: 11, storeId: 'LIV-007', storeName: 'Santa Fe',
      support: 'MEGA MUPI DIGITAL', pointId: 'LIV-007-MUPI-P1',
      validFrom: '2026-01-01', validTo: '2026-06-30', source: 'manual' as const,
    };
    const current = { ...old, locationId: 22, validFrom: '2026-07-01',
      validTo: null, source: 'catalog' as const };
    expect(resolveHistoricalBinding([old, current], 11, '2026-05-01')?.storeId)
      .toBe('LIV-007');
    expect(resolveHistoricalBinding([old, current], 22, '2026-08-01')?.storeId)
      .toBe('LIV-007');
    expect(resolveHistoricalBinding([current], 22, '2026-05-01')).toBeNull();
    expect(resolveHistoricalBinding([old, { ...old, storeId: 'LIV-008' }],
      11, '2026-05-01')).toBeNull();
  });

  it('marks retrospective catalog assignments as inferred and flags conflicts', () => {
    const screen = (pointId: string) => ({
      original: { 'Numero de Tienda': '7', 'Nombre de tienda': 'Santa Fe' },
      metadata: { active: true, calendarSupport: 'MEGA MUPI DIGITAL',
        quividiLocationId: 22, measurementPointId: pointId },
    });
    const result = inventoryBindings([screen('LIV-007-MUPI-P1')],
      new Set([22, 33]), '2026-09-28');
    expect(result.candidates[0]?.validFrom).toBe('2026-09-28');
    const inferred = inferredCatalogBinding(result.candidates[0]!);
    expect(inferred).toMatchObject({ validFrom: '2026-01-01',
      validTo: '2026-09-27', source: 'catalog_inferred' });
    expect(resolveHistoricalBinding([inferred!, ...result.candidates], 22, '2026-03-02')?.storeId)
      .toBe('LIV-007');
    expect(resolveHistoricalBinding([inferred!, ...result.candidates], 22, '2026-09-28')?.source)
      .toBe('catalog');
    expect(inventoryBindings([screen('LIV-007-MUPI-P1'),
      screen('LIV-007-MUPI-P2')], new Set([22]), '2026-09-28').conflicts)
      .toEqual([]);
    expect(inventoryBindings([screen('LIV-008-MUPI-P1')],
      new Set([22]), '2026-09-28').conflicts).toEqual([22]);
  });

  it('uses catalog stores and supports including inactive screens without cameras', () => {
    const screens = [
      { original: { 'Numero de Tienda': '7', 'Nombre de tienda': 'Santa Fe' },
        metadata: { active: false, calendarSupport: 'MEGA MUPI DIGITAL' } },
      { original: { 'Numero de Tienda': '8', 'Nombre de tienda': 'Otra' },
        metadata: { calendarSupport: 'BANNER DIGITAL' } },
      { original: { 'Numero de Tienda': '0' }, metadata: { calendarSupport: 'BANNER DIGITAL' } },
    ];
    const stores = historyCatalogStores([...screens, screens[0]!]);
    expect(stores).toHaveLength(2);
    expect(stores[0]).toMatchObject({ number: '007', name: 'Santa Fe', supports: ['MEGA MUPI DIGITAL'] });
    expect(validHistoryCatalogSelection(stores, 'LIV-007', 'MEGA MUPI DIGITAL', null)).toBe(true);
    expect(validHistoryCatalogSelection(stores, 'LIV-007', 'BANNER DIGITAL', null)).toBe(false);
    expect(validHistoryCatalogSelection(stores, 'LIV-099', 'MEGA MUPI DIGITAL', null)).toBe(false);
    expect(validHistoryCatalogSelection(stores, 'LIV-007', 'MEGA MUPI DIGITAL', 'LIV-008-MUPI-P1')).toBe(false);
  });

  it('automatically associates a location without requiring a point, preserving store/support conflicts', () => {
    const screen = { original: { 'Numero de Tienda': '7', 'Nombre de tienda': 'Santa Fe' },
      metadata: { calendarSupport: 'MEGA MUPI DIGITAL', quividiLocationId: 22 } };
    const result = inventoryBindings([screen], new Set([22]), '2026-09-29');
    expect(result.candidates[0]).toMatchObject({ storeId: 'LIV-007', support: 'MEGA MUPI DIGITAL', pointId: null });
    expect(inventoryBindings([screen, { ...screen, original: { 'Numero de Tienda': '8' } }],
      new Set([22]), '2026-09-29').conflicts).toEqual([22]);
    expect(inventoryBindings([screen, { ...screen, metadata: { ...screen.metadata, calendarSupport: 'BANNER DIGITAL' } }],
      new Set([22]), '2026-09-29').conflicts).toEqual([22]);
  });

  it('replaces overlapping catalog evidence and preserves dated changes without a point', () => {
    const current = { locationId: 22, storeId: 'LIV-007', storeName: 'Santa Fe',
      support: 'MEGA MUPI DIGITAL', pointId: null, source: 'catalog' as const,
      validFrom: '2026-01-01', validTo: null };
    const manual = { ...current, source: 'manual' as const,
      validFrom: '2026-04-01', validTo: '2026-06-30' };
    const result = replaceHistoricalBinding([current], manual);
    expect(result).toHaveLength(3);
    expect(resolveHistoricalBinding(result, 22, '2026-03-31')?.source).toBe('catalog');
    expect(resolveHistoricalBinding(result, 22, '2026-04-01')?.source).toBe('manual');
    expect(resolveHistoricalBinding(result, 22, '2026-07-01')?.source).toBe('catalog');
    expect(replaceHistoricalBinding([current], { ...manual, validTo: null })).toHaveLength(2);
    expect(() => replaceHistoricalBinding([manual], { ...manual, validFrom: '2026-05-01' })).toThrow(/superpone/);
    expect(replaceHistoricalBinding([manual], { ...manual, storeId: 'LIV-008' })[0]?.storeId).toBe('LIV-008');
    expect(replaceHistoricalBinding([current], { ...manual, validFrom: current.validFrom })).toHaveLength(2);
  });

  it('deduplicates reordered responses while preserving distinct equal rows', () => {
    const a = { period_start: '2026-09-01 10:00:00', ots_count: 2 };
    const b = { ots_count: 3, period_start: '2026-09-01 11:00:00' };
    expect(rowsFingerprint([a, b])).toBe(rowsFingerprint([b, a]));
    expect(rowsFingerprint([a, a])).not.toBe(rowsFingerprint([a]));
    const id = historyPartitionId(22, '2026-09-01', 'ots', '1h');
    expect(rawHistoryPath(id, rowsFingerprint([a]))).toContain('network-3089');
  });

  it('keeps site totals and estimated series separate from camera measurements', () => {
    expect(exportDataClass('proof_of_play_by_site')).toBe('site_aggregate');
    expect(exportDataClass('extrapolated_ots')).toBe('derived');
    expect(exportDataClass('ots')).toBe('source');
    expect(isMeasurementExport('ots')).toBe(true);
    expect(isMeasurementExport('viewers')).toBe(true);
    expect(isMeasurementExport('content_plays')).toBe(false);
    expect(isMeasurementExport('extrapolated_ots')).toBe(false);
    expect(earliestMeasuredDate(null, '2026-01-01', 'ots', 0)).toBeNull();
    expect(earliestMeasuredDate(null, '2026-04-12', 'ots', 1)).toBe('2026-04-12');
    expect(earliestMeasuredDate('2026-04-12', '2026-03-30', 'viewers', 1))
      .toBe('2026-03-30');
    expect(earliestMeasuredDate('2026-03-30', '2026-01-01', 'content_plays', 8))
      .toBe('2026-03-30');
  });
});
