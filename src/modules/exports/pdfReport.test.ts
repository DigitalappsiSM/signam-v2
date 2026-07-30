import { describe, it, expect } from 'vitest';
import { ISSUE_LABELS, issueDetailRows } from './pdfReport';
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
});
