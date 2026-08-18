import type {
  DigitalConflictGroup,
  DigitalImportResolution,
  DigitalPlacementRow,
  Actor,
} from './models';
import { hashText, stableKey } from './normalize';

export function detectConflicts(
  rows: readonly DigitalPlacementRow[],
): DigitalConflictGroup[] {
  const exact = new Map<string, number[]>();
  rows.forEach((row, index) =>
    exact.set(row.fingerprint, [...(exact.get(row.fingerprint) ?? []), index]),
  );
  const exactGroups = [...exact.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([key, rowIndexes]) => ({
      id: hashText(`exact:${key}`),
      kind: 'exact-duplicate' as const,
      rowIndexes,
      differentFields: [],
      confirmed: false,
      action: 'keep-one' as const,
    }));
  const exactIndexes = new Set(exactGroups.flatMap((g) => g.rowIndexes));
  const logical = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (!exactIndexes.has(index))
      logical.set(row.recordKey, [
        ...(logical.get(row.recordKey) ?? []),
        index,
      ]);
  });
  const logicalGroups = [...logical.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([key, rowIndexes]) => {
      const fields: (keyof DigitalPlacementRow)[] = [
        'client',
        'advertiser',
        'product',
        'fixationStart',
        'fixationEnd',
        'placementMode',
        'centers',
        'supports',
        'creativityTitle',
        'creativityStatus',
      ];
      const differentFields = fields.filter(
        (field) =>
          new Set(rowIndexes.map((i) => JSON.stringify(rows[i]![field]))).size >
          1,
      );
      return {
        id: hashText(`logical:${key}`),
        kind: 'logical-conflict' as const,
        rowIndexes,
        differentFields,
        confirmed: false,
      };
    });
  return [...exactGroups, ...logicalGroups];
}

export function resolveConflict(
  group: DigitalConflictGroup,
  action: string,
  acceptedRowIndexes: number[],
  rows: readonly DigitalPlacementRow[],
  batchId: string,
  actor: Actor,
  now = Date.now(),
): DigitalImportResolution {
  if (action === 'cancel')
    throw new Error('Importación cancelada por el usuario.');
  if (
    !acceptedRowIndexes.length &&
    action !== 'exclude-all' &&
    action !== 'exclude-selected'
  )
    throw new Error('La resolución debe seleccionar al menos una fila.');
  const all = group.rowIndexes,
    accepted = [...new Set(acceptedRowIndexes)].filter((i) => all.includes(i));
  const comparedValues = Object.fromEntries(
    group.differentFields.map((field) => [
      field,
      all.map((i) => rows[i]![field as keyof DigitalPlacementRow]),
    ]),
  );
  return {
    ...group,
    action: action as DigitalImportResolution['action'],
    confirmed: true,
    acceptedRowIndexes: accepted,
    batchId,
    excludedRowIndexes: all.filter((i) => !accepted.includes(i)),
    comparedValues,
    resolvedAt: now,
    resolvedByUid: actor.uid,
    resolvedByEmail: actor.email,
  };
}

export function acceptedRows(
  rows: readonly DigitalPlacementRow[],
  groups: readonly DigitalConflictGroup[],
): DigitalPlacementRow[] {
  if (groups.some((g) => !g.confirmed))
    throw new Error('Existen duplicados o conflictos sin confirmar.');
  const excluded = new Set(
    groups.flatMap((g) =>
      g.rowIndexes.filter((i) => !(g.acceptedRowIndexes ?? []).includes(i)),
    ),
  );
  return rows.filter((_, i) => !excluded.has(i));
}

export function resolutionHash(
  groups: readonly DigitalConflictGroup[],
): string {
  return hashText(
    stableKey(
      groups.map(
        (g) =>
          `${g.id}:${g.action}:${(g.acceptedRowIndexes ?? []).join(',')}:${g.confirmed}`,
      ),
    ),
  );
}
