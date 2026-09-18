import type { Row, Workbook, Worksheet } from 'exceljs';
import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  QUIVIDI_KPI_EXPLANATIONS,
  type QuividiCampaignReport,
  type QuividiSupportDay,
} from '@/domain';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface SupportSummary {
  support: string;
  coveragePercent: number;
  measurementPercent: number;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionRate: number;
  attentionSeconds: number;
  dwellSeconds: number;
  incidents: number;
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, '_').trim() || 'campana';
}

function scopeSourceLabel(
  source: QuividiCampaignReport['scopeOrigins'][number]['source'],
): string {
  switch (source) {
    case 'calendar-selected':
      return 'Calendario Liverpool · Tiendas explícitas';
    case 'calendar-all':
      return 'Calendario Liverpool · Todas';
    case 'calendar-full-circuit':
      return 'Calendario Liverpool · Circuito completo';
    case 'ekon':
      return 'EKON · Cocomercialización';
    default:
      return 'Sin alcance resoluble';
  }
}

function reportScopeLabel(report: QuividiCampaignReport): string {
  const labels = Array.from(
    new Set(
      report.scopeOrigins
        .filter((origin) => origin.pairCount > 0)
        .map((origin) => scopeSourceLabel(origin.source)),
    ),
  );
  return labels.length > 0 ? labels.join(' + ') : 'Sin alcance resoluble';
}

function weightedTime(
  rows: readonly QuividiSupportDay[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number {
  const totalWatchers = rows.reduce((sum, row) => sum + row.watchers, 0);
  if (totalWatchers <= 0) return 0;
  return (
    rows.reduce((sum, row) => sum + row[field] * row.watchers, 0) /
    totalWatchers
  );
}

function supportSummaries(report: QuividiCampaignReport): SupportSummary[] {
  return report.coverage.bySupport.map((coverage) => {
    const rows = report.supportDays.filter(
      (row) => row.support === coverage.support,
    );
    const ots = rows.reduce((sum, row) => sum + row.ots, 0);
    const effectiveOts = rows.reduce((sum, row) => sum + row.effectiveOts, 0);
    const watchers = rows.reduce((sum, row) => sum + row.watchers, 0);
    const measured = rows.filter((row) => row.status !== 'missing').length;
    const incidents = report.incidents
      .filter((incident) => incident.support === coverage.support)
      .reduce((sum, incident) => sum + incident.dates.length, 0);
    return {
      support: coverage.support,
      coveragePercent: coverage.percent,
      measurementPercent: rows.length > 0 ? (measured / rows.length) * 100 : 0,
      ots,
      effectiveOts,
      watchers,
      attentionRate: ots > 0 ? (watchers / ots) * 100 : 0,
      attentionSeconds: weightedTime(rows, 'attentionSeconds'),
      dwellSeconds: weightedTime(rows, 'dwellSeconds'),
      incidents,
    };
  });
}

function styleTitle(sheet: Worksheet, range: string): void {
  const cells = sheet.getCell(range.split(':')[0]!);
  cells.font = { bold: true, size: 20, color: { argb: 'FFFFFFFF' } };
  cells.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF15324B' },
  };
  cells.alignment = { vertical: 'middle' };
}

function styleSection(row: Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF315B7D' },
  };
}

function styleHeader(row: Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4B6F8C' },
  };
  row.alignment = { vertical: 'middle', wrapText: true };
}

function applyBaseSheet(sheet: Worksheet): void {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.properties.defaultRowHeight = 18;
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top' };
  });
}

function numberFormat(sheet: Worksheet, column: string, format: string): void {
  sheet.getColumn(column).numFmt = format;
}

