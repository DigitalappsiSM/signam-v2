import { reconciliationStatusLabel } from '@/domain/ekon';
import { formatDdMmYyyy } from '@/modules/operational-tracking/businessDays';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import type { ReportingModel, WitnessMetric } from './reportingModel';

function safeDate(date: Date): string {
  return formatDdMmYyyy(date).replaceAll('/', '-');
}

function metricRows(prefix: string, metric: WitnessMetric): unknown[][] {
  return [
    [`${prefix} — aplicables`, metric.applicable],
    [`${prefix} — en tiempo`, metric.onTime],
    [`${prefix} — tarde`, metric.late],
    [`${prefix} — vencidos`, metric.overdue],
    [`${prefix} — pendientes`, metric.pending],
    [`${prefix} — cumplimiento`, `${metric.compliance}%`],
  ];
}

/** Exporta exactamente el modelo visible; no vuelve a consultar Firebase. */
export async function exportReportingWorkbook(
  model: ReportingModel,
): Promise<void> {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'SIGNAM V2';
  workbook.created = new Date(model.generatedAt);

  const summary = workbook.addWorksheet('Resumen ejecutivo', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  summary.addRows([
    ['Indicador', 'Valor'],
    ['Campañas en alcance', model.executive.campaigns],
    ['Activas', model.executive.active],
    ['Próximas', model.executive.upcoming],
    ['Terminadas', model.executive.finished],
    ['Seguimiento completo', model.executive.complete],
    ['Cumplimiento operativo', `${model.executive.completePct}%`],
    ['Con alertas', model.executive.withAlerts],
    ['Testigos vencidos', model.executive.overdue],
    ['Canceladas', model.executive.cancelled],
    ['Tiendas', model.executive.stores],
    ['Soportes', model.executive.supports],
    ['Pantallas físicas activas', model.executive.physicalScreens],
    ['Colocaciones digitales activas', model.executive.digitalActive],
    ['Avance digital promedio', `${model.executive.digitalProgress}%`],
    ['Conciliación correcta', `${model.executive.reconciliationPct}%`],
    ...metricRows('T. Arranque', model.sla.start),
    ...metricRows('T. Completos', model.sla.complete),
  ]);

  const attention = workbook.addWorksheet('Atención operativa', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  attention.addRow([
    'Campaña',
    'Momento',
    'Clasificación',
    'Incidencia',
    'Próximo vencimiento',
    'Tiendas',
    'Soportes',
  ]);
  attention.autoFilter = 'A1:G1';
  for (const row of model.attention) {
    attention.addRow([
      row.campaignName,
      row.timeframe === 'active'
        ? 'Activa'
        : row.timeframe === 'upcoming'
          ? 'Próxima'
          : 'Terminada',
      row.classification === 'provider'
        ? 'Proveedor'
        : row.classification === 'institutional'
          ? 'Institucional'
          : 'Pendiente',
      row.issue,
      row.deadline ? formatDdMmYyyy(row.deadline) : '',
      row.stores,
      row.supports,
    ]);
  }

  const sla = workbook.addWorksheet('SLA testigos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sla.addRow([
    'Campaña',
    'Inicio',
    'Fin',
    'T. Arranque',
    'T. Completos',
    'Tiendas',
  ]);
  sla.autoFilter = 'A1:F1';
  for (const row of model.trackingRows.filter(
    (item) =>
      item.lifecycleStatus !== 'cancelled' &&
      item.classification === 'provider',
  )) {
    sla.addRow([
      row.campaign.name,
      row.campaign.fechaInicio,
      row.campaign.fechaFin,
      STATUS_META[row.startStatus].label,
      STATUS_META[row.completeStatus].label,
      row.distinctStores,
    ]);
  }

  const reconciliation = workbook.addWorksheet('Conciliación', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  reconciliation.addRow([
    'Campaña',
    'Número Ekon',
    'Estado',
    'Ratio',
    'Cobertura',
    'Incidencias',
  ]);
  reconciliation.autoFilter = 'A1:F1';
  for (const row of model.reconciliation.rows) {
    reconciliation.addRow([
      row.campaign.name,
      row.ekonNumber,
      reconciliationStatusLabel(row.result.status),
      row.result.ratio === 'ratio1'
        ? 'Ratio 1'
        : row.result.ratio === 'ratio3'
          ? 'Ratio 3'
          : '',
      row.result.coverage,
      row.result.issues.map((issue) => issue.message).join(' · '),
    ]);
  }

  const digital = workbook.addWorksheet('Operación digital', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  digital.addRows([
    ['Indicador', 'Valor'],
    ['Colocaciones activas', model.digital.activeItems],
    ['Campañas distintas', model.digital.distinctCampaigns],
    ['Avance promedio', `${Math.round(model.digital.averageProgress * 100)}%`],
    ['Centros reportados', model.digital.totalCenters],
    ['Soportes reportados', model.digital.totalSupports],
    ['Canceladas', model.digital.cancelledItems],
    ...Object.entries(model.digital.pendingByCheck).map(([key, value]) => [
      `Pendiente ${key}`,
      value,
    ]),
  ]);

  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1D4ED8' },
    };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    sheet.columns.forEach((column) => {
      let width = 14;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        width = Math.min(
          60,
          Math.max(width, String(cell.value ?? '').length + 2),
        );
        cell.alignment = { vertical: 'top', wrapText: true };
      });
      column.width = width;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `SIGNAM_Reporting_${safeDate(model.range.start)}_a_${safeDate(model.range.end)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
