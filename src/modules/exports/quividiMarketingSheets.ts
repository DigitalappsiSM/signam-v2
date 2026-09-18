import type { Cell, Row, Workbook, Worksheet } from 'exceljs';
import {
  QUIVIDI_AGE_LABELS,
  QUIVIDI_GENDER_LABELS,
  type QuividiCampaignReport,
} from '@/domain';
import {
  ageSummaries,
  dailySummaries,
  genderSummaries,
  heatmapCells,
  hourRange,
  hourSummaries,
  overallSummary,
  peakMoments,
  qualitySummary,
  storeSummaries,
  timeBandSummaries,
  weekdaySummaries,
} from './quividiMarketingAnalytics';

const COLORS = {
  navy: 'FF092A4A',
  navy2: 'FF133F67',
  blue: 'FF1479D1',
  cyan: 'FF2DA9F7',
  sky: 'FFEAF5FD',
  pale: 'FFF4F8FB',
  white: 'FFFFFFFF',
  text: 'FF102A43',
  muted: 'FF61788C',
  line: 'FFD7E3EC',
  green: 'FF13A36F',
  greenPale: 'FFE8F7F1',
  orange: 'FFF59E0B',
  orangePale: 'FFFFF5DE',
  red: 'FFE5484D',
  redPale: 'FFFFEAEB',
  pink: 'FFE94583',
  purple: 'FF7B61D1',
} as const;

const HEAT = [
  'FFF7FBFF',
  'FFE3F2FD',
  'FFB9DDF7',
  'FF83C3F1',
  'FF3F9CE3',
  'FF1267AC',
  'FF073B66',
] as const;

function fill(cell: Cell, color: string): void {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: color },
  };
}

function thinBorder(cell: Cell, color = COLORS.line): void {
  cell.border = {
    top: { style: 'thin', color: { argb: color } },
    left: { style: 'thin', color: { argb: color } },
    bottom: { style: 'thin', color: { argb: color } },
    right: { style: 'thin', color: { argb: color } },
  };
}

function setColumns(sheet: Worksheet, widths: number[]): void {
  sheet.columns = widths.map((width) => ({ width }));
}

function baseSheet(sheet: Worksheet, freezeRows = 0): void {
  sheet.views = [{ state: 'frozen', ySplit: freezeRows, showGridLines: false }];
  sheet.properties.defaultRowHeight = 19;
  sheet.headerFooter.oddFooter =
    '&LIn-Store Media · Inteligencia de Audiencia&C&P de &N&RQuividi';
}

function styleHeader(row: Row): void {
  row.font = { bold: true, color: { argb: COLORS.white } };
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLORS.navy2 },
  };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 24;
}

function sectionTitle(
  sheet: Worksheet,
  row: number,
  from: number,
  to: number,
  title: string,
): void {
  sheet.mergeCells(row, from, row, to);
  const cell = sheet.getCell(row, from);
  cell.value = title;
  cell.font = { bold: true, size: 12, color: { argb: COLORS.white } };
  cell.alignment = { vertical: 'middle' };
  fill(cell, COLORS.navy2);
  sheet.getRow(row).height = 24;
}

function barText(value: number, max: number, width = 14): string {
  if (max <= 0 || value <= 0) return '░'.repeat(width);
  const filled = Math.max(1, Math.round((value / max) * width));
  return (
    '█'.repeat(Math.min(width, filled)) +
    '░'.repeat(Math.max(0, width - filled))
  );
}

