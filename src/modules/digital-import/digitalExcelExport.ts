import type {
  DigitalImportBatch,
  DigitalImportResolution,
  DigitalOperationalItem,
  DigitalOperationalTracking,
  DigitalPlacementRow,
} from '@/domain/digital-operations';
export interface DigitalExcelInput {
  batch: DigitalImportBatch;
  rows: readonly DigitalPlacementRow[];
  items: readonly DigitalOperationalItem[];
  tracking: readonly DigitalOperationalTracking[];
  resolutions: readonly DigitalImportResolution[];
  issues: readonly { sourceRow: number; code: string; message: string }[];
}
export async function buildDigitalExcel(input: DigitalExcelInput) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIGNAM V2';
  const tracking = new Map(input.tracking.map((t) => [t.id, t]));
  const summary = workbook.addWorksheet('Resumen catorcena', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const summaryHeaders = [
    'Retailer',
    'Periodo ID',
    'Catorcena',
    'Inicio catorcena',
    'Fin catorcena',
    'Campaña EKON',
    'Cliente',
    'Anunciante',
    'Producto',
    'Soporte',
    'Creatividad ID',
    'Creatividad título',
    'Creatividad estado',
    'Fecha fijación',
    'Fecha retirada',
    'Continua/Fijación',
    'Nº centros',
    'Nº soportes',
    'Número de líneas EKON',
    'Estado operativo',
    'Link',
    'Validación cadena',
    'Programación CMS',
    'Avance',
  ];
  summary.addRow(summaryHeaders);
  for (const i of input.items) {
    const t = tracking.get(i.id),
      checks = t?.checks,
      done = checks
        ? Object.values(checks).filter((c) => c.completed).length
        : 0;
    summary.addRow([
      i.retailerLabel,
      i.periodId,
      i.periodLabel,
      new Date(`${i.periodStart}T00:00:00Z`),
      new Date(`${i.periodEnd}T00:00:00Z`),
      i.campaignNumber,
      i.client,
      i.advertiser,
      i.product,
      i.supportLabel,
      i.creativityId,
      i.creativityTitle,
      i.creativityStatus,
      new Date(`${i.fixationStart}T00:00:00Z`),
      new Date(`${i.fixationEnd}T00:00:00Z`),
      i.placementMode === 'fixation' ? 'Fijación' : 'Continua',
      i.centers,
      i.supports,
      i.placementRowIds.length,
      t?.lifecycleStatus === 'cancelled' ? 'Cancelada' : 'Activa',
      checks?.downloadLink.completed ? 'Sí' : 'No',
      checks?.retailerValidation.completed ? 'Sí' : 'No',
      checks?.cmsProgramming.completed ? 'Sí' : 'No',
      t?.lifecycleStatus === 'cancelled' ? 'No aplica' : done / 3,
    ]);
  }
  const detail = workbook.addWorksheet('Detalle EKON', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const original = input.rows[0]?.sourceHeaders ?? [];
  detail.addRow([
    ...original,
    'Clasificación SIGNAM',
    'Retailer canónico',
    'Soporte canónico',
    'ID elemento operativo',
    'Fila origen',
    'Tratamiento duplicado',
  ]);
  const itemByRow = new Map(
    input.items.flatMap((item) =>
      item.placementRowIds.map((id) => [id, item.id] as const),
    ),
  );
  for (const row of input.rows)
    detail.addRow([
      ...original.map((h) => row.sourceFields[h] ?? null),
      row.placementMode === 'fixation' ? 'Fijación' : 'Continua',
      row.retailerCode,
      row.supportCode,
      itemByRow.get(row.id) ?? '',
      String(row.sourceRow),
      input.resolutions.some((r) =>
        r.rowIndexes.includes(input.rows.indexOf(row)),
      )
        ? 'Resolución confirmada'
        : 'Sin duplicado',
    ]);
  const issues = workbook.addWorksheet('Incidencias', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  issues.addRow(['Fila origen', 'Tipo', 'Descripción', 'Resolución']);
  for (const issue of input.issues)
    issues.addRow([issue.sourceRow, issue.code, issue.message, '']);
  for (const resolution of input.resolutions)
    issues.addRow([
      resolution.rowIndexes.join(', '),
      resolution.kind,
      resolution.differentFields.join(', '),
      resolution.action,
    ]);
  const metadata = workbook.addWorksheet('Metadatos');
  metadata.addRows([
    ['Campo', 'Valor'],
    ['ID de lote', input.batch.id],
    ['Archivo', input.batch.fileName],
    ['Hash', input.batch.contentHash],
    ['Usuario importador', input.batch.createdByEmail],
    ['Fecha', new Date(input.batch.createdAt)],
    ['Periodos confirmados', input.batch.confirmedPeriodIds.join(', ')],
    ['Perfiles usados', input.batch.catalogProfileIds.join(', ')],
    ['Totales', JSON.stringify(input.batch.totals)],
    ['Versión de esquema', input.batch.schemaVersion],
  ]);
  for (const sheet of workbook.worksheets) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: {
        row: Math.max(1, sheet.rowCount),
        column: Math.max(1, sheet.columnCount),
      },
    };
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { wrapText: true };
    sheet.columns.forEach((c) => {
      c.width = Math.min(
        40,
        Math.max(
          12,
          ...(c.values ?? []).slice(1).map((v) => String(v ?? '').length + 2),
        ),
      );
      c.alignment = { vertical: 'top', wrapText: true };
    });
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
      }),
    );
  }
  return workbook.xlsx.writeBuffer();
}
export function digitalExcelFileName(
  periodIds: readonly string[],
  year: string,
) {
  const periods = [...periodIds].sort().join('-') || 'Sin_periodo';
  return `Operacion_Digital_${periods}_${year}.xlsx`;
}
export function downloadDigitalExcel(buffer: unknown, fileName: string) {
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
