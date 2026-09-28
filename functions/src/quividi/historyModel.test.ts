import { describe, expect, it } from 'vitest';
import {
  historyPartitionId,
  inferredCatalogBinding,
  exportDataClass,
  inventoryBindings,
  rawHistoryPath,
  resolveHistoricalBinding,
  rowsFingerprint,
} from './historyModel';

describe('Quividi Liverpool history', () => {
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
      .toEqual([22]);
    expect(inventoryBindings([screen('LIV-008-MUPI-P1')],
      new Set([22]), '2026-09-28').conflicts).toEqual([22]);
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
  });
});