function heatColor(value: number, max: number): string {
  if (max <= 0 || value <= 0) return HEAT[0];
  const ratio = Math.min(1, value / max);
  const index = Math.min(
    HEAT.length - 1,
    Math.max(1, Math.ceil(ratio * (HEAT.length - 1))),
  );
  return HEAT[index];
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

function addKpiCard(
  sheet: Worksheet,
  startColumn: number,
  label: string,
  value: number,
  format: string,
  note: string,
): void {
  const endColumn = startColumn + 1;
  sheet.mergeCells(6, startColumn, 6, endColumn);
  sheet.mergeCells(7, startColumn, 8, endColumn);
  sheet.mergeCells(9, startColumn, 9, endColumn);
  for (let row = 6; row <= 9; row += 1) {
    for (let col = startColumn; col <= endColumn; col += 1) {
      const cell = sheet.getCell(row, col);
      fill(cell, COLORS.white);
      thinBorder(cell);
    }
  }
  const labelCell = sheet.getCell(6, startColumn);
  labelCell.value = label;
  labelCell.font = { bold: true, color: { argb: COLORS.navy2 }, size: 10 };
  labelCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const valueCell = sheet.getCell(7, startColumn);
  valueCell.value = value;
  valueCell.numFmt = format;
  valueCell.font = { bold: true, color: { argb: COLORS.navy }, size: 20 };
  valueCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const noteCell = sheet.getCell(9, startColumn);
  noteCell.value = note;
  noteCell.font = { color: { argb: COLORS.muted }, size: 8 };
  noteCell.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
}

function addDashboard(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Dashboard Ejecutivo');
  setColumns(
    sheet,
    Array.from({ length: 12 }, () => 13),
  );
  baseSheet(sheet);
  sheet.sheetProperties.tabColor = { argb: COLORS.navy };

  sheet.mergeCells('A1:L3');
  const title = sheet.getCell('A1');
  title.value = 'in-Store Media  |  REPORTE DE AUDIENCIA';
  title.font = { bold: true, size: 23, color: { argb: COLORS.white } };
  title.alignment = { vertical: 'middle', horizontal: 'left' };
  fill(title, COLORS.navy);

  sheet.mergeCells('A4:L4');
  const campaign = sheet.getCell('A4');
  campaign.value =
    report.campaignName + '  |  ' + report.startDate + ' a ' + report.endDate;
  campaign.font = { bold: true, size: 13, color: { argb: COLORS.navy } };

  sheet.mergeCells('A5:L5');
  const source = sheet.getCell('A5');
  source.value =
    'Liverpool · ' +
    reportScopeLabel(report) +
    ' · Horarios: periodos reportados por VidiCenter según configuración de cada ubicación';
  source.font = { italic: true, size: 9, color: { argb: COLORS.muted } };
  source.alignment = { wrapText: true };

  const overall = overallSummary(report);
  addKpiCard(
    sheet,
    1,
    'OTS',
    overall.ots,
    '#,##0',
    'Oportunidades de exposición',
  );
  addKpiCard(
    sheet,
    3,
    'Watchers',
    overall.watchers,
    '#,##0',
    'Detecciones con mirada a pantalla',
  );
  addKpiCard(
    sheet,
    5,
    'Tasa de atención',
    overall.attentionRate / 100,
    '0.0%',
    'Watchers / OTS',
  );
  addKpiCard(
    sheet,
    7,
    'Attention Time',
    overall.attentionSeconds,
    '0.0 "s"',
    'Promedio ponderado por Watchers',
  );
  addKpiCard(
    sheet,
    9,
    'Cobertura medición',
    overall.measurementPercent / 100,
    '0.0%',
    'Pares soporte-día con datos',
  );
  addKpiCard(
    sheet,
    11,
    'Tiendas medidas',
    overall.storeCount,
    '0',
    'Con al menos una medición',
  );

  const stores = storeSummaries(report);
  const bySupport = new Map<string, number>();
  for (const row of report.supportDays) {
    bySupport.set(row.support, (bySupport.get(row.support) ?? 0) + row.ots);
  }
  const supports = Array.from(bySupport, ([support, ots]) => ({
    support,
    ots,
  })).sort((a, b) => b.ots - a.ots);
  const maxSupport = Math.max(0, ...supports.map((item) => item.ots));
  const maxStore = Math.max(0, ...stores.slice(0, 5).map((item) => item.ots));

  sectionTitle(sheet, 11, 1, 6, 'AUDIENCIA POR SOPORTE');
  sectionTitle(sheet, 11, 7, 12, 'DISTRIBUCIÓN POR TIENDA · TOP 5');
  for (let index = 0; index < 5; index += 1) {
    const row = 12 + index;
    const support = supports[index];
    if (support) {
      sheet.mergeCells(row, 1, row, 2);
      sheet.getCell(row, 1).value = support.support;
      sheet.getCell(row, 1).font = { bold: true, color: { argb: COLORS.text } };
      sheet.getCell(row, 3).value = support.ots;
      sheet.getCell(row, 3).numFmt = '#,##0';
      sheet.mergeCells(row, 4, row, 6);
      sheet.getCell(row, 4).value = barText(support.ots, maxSupport, 18);
      sheet.getCell(row, 4).font = { color: { argb: COLORS.blue } };
    }
    const store = stores[index];
    if (store) {
      sheet.mergeCells(row, 7, row, 8);
      sheet.getCell(row, 7).value =
        store.storeNumber + ' · ' + (store.storeName || 'Tienda');
      sheet.getCell(row, 7).font = { bold: true, color: { argb: COLORS.text } };
      sheet.getCell(row, 9).value = store.ots;
      sheet.getCell(row, 9).numFmt = '#,##0';
      sheet.getCell(row, 10).value =
        overall.ots > 0 ? store.ots / overall.ots : 0;
      sheet.getCell(row, 10).numFmt = '0.0%';
      sheet.mergeCells(row, 11, row, 12);
      sheet.getCell(row, 11).value = barText(store.ots, maxStore, 12);
      sheet.getCell(row, 11).font = { color: { argb: COLORS.cyan } };
    }
  }

  const base = 18;
  sectionTitle(sheet, base, 1, 6, 'AUDIENCIA POR DÍA DE LA SEMANA');
  sectionTitle(sheet, base, 7, 9, 'MOMENTOS DE MAYOR OPORTUNIDAD');
  sectionTitle(sheet, base, 10, 12, 'DISTRIBUCIÓN POR FRANJA');
  const weekdays = weekdaySummaries(report);
  const maxWeekday = Math.max(0, ...weekdays.map((item) => item.ots));
  weekdays.forEach((item, index) => {
    const row = base + 1 + index;
    sheet.getCell(row, 1).value = item.label;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: COLORS.text } };
    sheet.getCell(row, 2).value = item.ots;
    sheet.getCell(row, 2).numFmt = '#,##0';
    sheet.getCell(row, 3).value = item.watchers;
    sheet.getCell(row, 3).numFmt = '#,##0';
    sheet.getCell(row, 4).value = item.attentionRate / 100;
    sheet.getCell(row, 4).numFmt = '0.0%';
    sheet.mergeCells(row, 5, row, 6);
    sheet.getCell(row, 5).value = barText(item.ots, maxWeekday, 14);
    sheet.getCell(row, 5).font = { color: { argb: COLORS.blue } };
  });

  peakMoments(report, 3).forEach((item, index) => {
    const row = base + 1 + index * 2;
    sheet.getCell(row, 7).value = index + 1;
    sheet.getCell(row, 7).font = {
      bold: true,
      size: 16,
      color: { argb: COLORS.white },
    };
    sheet.getCell(row, 7).alignment = { horizontal: 'center' };
    fill(sheet.getCell(row, 7), COLORS.blue);
    sheet.mergeCells(row, 8, row, 9);
    sheet.getCell(row, 8).value =
      item.weekday + ' ' + item.date + ' · ' + hourRange(item.hour);
    sheet.getCell(row, 8).font = { bold: true, color: { argb: COLORS.text } };
    sheet.mergeCells(row + 1, 8, row + 1, 9);
    sheet.getCell(row + 1, 8).value =
      Math.round(item.ots).toLocaleString('es-MX') +
      ' OTS · ' +
      (item.attentionRate / 100).toLocaleString('es-MX', {
        style: 'percent',
        minimumFractionDigits: 1,
      }) +
      ' atención';
    sheet.getCell(row + 1, 8).font = { color: { argb: COLORS.muted } };
  });

  const bands = timeBandSummaries(report).slice(-4);
  const maxBand = Math.max(0, ...bands.map((item) => item.ots));
  bands.forEach((item, index) => {
    const row = base + 1 + index;
    sheet.getCell(row, 10).value = item.label;
    sheet.getCell(row, 10).font = { bold: true, color: { argb: COLORS.text } };
    sheet.getCell(row, 11).value = item.share / 100;
    sheet.getCell(row, 11).numFmt = '0.0%';
    sheet.getCell(row, 12).value = barText(item.ots, maxBand, 10);
    sheet.getCell(row, 12).font = { color: { argb: COLORS.cyan } };
  });

  const lower = 28;
  sectionTitle(sheet, lower, 1, 6, 'DEMOGRAFÍA · AUDIENCIA ATENTA');
  sectionTitle(sheet, lower, 7, 9, 'CALIDAD DE MEDICIÓN');
  sectionTitle(sheet, lower, 10, 12, 'ORIGEN DEL ALCANCE');
  const gender = genderSummaries(report, QUIVIDI_GENDER_LABELS);
  const age = ageSummaries(report, QUIVIDI_AGE_LABELS);
  const demos = [...gender.slice(0, 3), ...age.slice(0, 4)];
  const maxDemo = Math.max(0, ...demos.map((item) => item.watchers));
  demos.forEach((item, index) => {
    const row = lower + 1 + index;
    sheet.mergeCells(row, 1, row, 2);
    sheet.getCell(row, 1).value = item.label;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: COLORS.text } };
    sheet.getCell(row, 3).value = item.share / 100;
    sheet.getCell(row, 3).numFmt = '0.0%';
    sheet.mergeCells(row, 4, row, 6);
    sheet.getCell(row, 4).value = barText(item.watchers, maxDemo, 18);
    sheet.getCell(row, 4).font = {
      color: {
        argb: index < gender.slice(0, 3).length ? COLORS.pink : COLORS.purple,
      },
    };
  });

  const quality = qualitySummary(report);
  const qualityRows = [
    ['Completa', quality.complete, COLORS.green, COLORS.greenPale],
    ['Parcial', quality.partial, COLORS.orange, COLORS.orangePale],
    ['Sin medición', quality.missing, COLORS.red, COLORS.redPale],
  ] as const;
  qualityRows.forEach(([label, value, color, pale], index) => {
    const row = lower + 1 + index * 2;
    sheet.mergeCells(row, 7, row, 9);
    const cell = sheet.getCell(row, 7);
    cell.value = label + ' · ' + value.toLocaleString('es-MX') + ' soporte-día';
    cell.font = { bold: true, color: { argb: color } };
    fill(cell, pale);
    thinBorder(cell, color);
  });

  report.scopeOrigins
    .filter((origin) => origin.pairCount > 0)
    .slice(0, 5)
    .forEach((origin, index) => {
      const row = lower + 1 + index * 2;
      sheet.mergeCells(row, 10, row, 12);
      const cell = sheet.getCell(row, 10);
      cell.value =
        origin.support +
        '\n' +
        scopeSourceLabel(origin.source) +
        (origin.ekonNumber ? ' · EKON ' + origin.ekonNumber : '');
      cell.alignment = { wrapText: true, vertical: 'middle' };
      cell.font = { bold: true, color: { argb: COLORS.navy2 }, size: 9 };
      fill(cell, COLORS.sky);
      thinBorder(cell);
    });

  const noteRow = lower + 10;
  sheet.mergeCells(noteRow, 1, noteRow + 2, 12);
  const note = sheet.getCell(noteRow, 1);
  note.value =
    'Lectura comercial: OTS y Watchers representan contactos/detecciones medidos, no reach único de personas. Los soportes se mantienen separados en el detalle para evitar interpretar duplicidades como audiencia única. La demografía es una estimación algorítmica.';
  note.alignment = { wrapText: true, vertical: 'middle' };
  note.font = { italic: true, size: 9, color: { argb: COLORS.muted } };
  fill(note, COLORS.pale);
  thinBorder(note);
}

