import { describe, it, expect } from 'vitest';
import { importSummary } from './importSummary';
import type { CampaignDiff } from '@/modules/campaigns/campaignDiff';
import type { CalendarAnalysis } from './calendarImport';

function diff(over: Partial<CampaignDiff>): CampaignDiff {
  const added = over.added ?? [];
  const removed = over.removed ?? [];
  const modified = over.modified ?? [];
  return {
    added,
    removed,
    modified,
    unchanged: over.unchanged ?? 0,
    hasChanges:
      over.hasChanges ?? added.length + removed.length + modified.length > 0,
  } as CampaignDiff;
}

function analysis(
  issues: CalendarAnalysis['issues'],
  dataRowCount = 10,
): CalendarAnalysis {
  return {
    sheets: [],
    operativeSheet: null,
    headerRow: null,
    headers: [],
    dataRowCount,
    previewRows: [],
    comments: [],
    instoreSupports: [],
    issues,
  };
}

describe('importSummary', () => {
  it('cuenta nuevas/modificadas/eliminadas/sin cambios del diff', () => {
    const s = importSummary(
      diff({
        added: [{}, {}] as never,
        modified: [{}] as never,
        removed: [{}, {}, {}] as never,
        unchanged: 7,
      }),
      null,
      0,
      0,
    );
    expect(s).toMatchObject({
      added: 2,
      modified: 1,
      removed: 3,
      unchanged: 7,
    });
  });

  it('separa errores (blocking) de advertencias (warning)', () => {
    const s = importSummary(
      null,
      analysis([
        { severity: 'blocking', code: 'e1', message: 'x' },
        { severity: 'warning', code: 'w1', message: 'y' },
        { severity: 'warning', code: 'w2', message: 'z' },
      ]),
      0,
      0,
    );
    expect(s.errors).toBe(1);
    expect(s.warnings).toBe(2);
  });

  it('hasWork es true si hay cambios o clasificaciones por crear', () => {
    expect(importSummary(diff({}), null, 0, 0).hasWork).toBe(false);
    expect(importSummary(diff({}), null, 3, 0).hasWork).toBe(true);
    expect(
      importSummary(diff({ added: [{}] as never }), null, 0, 0).hasWork,
    ).toBe(true);
  });

  it('propaga toClassify y pending tal cual', () => {
    const s = importSummary(null, null, 5, 2);
    expect(s.toClassify).toBe(5);
    expect(s.pending).toBe(2);
  });

  it('sin diff ni análisis, todo en cero', () => {
    const s = importSummary(null, null, 0, 0);
    expect(s).toEqual({
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
      toClassify: 0,
      pending: 0,
      errors: 0,
      warnings: 0,
      hasWork: false,
    });
  });
});