function addDashboard(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Dashboard', {
    views: [{ showGridLines: false }],
  });
  sheet.mergeCells('A1:J2');
  sheet.getCell('A1').value = 'QUIVIDI · REPORTE DE AUDIENCIA';
  styleTitle(sheet, 'A1:J2');
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 12;

  sheet.mergeCells('A3:J3');
  sheet.getCell('A3').value =
    `${report.campaignName} · ${report.startDate} a ${report.endDate}`;
  sheet.getCell('A3').font = { bold: true, size: 12 };

  sheet.mergeCells('A4:J4');
  sheet.getCell('A4').value = `Origen del alcance: ${reportScopeLabel(report)}`;
  sheet.getCell('A4').font = { italic: true, color: { argb: 'FF5A6670' } };

  const measuredDays = report.supportDays.filter(
    (row) => row.status !== 'missing',
  ).length;
  const measurementPercent =
    report.supportDays.length > 0
      ? (measuredDays / report.supportDays.length) * 100
      : 0;
  const incidentDays = report.incidents.reduce(
    (sum, incident) => sum + incident.dates.length,
    0,
  );

  const cards = [
    ['Cobertura Quividi', report.coverage.percent / 100, '0.0%'],
    ['Cobertura medición', measurementPercent / 100, '0.0%'],
    [
      'Soportes con medición',
      report.coverage.bySupport.filter((s) => s.mappedPairs > 0).length,
      '0',
    ],
    ['Días con incidencia', incidentDays, '0'],
  ] as const;
  cards.forEach(([label, value, fmt], index) => {
    const start = 1 + index * 2;
    const end = start + 1;
    sheet.mergeCells(5, start, 5, end);
    sheet.mergeCells(6, start, 7, end);
    const labelCell = sheet.getCell(5, start);
    const valueCell = sheet.getCell(6, start);
    labelCell.value = label;
    labelCell.font = { bold: true, color: { argb: 'FF5A6670' } };
    labelCell.alignment = { horizontal: 'center' };
    valueCell.value = value;
    valueCell.numFmt = fmt;
    valueCell.font = { bold: true, size: 18, color: { argb: 'FF15324B' } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let row = 5; row <= 7; row += 1) {
      for (let col = start; col <= end; col += 1) {
        sheet.getCell(row, col).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF3F6F8' },
        };
      }
    }
  });

  sheet.mergeCells('A9:J9');
  sheet.getCell('A9').value = 'Resultados por soporte';
  styleSection(sheet.getRow(9));

  const headers = [
    'Soporte',
    'Cobertura',
    'Cob. medición',
    'OTS ponderado',
    'Effective OTS',
    'Watchers',
    'Tasa atención',
    'Attention Time',
    'Dwell Time',
    'Incidencias',
  ];
  sheet.addRow(headers);
  styleHeader(sheet.getRow(10));
  for (const summary of supportSummaries(report)) {
    sheet.addRow([
      summary.support,
      summary.coveragePercent / 100,
      summary.measurementPercent / 100,
      summary.ots,
      summary.effectiveOts,
      summary.watchers,
      summary.attentionRate / 100,
      summary.attentionSeconds,
      summary.dwellSeconds,
      summary.incidents,
    ]);
  }
  const summaryEnd = 10 + report.coverage.bySupport.length;
  sheet.getColumn(2).numFmt = '0.0%';
  sheet.getColumn(3).numFmt = '0.0%';
  sheet.getColumn(4).numFmt = '#,##0';
  sheet.getColumn(5).numFmt = '#,##0';
  sheet.getColumn(6).numFmt = '#,##0';
  sheet.getColumn(7).numFmt = '0.0%';
  sheet.getColumn(8).numFmt = '0.0 "s"';
  sheet.getColumn(9).numFmt = '0.0 "s"';

  const defsStart = summaryEnd + 3;
  sheet.mergeCells(defsStart, 1, defsStart, 10);
  sheet.getCell(defsStart, 1).value = 'Cómo leer los indicadores';
  styleSection(sheet.getRow(defsStart));
  const definitions: Array<[string, string]> = [
    ['OTS', QUIVIDI_KPI_EXPLANATIONS.ots],
    ['Effective OTS', QUIVIDI_KPI_EXPLANATIONS.effectiveOts],
    ['Watchers', QUIVIDI_KPI_EXPLANATIONS.watchers],
    ['Tasa de atención', QUIVIDI_KPI_EXPLANATIONS.attentionRate],
    ['Attention Time', QUIVIDI_KPI_EXPLANATIONS.attentionTime],
    ['Dwell Time', QUIVIDI_KPI_EXPLANATIONS.dwellTime],
    ['Cobertura Quividi', QUIVIDI_KPI_EXPLANATIONS.coverage],
    ['Cobertura de medición', QUIVIDI_KPI_EXPLANATIONS.measurementCoverage],
    ['Demografía', QUIVIDI_KPI_EXPLANATIONS.demographics],
  ];
  definitions.forEach(([name, description], offset) => {
    const row = defsStart + 1 + offset;
    sheet.getCell(row, 1).value = name;
    sheet.getCell(row, 1).font = { bold: true };
    sheet.mergeCells(row, 2, row, 10);
    sheet.getCell(row, 2).value = description;
    sheet.getCell(row, 2).alignment = { wrapText: true };
  });

  const qualityStart = defsStart + definitions.length + 2;
  sheet.mergeCells(qualityStart, 1, qualityStart, 10);
  sheet.getCell(qualityStart, 1).value = 'Calidad de medición';
  styleSection(sheet.getRow(qualityStart));
  let cursor = qualityStart + 1;
  if (report.incidents.length === 0) {
    sheet.mergeCells(cursor, 1, cursor, 10);
    sheet.getCell(cursor, 1).value =
      'Sin incidencias de medición detectadas durante el periodo.';
  } else {
    for (const incident of report.incidents.slice(0, 12)) {
      sheet.mergeCells(cursor, 1, cursor, 10);
      sheet.getCell(cursor, 1).value =
        `${incident.status === 'missing' ? 'Sin medición' : 'Medición parcial'} · ${incident.storeNumber} ${incident.storeName} · ${incident.support} · ${incident.locationName} · ${incident.dates.length} día(s): ${incident.dates.join(', ')}`;
      sheet.getCell(cursor, 1).alignment = { wrapText: true };
      cursor += 1;
    }
    if (report.incidents.length > 12) {
      sheet.mergeCells(cursor, 1, cursor, 10);
      sheet.getCell(cursor, 1).value =
        'Consulta la hoja “Calidad medición” para ver todas las incidencias.';
    }
  }

  sheet.columns = [
    { width: 28 },
    { width: 14 },
    { width: 15 },
    { width: 17 },
    { width: 17 },
    { width: 16 },
    { width: 16 },
    { width: 17 },
    { width: 16 },
    { width: 16 },
  ];
}