function addStores(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Tiendas');
  baseSheet(sheet, 4);
  setColumns(sheet, [10, 26, 28, 15, 15, 14, 14, 16, 14, 16, 13, 24]);
  sheet.sheetProperties.tabColor = { argb: COLORS.blue };
  sheet.mergeCells('A1:L2');
  sheet.getCell('A1').value = 'RESUMEN POR TIENDA';
  sheet.getCell('A1').font = {
    bold: true,
    size: 20,
    color: { argb: COLORS.white },
  };
  fill(sheet.getCell('A1'), COLORS.navy);
  sheet.mergeCells('A3:L3');
  sheet.getCell('A3').value =
    'Ranking descriptivo por OTS medidos. Si una tienda contiene varios soportes, los contactos se suman como oportunidades/detecciones, no como reach único.';
  sheet.getCell('A3').font = { italic: true, color: { argb: COLORS.muted } };
  sheet.addRow([
    'Tienda',
    'Nombre',
    'Soportes',
    'OTS',
    'Watchers',
    'Tasa atención',
    'Attention Time',
    'Dwell Time',
    'Mejor día',
    'Mejor franja',
    'Cob. medición',
    'Peso visual',
  ]);
  styleHeader(sheet.getRow(4));
  const stores = storeSummaries(report);
  const max = Math.max(0, ...stores.map((item) => item.ots));
  stores.forEach((item) => {
    const row = sheet.addRow([
      item.storeNumber,
      item.storeName,
      item.supports.join(', '),
      item.ots,
      item.watchers,
      item.attentionRate / 100,
      item.attentionSeconds,
      item.dwellSeconds,
      item.bestWeekday,
      hourRange(item.bestHour),
      item.measurementPercent / 100,
      barText(item.ots, max, 18),
    ]);
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '#,##0';
    row.getCell(6).numFmt = '0.0%';
    row.getCell(7).numFmt = '0.0 "s"';
    row.getCell(8).numFmt = '0.0 "s"';
    row.getCell(11).numFmt = '0.0%';
    row.getCell(12).font = { color: { argb: COLORS.blue } };
  });
}

