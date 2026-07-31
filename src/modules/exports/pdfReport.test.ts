import { describe, it, expect } from 'vitest';
import {
  ISSUE_LABELS,
  issueDetailRows,
  issuesSummaryMetrics,
  subjectCampaign,
} from './pdfReport';
import type { ConsolidationResult } from '@/modules/consolidation/consolidate';

function result(): ConsolidationResult {
  return {
    consolidations: [],
    excludedInstore: [],
    ismExcludedCount: 0,
    issues: [
      {
        code: 'store-support-mismatch',
        campaign: 'ZOOPET JULIO',
        support: 'VIDEO WALL CRIUS',
        store: '83',
        message: 'x',
      },
      {
        code: 'store-not-in-catalog',
        campaign: 'CREDITO ADQUISICION',
        support: 'VIDEO WALL CRIUS',
        store: '999',
        message: 'y',
      },
    ],
  };
}

describe('issueDetailRows', () => {
  it('ordena por campaña y mapea código a etiqueta legible', () => {
    const rows = issueDetailRows(result());
    expect(rows[0]![0]).toBe('CREDITO ADQUISICION');
    expect(rows[1]![0]).toBe('ZOOPET JULIO');
    expect(rows[0]![3]).toBe(ISSUE_LABELS['store-not-in-catalog']);
    expect(rows[1]![2]).toBe('83');
  });

  it('sin includeCampaign omite la columna de campaña', () => {
    const rows = issueDetailRows(result(), { includeCampaign: false });
    expect(rows[0]).toHaveLength(3);
    // [soporte, tienda, tipo]
    expect(rows[0]![0]).toBe('VIDEO WALL CRIUS');
    expect(rows[0]![1]).toBe('999');
    expect(rows[0]![2]).toBe(ISSUE_LABELS['store-not-in-catalog']);
  });
});

describe('issuesSummaryMetrics', () => {
  it('cuenta total, tipos, soportes y tiendas distintas', () => {
    const m = issuesSummaryMetrics(result());
    expect(m.total).toBe(2);
    expect(m.typeCount).toBe(2);
    expect(m.supportCount).toBe(1);
    expect(m.storeCount).toBe(2);
    expect(m.instoreExcluded).toBe(0);
  });

  it('ignora incidencias sin tienda al contar tiendas y refleja InStore excluidos', () => {
    const r: ConsolidationResult = {
      consolidations: [],
      excludedInstore: [{ campaign: 'A', support: "MUPPI'S" }],
      ismExcludedCount: 0,
      issues: [
        {
          code: 'support-not-in-catalog',
          campaign: 'A',
          support: 'X',
          message: 'z',
        },
      ],
    };
    const m = issuesSummaryMetrics(r);
    expect(m.storeCount).toBe(0);
    expect(m.instoreExcluded).toBe(1);
  });
});

describe('subjectCampaign', () => {
  it('devuelve la campaña cuando todas las incidencias son de una sola', () => {
    const one = result();
    one.issues = [one.issues[0]!];
    expect(subjectCampaign(one.issues)).toBe('ZOOPET JULIO');
  });

  it('devuelve el fallback cuando hay varias campañas', () => {
    expect(subjectCampaign(result().issues, 'FALLBACK')).toBe('FALLBACK');
  });

  it('devuelve el fallback cuando no hay incidencias', () => {
    expect(subjectCampaign([], 'X')).toBe('X');
    expect(subjectCampaign([])).toBeNull();
  });
});
