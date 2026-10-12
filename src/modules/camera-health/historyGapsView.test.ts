import { describe, expect, it } from 'vitest';
import type { QuividiHistoryGapResult } from '@/services/quividi';
import { gapResultSummary, previousMonth, totalGaps } from './historyGapsView';

function result(
  over: Partial<QuividiHistoryGapResult> = {},
): QuividiHistoryGapResult {
  return {
    dates: ['2026-09-01', '2026-09-02'],
    locations: 150,
    checked: 9900,
    missing: 0,
    incomplete: 0,
    empty: 0,
    datesWithMeasurementGaps: [],
    reload: false,
    enqueued: 0,
    pending: 0,
    ...over,
  };
}

describe('previousMonth', () => {
  it('devuelve el último mes completo, cruzando el año', () => {
    expect(previousMonth(new Date(2026, 9, 12))).toBe('2026-09');
    expect(previousMonth(new Date(2026, 0, 5))).toBe('2025-12');
  });
});

describe('gapResultSummary', () => {
  it('sin huecos', () => {
    expect(gapResultSummary(result())).toBe(
      'Sin huecos: 150 locations × 2 días completos.',
    );
  });

  it('revisión: desglosa por motivo', () => {
    const r = result({ missing: 20, incomplete: 3, empty: 40 });
    expect(totalGaps(r)).toBe(63);
    expect(gapResultSummary(r)).toBe(
      '63 particiones con hueco (20 faltantes, 3 incompletas, 40 vacías en medición).',
    );
  });

  it('recarga: informa lo encolado y lo que quedó pendiente', () => {
    expect(
      gapResultSummary(
        result({ missing: 5, reload: true, enqueued: 3, pending: 2 }),
      ),
    ).toBe(
      '5 particiones con hueco (5 faltantes, 0 incompletas, 0 vacías en medición). Se encolaron 3 para volver a pedirse a Quividi. Quedan 2 por encolar: vuelve a pulsar «Recargar faltantes».',
    );
  });
});
