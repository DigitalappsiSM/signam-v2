import { describe, expect, it } from 'vitest';
import {
  cancelDigitalTracking,
  createDigitalTracking,
  updateDigitalCheck,
  type DigitalOperationalItem,
} from '@/domain/digital-operations';
import {
  digitalPeriodKey,
  digitalPeriodOptions,
  digitalProgressStatus,
  formatDigitalDate,
  normalizeDigitalSearch,
  surroundingPeriodIds,
} from './digitalOperationsView';

const actor = { uid: 'u1', email: 'operador@ism.mx' };

function item(
  periodId: string,
  periodStart: string,
  periodEnd: string,
  periodLabel = periodId,
): DigitalOperationalItem {
  return {
    id: periodId,
    operationalKey: periodId,
    logicalFlightKey: periodId,
    source: 'ekon-campaign-tracking',
    retailerCode: 'CHEDRAUI',
    retailerLabel: 'Chedraui',
    supportCode: 'COPETE_DIGITAL',
    supportLabel: 'Copete Digital',
    cmsName: null,
    campaignNumber: '100',
    periodId,
    periodLabel,
    periodStart,
    periodEnd,
    fixationStart: periodStart,
    fixationEnd: periodEnd,
    placementMode: 'fixation',
    client: 'Cliente',
    advertiser: 'Anunciante',
    product: 'Producto',
    creativityId: 'CR-1',
    creativityTitle: 'Creatividad',
    creativityStatus: 'Aprobada',
    centers: 10,
    supports: 10,
    placementRowIds: [],
    active: true,
    firstBatchId: 'b1',
    lastBatchId: 'b1',
    updatedAt: 1,
  };
}

describe('digitalOperationsView', () => {
  it('deriva el avance solo de los tres checks y respeta la cancelación', () => {
    const initial = createDigitalTracking('a', actor, 1);
    expect(digitalProgressStatus(initial)).toBe('not-started');

    const partial = updateDigitalCheck(initial, 'downloadLink', true, actor, 2);
    expect(digitalProgressStatus(partial)).toBe('in-progress');

    const complete = updateDigitalCheck(
      updateDigitalCheck(partial, 'retailerValidation', true, actor, 3),
      'cmsProgramming',
      true,
      actor,
      4,
    );
    expect(digitalProgressStatus(complete)).toBe('complete');
    expect(
      digitalProgressStatus(cancelDigitalTracking(complete, '', actor, 5)),
    ).toBe('cancelled');
  });

  it('ordena catorcenas y devuelve anterior, vigente y siguiente', () => {
    const periods = digitalPeriodOptions([
      item('C19', '2026-09-01', '2026-09-15'),
      item('C17', '2026-08-01', '2026-08-15'),
      item('C18', '2026-08-16', '2026-08-31'),
      item('C18', '2026-08-16', '2026-08-31'),
      item('C20', '2026-09-16', '2026-09-30'),
    ]);

    expect(periods.map((period) => period.id)).toEqual([
      'C17',
      'C18',
      'C19',
      'C20',
    ]);
    expect([...surroundingPeriodIds(periods, '2026-08-27')]).toEqual(
      periods.slice(0, 3).map((period) => period.key),
    );
  });

  it('usa el extremo más cercano cuando hoy cae fuera del calendario', () => {
    const periods = digitalPeriodOptions([
      item('C10', '2026-05-01', '2026-05-15'),
      item('C11', '2026-05-16', '2026-05-31'),
    ]);
    expect([...surroundingPeriodIds(periods, '2027-01-01')]).toEqual(
      periods.map((period) => period.key),
    );
  });

  it('no mezcla el mismo código de catorcena entre años', () => {
    const periods = digitalPeriodOptions([
      item('C17', '2026-08-01', '2026-08-15'),
      item('C17', '2027-08-01', '2027-08-15'),
    ]);
    expect(periods).toHaveLength(2);
    expect(digitalPeriodKey(item('C17', '2026-08-01', '2026-08-15'))).not.toBe(
      digitalPeriodKey(item('C17', '2027-08-01', '2027-08-15')),
    );
  });

  it('normaliza la búsqueda y formatea fechas civiles sin zona horaria', () => {
    expect(normalizeDigitalSearch('  CAMPAÑA Ágil ')).toBe('campana agil');
    expect(formatDigitalDate('2026-08-27')).toBe('27/08/2026');
    expect(formatDigitalDate('')).toBe('—');
  });
});