function addScopeDetail(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Alcance');
  sheet.addRow([
    'Soporte',
    'Origen del alcance',
    '# campaña EKON',
    'Pares Tienda + Soporte',
  ]);
  styleHeader(sheet.getRow(1));
  for (const origin of report.scopeOrigins) {
    sheet.addRow([
      origin.support,
      scopeSourceLabel(origin.source),
      origin.ekonNumber ?? '',
      origin.pairCount,
    ]);
  }
  sheet.columns = [
    { width: 28 },
    { width: 42 },
    { width: 18 },
    { width: 22 },
  ];
  applyBaseSheet(sheet);
}

function addSupportDetail(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Detalle Soportes');
  sheet.addRow([
    'Fecha',
    'Tienda',
    'Nombre tienda',
    'Soporte',
    'Cámaras config.',
    'Cámaras usadas',
    'Estado',
    'OTS ponderado',
    'Effective OTS',
    'Watchers',
    'Tasa atención',
    'Attention Time',
    'Dwell Time',
  ]);
  styleHeader(sheet.getRow(1));
  for (const row of report.supportDays) {
    sheet.addRow([
      row.date,
      row.storeNumber,
      row.storeName,
      row.support,
      row.configuredCameras,
      row.measuredCameras,
      row.status === 'complete'
        ? 'Completa'
        : row.status === 'partial'
          ? 'Parcial'
          : 'Sin medición',
      row.ots,
      row.effectiveOts,
      row.watchers,
      row.ots > 0 ? row.watchers / row.ots : 0,
      row.attentionSeconds,
      row.dwellSeconds,
    ]);
  }
  numberFormat(sheet, 'H', '#,##0');
  numberFormat(sheet, 'I', '#,##0');
  numberFormat(sheet, 'J', '#,##0');
  numberFormat(sheet, 'K', '0.0%');
  numberFormat(sheet, 'L', '0.0 "s"');
  numberFormat(sheet, 'M', '0.0 "s"');
  sheet.columns = [
    { width: 12 },
    { width: 10 },
    { width: 25 },
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 15 },
    { width: 16 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
  ];
  applyBaseSheet(sheet);
}

