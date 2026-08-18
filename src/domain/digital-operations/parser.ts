import * as XLSX from 'xlsx';
import { DIGITAL_HEADERS, MINIMUM_HEADERS } from './constants';
import { matchProfile, placementMode } from './catalog';
import {
  civilDate,
  comparisonText,
  finiteCount,
  hashText,
  identifier,
  normalizeText,
  stableKey,
} from './normalize';
import { parsePeriod } from './period';
import type {
  DigitalIssue,
  DigitalPlacementRow,
  DigitalSupportProfile,
} from './models';

export interface DigitalParseResult {
  sheetName: string;
  sourceHeaders: string[];
  sourceRows: number;
  rows: DigitalPlacementRow[];
  ignored: Array<{
    sourceRow: number;
    reason: string;
    sourceFields: DigitalPlacementRow['sourceFields'];
  }>;
  issues: DigitalIssue[];
  warnings: string[];
  periods: Array<{ periodId: string; startDate: string; endDate: string }>;
  contentHash: string;
}
const alias = (value: string) =>
  comparisonText(value).replace('CREATIVIDAD TITULO', 'CREATIVITAD TITULO');

function selectSheet(workbook: XLSX.WorkBook): {
  name: string;
  warning?: string;
} {
  const exact = workbook.SheetNames.find(
    (name) => comparisonText(name) === 'SEGUIMIENTO CAMPANAS',
  );
  if (exact) return { name: exact };
  const candidates = workbook.SheetNames.filter((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name]!, {
      header: 1,
      raw: true,
    });
    const headers = (rows[0] ?? []).map((x) => alias(normalizeText(x)));
    return MINIMUM_HEADERS.every((h) => headers.includes(alias(h)));
  });
  if (workbook.SheetNames.length === 1 && candidates.length === 1)
    return {
      name: candidates[0]!,
      warning:
        'Se usó la única hoja compatible; el nombre esperado es Seguimiento Campañas.',
    };
  throw new Error(
    'No se encontró de forma inequívoca la hoja Seguimiento Campañas.',
  );
}