function addDaysHours(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Días y Horarios');
  baseSheet(sheet, 4);
  sheet.sheetProperties.tabColor = { argb: COLORS.cyan };
  const hourly = hourSummaries(report);
  const activeHours = hourly
    .filter((item) => item.ots > 0)
    .map((item) => item.hour);
  const minHour = activeHours.length > 0 ? Math.min(...activeHours) : 6;
  const maxHour = activeHours.length > 0 ? Math.max(...activeHours) : 23;
  const hours = Array.from(
    { length: Math.max(1, maxHour - minHour + 1) },
    (_, index) => minHour + index,
  );
  setColumns(sheet, [13, ...hours.map(() => 12), 16, 16, 16]);
  const lastColumn = hours.length + 4;
  sheet.mergeCells(1, 1, 2, lastColumn);
  const title = sheet.getCell(1, 1);
  title.value = 'AUDIENCIA POR DÍA Y HORA';
  title.font = { bold: true, size: 20, color: { argb: COLORS.white } };
  fill(title, COLORS.navy);
  sheet.mergeCells(3, 1, 3, lastColumn);
  sheet.getCell(3, 1).value =
    'Mapa de calor por OTS. Las horas corresponden al periodo reportado por VidiCenter para cada ubicación.';
  sheet.getCell(3, 1).font = { italic: true, color: { argb: COLORS.muted } };
  const heat = heatmapCells(report).filter(
    (item) => item.hour >= minHour && item.hour <= maxHour,
  );
  const heatMax = Math.max(0, ...heat.map((item) => item.ots));
  sheet.getCell(4, 1).value = 'Día';
  hours.forEach((hour, index) => {
    sheet.getCell(4, index + 2).value = String(hour).padStart(2, '0') + ':00';
  });
  sheet.getCell(4, hours.length + 2).value = 'OTS día';
  sheet.getCell(4, hours.length + 3).value = 'Watchers';
  sheet.getCell(4, hours.length + 4).value = 'Tasa atención';
  styleHeader(sheet.getRow(4));
  weekdaySummaries(report).forEach((day, rowIndex) => {
    const rowNumber = 5 + rowIndex;
    sheet.getCell(rowNumber, 1).value = day.label;
    sheet.getCell(rowNumber, 1).font = {
      bold: true,
      color: { argb: COLORS.navy },
    };
    hours.forEach((hour, hourIndex) => {
      const data = heat.find(
        (item) => item.weekday === day.weekday && item.hour === hour,
      );
      const cell = sheet.getCell(rowNumber, hourIndex + 2);
      cell.value = data?.ots ?? 0;
      cell.numFmt = '#,##0';
      fill(cell, heatColor(data?.ots ?? 0, heatMax));
      cell.font = {
        color: {
          argb: (data?.ots ?? 0) > heatMax * 0.55 ? COLORS.white : COLORS.text,
        },
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    sheet.getCell(rowNumber, hours.length + 2).value = day.ots;
    sheet.getCell(rowNumber, hours.length + 2).numFmt = '#,##0';
    sheet.getCell(rowNumber, hours.length + 3).value = day.watchers;
    sheet.getCell(rowNumber, hours.length + 3).numFmt = '#,##0';
    sheet.getCell(rowNumber, hours.length + 4).value = day.attentionRate / 100;
    sheet.getCell(rowNumber, hours.length + 4).numFmt = '0.0%';
  });
  let row = 14;
  sectionTitle(sheet, row, 1, Math.min(6, lastColumn), 'FRANJAS HORARIAS');
  row += 1;
  const bands = timeBandSummaries(report);
  const maxBand = Math.max(0, ...bands.map((item) => item.ots));
  bands.forEach((band) => {
    sheet.getCell(row, 1).value = band.label;
    sheet.getCell(row, 2).value = band.range;
    sheet.getCell(row, 3).value = band.ots;
    sheet.getCell(row, 3).numFmt = '#,##0';
    sheet.getCell(row, 4).value = band.watchers;
    sheet.getCell(row, 4).numFmt = '#,##0';
    sheet.getCell(row, 5).value = band.share / 100;
    sheet.getCell(row, 5).numFmt = '0.0%';
    sheet.getCell(row, 6).value = barText(band.ots, maxBand, 16);
    sheet.getCell(row, 6).font = { color: { argb: COLORS.blue } };
    row += 1;
  });
}

function addDaily(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Evolución Diaria');
  baseSheet(sheet, 4);
  setColumns(sheet, [14, 16, 16, 16, 36]);
  sheet.sheetProperties.tabColor = { argb: COLORS.blue };
  sheet.mergeCells('A1:E2');
  sheet.getCell('A1').value = 'EVOLUCIÓN DIARIA DE AUDIENCIA';
  sheet.getCell('A1').font = {
    bold: true,
    size: 20,
    color: { argb: COLORS.white },
  };
  fill(sheet.getCell('A1'), COLORS.navy);
  sheet.mergeCells('A3:E3');
  sheet.getCell('A3').value =
    'OTS y Watchers son contactos/detecciones medidos; no representan personas únicas.';
  sheet.getCell('A3').font = { italic: true, color: { argb: COLORS.muted } };
  sheet.addRow(['Fecha', 'OTS', 'Watchers', 'Tasa atención', 'Intensidad OTS']);
  styleHeader(sheet.getRow(4));
  const daily = dailySummaries(report);
  const max = Math.max(0, ...daily.map((item) => item.ots));
  daily.forEach((item) => {
    const row = sheet.addRow([
      item.date,
      item.ots,
      item.watchers,
      item.attentionRate / 100,
      barText(item.ots, max, 24),
    ]);
    row.getCell(2).numFmt = '#,##0';
    row.getCell(3).numFmt = '#,##0';
    row.getCell(4).numFmt = '0.0%';
    row.getCell(5).font = { color: { argb: COLORS.blue } };
  });
}

function addHourlyDetail(wb: Workbook, report: QuividiCampaignReport): void {
  const sheet = wb.addWorksheet('Detalle Horario');
  baseSheet(sheet, 1);
  setColumns(sheet, [13, 9, 10, 25, 26, 15, 15, 15, 15, 16, 16, 16]);
  sheet.addRow([
    'Fecha',
    'Hora',
    'Tienda',
    'Nombre tienda',
    'Soporte',
    'Cámaras config.',
    'Cámaras usadas',
    'Estado',
    'OTS',
    'Effective OTS',
    'Watchers',
    'Tasa atención',
  ]);
  styleHeader(sheet.getRow(1));
  report.supportHours.forEach((item) => {
    const row = sheet.addRow([
      item.date,
      String(item.hour).padStart(2, '0') + ':00',
      item.storeNumber,
      item.storeName,
      item.support,
      item.configuredCameras,
      item.measuredCameras,
      item.status === 'complete' ? 'Completa' : 'Parcial',
      item.ots,
      item.effectiveOts,
      item.watchers,
      item.ots > 0 ? item.watchers / item.ots : 0,
    ]);
    row.getCell(9).numFmt = '#,##0';
    row.getCell(10).numFmt = '#,##0';
    row.getCell(11).numFmt = '#,##0';
    row.getCell(12).numFmt = '0.0%';
  });
}

export function addQuividiMarketingSheets(
  wb: Workbook,
  report: QuividiCampaignReport,
): void {
  addDashboard(wb, report);
  addStores(wb, report);
  addDaysHours(wb, report);
  addDaily(wb, report);
  addHourlyDetail(wb, report);
}