function addCameraDetail(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Cámaras');
  sheet.addRow([
    'Fecha',
    'Tienda',
    'Nombre tienda',
    'Soporte',
    'Location ID',
    'Box ID',
    'Site ID',
    'Location',
    'Estado día',
    'Duración (h)',
    'OTS',
    'Effective OTS',
    'Watchers',
    'Attention acum. (s)',
    'Dwell acum. (s)',
    'Active',
    'Last seen',
  ]);
  styleHeader(sheet.getRow(1));
  for (const row of report.cameraDays) {
    sheet.addRow([
      row.date,
      row.storeNumber,
      row.storeName,
      row.support,
      row.locationId,
      row.boxId,
      row.siteId,
      row.locationName,
      row.status === 'complete'
        ? 'Completa'
        : row.status === 'partial'
          ? 'Parcial'
          : 'Sin medición',
      row.durationSeconds / 3600,
      row.ots,
      row.effectiveOts,
      row.watchers,
      row.attentionTenths / 10,
      row.dwellTenths / 10,
      row.active ? 'Sí' : 'No',
      row.lastSeen ?? '',
    ]);
  }
  numberFormat(sheet, 'J', '0.0');
  numberFormat(sheet, 'K', '#,##0');
  numberFormat(sheet, 'L', '#,##0');
  numberFormat(sheet, 'M', '#,##0');
  numberFormat(sheet, 'N', '#,##0.0');
  numberFormat(sheet, 'O', '#,##0.0');
  sheet.columns = [
    { width: 12 },
    { width: 10 },
    { width: 24 },
    { width: 25 },
    { width: 13 },
    { width: 12 },
    { width: 12 },
    { width: 38 },
    { width: 16 },
    { width: 14 },
    { width: 13 },
    { width: 16 },
    { width: 13 },
    { width: 18 },
    { width: 18 },
    { width: 10 },
    { width: 20 },
  ];
  applyBaseSheet(sheet);
}

function addDemographics(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Demografía');
  sheet.addRow([
    'Fecha',
    'Tienda',
    'Nombre tienda',
    'Soporte',
    'Género estimado',
    'Edad estimada',
    'Watchers ponderados',
  ]);
  styleHeader(sheet.getRow(1));
  for (const row of report.demographics) {
    sheet.addRow([
      row.date,
      row.storeNumber,
      row.storeName,
      row.support,
      QUIVIDI_GENDER_LABELS[row.gender] ?? `Código ${row.gender}`,
      QUIVIDI_AGE_LABELS[row.age] ?? `Código ${row.age}`,
      row.watchers,
    ]);
  }
  numberFormat(sheet, 'G', '#,##0.0');
  sheet.columns = [
    { width: 12 },
    { width: 10 },
    { width: 25 },
    { width: 26 },
    { width: 20 },
    { width: 24 },
    { width: 20 },
  ];
  applyBaseSheet(sheet);
}

