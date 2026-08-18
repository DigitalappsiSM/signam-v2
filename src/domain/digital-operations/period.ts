import { civilDate, comparisonText, normalizeText } from './normalize';
export function parsePeriod(periodIdValue: unknown, labelValue: unknown) {
  const periodId = comparisonText(periodIdValue).replace(/\s/g, '');
  const label = normalizeText(labelValue);
  const match =
    /^(C?\d+)\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})$/i.exec(
      label,
    );
  if (!match) return null;
  const labelId = comparisonText(match[1]).replace(/\s/g, '');
  const canonicalId = periodId.startsWith('C') ? periodId : `C${periodId}`;
  const canonicalLabel = labelId.startsWith('C') ? labelId : `C${labelId}`;
  const startDate = civilDate(match[2]),
    endDate = civilDate(match[3]);
  if (
    !startDate ||
    !endDate ||
    startDate > endDate ||
    canonicalId !== canonicalLabel
  )
    return null;
  return { periodId: canonicalId, periodLabel: label, startDate, endDate };
}
