import type {
  DigitalOperationalItem,
  DigitalOperationalTracking,
} from '@/domain/digital-operations';
import { digitalPeriodKey } from './digitalOperationsView';

const HEADERS = [
  'Cadena',
  'Cliente',
  'Anunciante',
  'Campaña',
  'Fecha Fijación',
  'Fecha Retirada',
  'Creatividad Id',
  'Pasillo',
  'Arte',
  'Comentarios',
] as const;

const SHEETS = [
  { retailerCode: 'CHEDRAUI', name: 'CHEDRAUI', color: 'ED7D31' },
  { retailerCode: 'LA_COMER', name: 'LACOMER', color: 'C00000' },
] as const;

export interface DigitalWorkPaperInput {
  items: readonly DigitalOperationalItem[];
  tracking: readonly DigitalOperationalTracking[];
  periodKey: string;
}

function excelDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatCommentDate(value: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function commentsCell(tracking: DigitalOperationalTracking): string {
  return tracking.comments
    .map(
      (comment) =>
        `${formatCommentDate(comment.createdAt)} · ${comment.createdByEmail} — ${comment.text}`,
    )
    .join('\n');
}

export function eligibleDigitalWorkPaperItems(input: DigitalWorkPaperInput) {
  const trackingById = new Map(
    input.tracking.map((entry) => [entry.operationalItemId, entry]),
  );
  return input.items
    .filter((item) => {
      const itemTracking = trackingById.get(item.id);
      return (
        digitalPeriodKey(item) === input.periodKey &&
        item.active &&
        itemTracking?.lifecycleStatus === 'active'
      );
    })
    .sort(
      (left, right) =>
        left.client.localeCompare(right.client, 'es') ||
        left.advertiser.localeCompare(right.advertiser, 'es') ||
        left.campaignNumber.localeCompare(right.campaignNumber, 'es', {
          numeric: true,
        }),
    );
}

export async function buildDigitalWorkPaper(input: DigitalWorkPaperInput) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIGNAM V2';
  const trackingById = new Map(
    input.tracking.map((entry) => [entry.operationalItemId, entry]),
  );
  const eligible = eligibleDigitalWorkPaperItems(input);

  for (const definition of SHEETS) {
    const worksheet = workbook.addWorksheet(definition.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    worksheet.columns = [
      {
        width: definition.retailerCode === 'CHEDRAUI' ? 9.54296875 : 11.453125,
      },
      { width: 38.26953125 },
      { width: 13.7265625 },
      { width: 8.5 },
      { width: 12.453125 },
      { width: 13.1796875 },
      { width: 12.453125 },
      { width: 12.26953125 },
      { width: 80.6328125 },
      { width: 11.54296875 },
    ];
    const header = worksheet.addRow([...HEADERS]);
    header.height = 30;
    header.font = {
      name: 'Calibri',
      size: 11,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${definition.color}` },
    };
    header.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };

    for (const item of eligible.filter(
      (entry) => entry.retailerCode === definition.retailerCode,
    )) {
      const itemTracking = trackingById.get(item.id)!;
      const row = worksheet.addRow([
        item.retailerLabel,
        item.client,
        item.advertiser,
        item.campaignNumber,
        excelDate(item.fixationStart),
        excelDate(item.fixationEnd),
        item.creativityId,
        item.product,
        '',
        commentsCell(itemTracking),
      ]);
      row.height = 30;
      row.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      for (const column of [1, 2, 4, 6])
        row.getCell(column).font = { bold: true };
      for (const column of [5, 6]) row.getCell(column).numFmt = 'yyyy-mm-dd';
    }

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, worksheet.rowCount), column: HEADERS.length },
    };
  }

  return workbook.xlsx.writeBuffer();
}

export function digitalWorkPaperFileName(periodId: string): string {
  return `Papel de trabajo - ${periodId} operadores.xlsx`;
}

export function downloadDigitalWorkPaper(buffer: unknown, fileName: string) {
  const blob = new Blob([buffer as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