function addQuality(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Calidad medición');
  sheet.addRow([
    'Tienda',
    'Nombre tienda',
    'Soporte',
    'Location ID',
    'Cámara',
    'Incidencia',
    'Días afectados',
    'Fechas',
  ]);
  styleHeader(sheet.getRow(1));
  for (const incident of report.incidents) {
    sheet.addRow([
      incident.storeNumber,
      incident.storeName,
      incident.support,
      incident.locationId,
      incident.locationName,
      incident.status === 'missing' ? 'Sin medición' : 'Medición parcial',
      incident.dates.length,
      incident.dates.join(', '),
    ]);
  }
  if (report.unmappedCameraNames.length > 0) {
    sheet.addRow([]);
    const row = sheet.addRow(['Cámaras sin correspondencia en Topology']);
    row.font = { bold: true };
    for (const camera of report.unmappedCameraNames) sheet.addRow([camera]);
  }
  sheet.columns = [
    { width: 10 },
    { width: 25 },
    { width: 26 },
    { width: 14 },
    { width: 40 },
    { width: 18 },
    { width: 14 },
    { width: 55 },
  ];
  applyBaseSheet(sheet);
}

function addMethodology(wb: Workbook): void {
  const sheet = wb.addWorksheet('Metodología', {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [{ width: 26 }, { width: 90 }];
  sheet.addRow(['Concepto', 'Explicación']);
  styleHeader(sheet.getRow(1));
  const rows: Array<[string, string]> = [
    ['OTS', QUIVIDI_KPI_EXPLANATIONS.ots],
    ['Effective OTS', QUIVIDI_KPI_EXPLANATIONS.effectiveOts],
    ['Watchers', QUIVIDI_KPI_EXPLANATIONS.watchers],
    ['Tasa de atención', QUIVIDI_KPI_EXPLANATIONS.attentionRate],
    ['Attention Time', QUIVIDI_KPI_EXPLANATIONS.attentionTime],
    ['Dwell Time', QUIVIDI_KPI_EXPLANATIONS.dwellTime],
    ['Demografía', QUIVIDI_KPI_EXPLANATIONS.demographics],
    [
      'Varias cámaras',
      'Cuando un mismo soporte tiene varias cámaras, se promedian día a día sólo las cámaras con medición válida. No se suman como personas únicas.',
    ],
    [
      'Cámara caída',
      'Si una cámara no tiene medición y otra sí, ese día se usa la cámara disponible y se deja registrada la incidencia.',
    ],
    [
      'Medición parcial',
      'SIGNAM marca como parcial un día cuya duración medida cae de forma relevante respecto a la duración habitual de esa misma cámara. No se extrapolan datos faltantes.',
    ],
    [
      'Resultados por soporte',
      'Mupi, Banner y otros soportes se muestran por separado para evitar sumar contactos que pueden pertenecer a la misma persona.',
    ],
    [
      'Origen del alcance',
      'Si Liverpool detalla tiendas, se usan esas tiendas. Sin comentario, CRIUS y Poster LED usan circuito completo; los demás soportes pueden completar tiendas desde EKON por vigencia y circuito compatible.',
    ],
  ];
  for (const row of rows) sheet.addRow(row);
  sheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  applyBaseSheet(sheet);
}

export async function buildQuividiCampaignWorkbook(
  report: QuividiCampaignReport,
): Promise<Workbook> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SIGNAM';
  wb.subject = 'Reporte de audiencia Quividi por campaña';
  addDashboard(wb, report);
  addScopeDetail(wb, report);
  addSupportDetail(wb, report);
  addCameraDetail(wb, report);
  addDemographics(wb, report);
  addQuality(wb, report);
  addMethodology(wb);
  return wb;
}

export async function buildQuividiCampaignBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const wb = await buildQuividiCampaignWorkbook(report);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

export function quividiCampaignFileName(
  report: Pick<QuividiCampaignReport, 'campaignName' | 'startDate' | 'endDate'>,
): string {
  return `Quividi_${safeFileName(report.campaignName)}_${report.startDate}_${report.endDate}.xlsx`;
}