export function parseDigitalWorkbook(
  data: ArrayBuffer,
  profiles: readonly DigitalSupportProfile[],
  batchId = 'preview',
  now = Date.now(),
): DigitalParseResult {
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const selection = selectSheet(workbook);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(
    workbook.Sheets[selection.name]!,
    { header: 1, raw: true, defval: '' },
  );
  const sourceHeaders = (matrix[0] ?? []).map(normalizeText);
  const headerMap = new Map(sourceHeaders.map((h, index) => [alias(h), index]));
  const missing = MINIMUM_HEADERS.filter((h) => !headerMap.has(alias(h)));
  if (missing.length)
    throw new Error(`Faltan encabezados requeridos: ${missing.join(', ')}.`);
  const get = (values: unknown[], header: string) =>
    values[headerMap.get(alias(header)) ?? -1];
  const rows: DigitalPlacementRow[] = [],
    ignored: DigitalParseResult['ignored'] = [],
    issues: DigitalIssue[] = [];
  const periods = new Map<
    string,
    { periodId: string; startDate: string; endDate: string }
  >();
  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] ?? [];
    if (!values.some((v) => normalizeText(v))) continue;
    const sourceRow = index + 1;
    const sourceFields = Object.fromEntries(
      sourceHeaders.map((h, i) => [
        h,
        (values[i] ?? null) as string | number | boolean | null,
      ]),
    );
    const profile = matchProfile(
      profiles,
      get(values, 'Cadena'),
      get(values, 'Artículo'),
    );
    if (!profile) {
      ignored.push({
        sourceRow,
        reason:
          'Ignorada por catálogo: retailer/artículo sin perfil activo exacto.',
        sourceFields,
      });
      continue;
    }
    const period = parsePeriod(
      get(values, 'Periodo Id'),
      get(values, 'Periodo'),
    );
    const mode = placementMode(get(values, 'Tipo Fijación'));
    const fixationStart = civilDate(get(values, 'Fecha Fijación')),
      fixationEnd = civilDate(get(values, 'Fecha Retirada'));
    const centers = finiteCount(get(values, 'Nº Centros')),
      supports = finiteCount(get(values, 'Nº Soportes'));
    const requiredValues = [
      'Cadena',
      'Periodo Id',
      'Periodo',
      'Artículo',
      'Campaña',
      'Línea campaña',
      'Fecha Fijación',
      'Fecha Retirada',
      'Tipo Fijación',
      'Creatividad Id',
      'Nº Centros',
      'Nº Soportes',
    ];
    for (const field of requiredValues)
      if (normalizeText(get(values, field)) === '')
        issues.push({
          sourceRow,
          code: 'missing-field',
          message: `Falta ${field}.`,
          blocking: true,
        });
    if (!period)
      issues.push({
        sourceRow,
        code: 'invalid-period',
        message: 'Periodo inválido o inconsistente con Periodo Id.',
        blocking: true,
      });
    if (!mode)
      issues.push({
        sourceRow,
        code: 'unknown-fixation',
        message: `Tipo Fijación desconocido: ${normalizeText(get(values, 'Tipo Fijación')) || '(vacío)'}.`,
        blocking: true,
      });
    if (!fixationStart || !fixationEnd)
      issues.push({
        sourceRow,
        code: 'invalid-date',
        message: 'Fecha de fijación o retirada inválida.',
        blocking: true,
      });
    if (centers == null || supports == null)
      issues.push({
        sourceRow,
        code: 'invalid-count',
        message: 'Nº Centros y Nº Soportes deben ser números no negativos.',
        blocking: true,
      });
    if (
      !period ||
      !mode ||
      !fixationStart ||
      !fixationEnd ||
      centers == null ||
      supports == null ||
      requiredValues.some((f) => normalizeText(get(values, f)) === '')
    )
      continue;
    const existing = periods.get(period.periodId);
    if (
      existing &&
      (existing.startDate !== period.startDate ||
        existing.endDate !== period.endDate)
    ) {
      issues.push({
        sourceRow,
        code: 'period-conflict',
        message: `${period.periodId} tiene fechas incompatibles.`,
        blocking: true,
      });
      continue;
    }
    periods.set(period.periodId, {
      periodId: period.periodId,
      startDate: period.startDate,
      endDate: period.endDate,
    });
    const year = period.startDate.slice(0, 4),
      campaignNumber = identifier(get(values, 'Campaña')),
      lineNumber = identifier(get(values, 'Línea campaña')),
      creativityId = identifier(get(values, 'Creatividad Id'));
    const recordKey = stableKey([
      year,
      campaignNumber,
      lineNumber,
      profile.retailerCode,
      profile.supportCode,
      creativityId,
      period.periodId,
    ]);
    const logicalFlightKey = stableKey([
      year,
      campaignNumber,
      profile.retailerCode,
      profile.supportCode,
      creativityId,
    ]);
    const comparable = sourceHeaders.map((h, i) => [
      alias(h),
      typeof values[i] === 'string'
        ? normalizeText(values[i])
        : (values[i] ?? null),
    ]);
    const fingerprint = hashText(JSON.stringify(comparable));
    rows.push({
      id: hashText(recordKey),
      recordKey,
      logicalFlightKey,
      batchId,
      sourceRow,
      year,
      retailerCode: profile.retailerCode,
      supportCode: profile.supportCode,
      profileId: profile.id,
      campaignNumber,
      lineNumber,
      periodId: period.periodId,
      periodLabel: period.periodLabel,
      periodStart: period.startDate,
      periodEnd: period.endDate,
      fixationStart,
      fixationEnd,
      placementMode: mode,
      client: normalizeText(get(values, 'Cliente')),
      advertiser: normalizeText(get(values, 'Anunciante')),
      product: normalizeText(get(values, 'Producto')),
      creativityId,
      creativityTitle: normalizeText(get(values, 'Creativitad Título')),
      creativityStatus: normalizeText(get(values, 'Creatividad Estado')),
      centers,
      supports,
      sourceFields,
      sourceHeaders,
      fingerprint,
      active: true,
      firstBatchId: batchId,
      lastBatchId: batchId,
      missingSinceBatchId: null,
      revision: 1,
      updatedAt: now,
    });
  }
  const normalizedContent = rows
    .map((r) => `${r.recordKey}:${r.fingerprint}`)
    .sort()
    .join('\n');
  return {
    sheetName: selection.name,
    sourceHeaders,
    sourceRows: matrix.slice(1).filter((r) => r.some((v) => normalizeText(v)))
      .length,
    rows,
    ignored,
    issues,
    warnings: selection.warning ? [selection.warning] : [],
    periods: [...periods.values()].sort((a, b) =>
      a.periodId.localeCompare(b.periodId),
    ),
    contentHash: hashText(normalizedContent),
  };
}

export function hasExpectedDigitalHeaders(headers: readonly string[]): boolean {
  const normalized = new Set(headers.map(alias));
  return DIGITAL_HEADERS.every((h) => normalized.has(alias(h)));
}
