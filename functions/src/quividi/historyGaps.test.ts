import { describe, expect, it } from 'vitest';
import { historyPartitionId } from './historyModel';
import {
  EMPTY_REFETCH_EXPORTS,
  GAP_EXPORTS,
  classifyPartition,
  coverageCsv,
  dailySweepDates,
  findHistoryGaps,
  monthDates,
  summarizeHistoryGaps,
  type PartitionState,
} from './historyGaps';

const OTS_1H = { type: 'ots', resolution: '1h' };
const VEHICLES = { type: 'vehicles', resolution: '1h' };

describe('classifyPartition', () => {
  it('sin documento es faltante', () => {
    expect(classifyPartition(undefined, OTS_1H)).toBe('missing');
  });

  it('reintentos agotados u otro estado no completo es incompleto', () => {
    expect(classifyPartition({ status: 'retrying' }, OTS_1H)).toBe(
      'incomplete',
    );
  });

  it('unsupported no es hueco: VidiCenter dijo que no existe', () => {
    expect(classifyPartition({ status: 'unsupported' }, OTS_1H)).toBeNull();
  });

  it('completo y vacío solo es hueco en series de medición', () => {
    expect(classifyPartition({ status: 'complete', rowCount: 0 }, OTS_1H)).toBe(
      'empty',
    );
    expect(
      classifyPartition({ status: 'complete', rowCount: 0 }, VEHICLES),
    ).toBeNull();
    expect(
      classifyPartition({ status: 'complete', rowCount: 24 }, OTS_1H),
    ).toBeNull();
  });
});

describe('GAP_EXPORTS', () => {
  it('excluye agregados por sitio y conserva las series de medición', () => {
    expect(GAP_EXPORTS.some((spec) => spec.type.includes('_by_site'))).toBe(
      false,
    );
    for (const spec of EMPTY_REFETCH_EXPORTS) {
      expect(GAP_EXPORTS).toContainEqual(spec);
    }
  });
});

describe('monthDates', () => {
  it('devuelve el mes completo hasta la última fecha permitida', () => {
    expect(monthDates('2026-09', '2026-10-11')).toHaveLength(30);
    expect(monthDates('2026-10', '2026-10-11')).toEqual(
      Array.from(
        { length: 11 },
        (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`,
      ),
    );
    expect(monthDates('2026-02', '2026-12-31')).toHaveLength(28);
  });

  it('rechaza meses inválidos o anteriores al inicio del histórico', () => {
    expect(monthDates('2026-13', '2026-12-31')).toEqual([]);
    expect(monthDates('2025-12', '2026-12-31')).toEqual([]);
  });
});

describe('dailySweepDates', () => {
  it('cubre D-2…D-8: deja D-1 a la ingesta diaria', () => {
    expect(dailySweepDates('2026-10-11')).toEqual([
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
    ]);
  });
});

describe('findHistoryGaps + summarizeHistoryGaps', () => {
  it('cruza la cuadrícula esperada contra lo guardado', () => {
    const exports = [OTS_1H, VEHICLES];
    const states = new Map<string, PartitionState>([
      [
        historyPartitionId(141982, '2026-09-21', 'ots', '1h'),
        { status: 'complete', rowCount: 24 },
      ],
      [
        historyPartitionId(141982, '2026-09-21', 'vehicles', '1h'),
        { status: 'complete', rowCount: 0 },
      ],
      [
        historyPartitionId(141982, '2026-09-22', 'ots', '1h'),
        { status: 'complete', rowCount: 0 },
      ],
      [
        historyPartitionId(141982, '2026-09-22', 'vehicles', '1h'),
        { status: 'retrying' },
      ],
    ]);
    const gaps = findHistoryGaps(
      [141982],
      ['2026-09-20', '2026-09-21', '2026-09-22'],
      states,
      exports,
    );
    expect(gaps).toEqual([
      { locationId: 141982, date: '2026-09-20', ...OTS_1H, reason: 'missing' },
      {
        locationId: 141982,
        date: '2026-09-20',
        ...VEHICLES,
        reason: 'missing',
      },
      { locationId: 141982, date: '2026-09-22', ...OTS_1H, reason: 'empty' },
      {
        locationId: 141982,
        date: '2026-09-22',
        ...VEHICLES,
        reason: 'incomplete',
      },
    ]);
    expect(summarizeHistoryGaps(6, gaps)).toEqual({
      checked: 6,
      missing: 2,
      incomplete: 1,
      empty: 1,
      datesWithMeasurementGaps: ['2026-09-20', '2026-09-22'],
    });
  });
});

describe('coverageCsv', () => {
  it('usa las columnas de conteo del export de VidiCenter y el estado por serie', () => {
    const csv = coverageCsv([
      {
        locationId: 141982,
        date: '2026-09-21',
        ots1d: {
          state: { status: 'complete', rowCount: 1 },
          otsCount: 7482,
          effectiveOtsCount: 4135,
        },
        viewers1d: {
          state: { status: 'complete', rowCount: 1 },
          watcherCount: 117,
        },
        ots1h: { status: 'complete', rowCount: 24 },
        viewers1h: { status: 'complete', rowCount: 0 },
      },
      { locationId: 141982, date: '2026-09-22' },
    ]);
    expect(csv.split('\n')).toEqual([
      'location_id,date,ots_count,effective_ots_count,watcher_count,ots_1d,viewers_1d,ots_1h,viewers_1h',
      '141982,2026-09-21,7482,4135,117,completo,completo,completo,vacio',
      '141982,2026-09-22,,,,faltante,faltante,faltante,faltante',
      '',
    ]);
  });
});
