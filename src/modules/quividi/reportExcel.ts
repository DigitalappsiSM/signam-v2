import type { QuividiCampaignSnapshot } from '@/services/quividi';
import {
  QUIVIDI_INDICATOR_DEFINITIONS,
  aggregateSupportDay,
  buildMeasurementIncidents,
  measurementCoverage,
  type SupportDayMetrics,
} from './audience';

interface SupportSummary {
  support: string;
  ots: number;
  effectiveOts: number;
  watchers: number;
  attentionSeconds: number | null;
  dwellSeconds: number | null;
  measurementCoverage: number;
}

function datesInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const current = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (current <= last) {
    out.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return out;
}

function sum(values: Array<number | null>): number {
  return values.reduce((acc, value) => acc + (value ?? 0), 0);
}

function weightedByWatchers(
  rows: readonly SupportDayMetrics[],
  field: 'attentionSeconds' | 'dwellSeconds',
): number | null {
  const usable = rows.filter(
    (row) => row[field] != null && (row.watchers ?? 0) > 0,
  );
  const watchers = sum(usable.map((row) => row.watchers));
  if (watchers <= 0) return null;
  return (
    usable.reduce(
      (acc, row) => acc + (row[field] ?? 0) * (row.watchers ?? 0),
      0,
    ) / watchers
  );
}

function supportSummaries(
  snapshot: QuividiCampaignSnapshot,
  supportDays: Map<string, SupportDayMetrics[]>,
): SupportSummary[] {
  const grouped = new Map<string, SupportDayMetrics[]>();
  for (const mapping of snapshot.mappings) {
    const rows = supportDays.get(mapping.key) ?? [];
    const bucket = grouped.get(mapping.support) ?? [];
    bucket.push(...rows);
    grouped.set(mapping.support, bucket);
  }
  return Array.from(grouped, ([support, rows]) => ({
    support,
    ots: sum(rows.map((row) => row.ots)),
    effectiveOts: sum(rows.map((row) => row.effectiveOts)),
    watchers: sum(rows.map((row) => row.watchers)),
    attentionSeconds: weightedByWatchers(rows, 'attentionSeconds'),
    dwellSeconds: weightedByWatchers(rows, 'dwellSeconds'),
    measurementCoverage: measurementCoverage(rows),
  })).sort((a, b) => b.ots - a.ots);
}

function pct(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function seconds(value: number | null): string {
  return value == null ? '—' : value.toFixed(1) + ' s';
}

export async function buildQuividiCampaignReportBlob(
  snapshot: QuividiCampaignSnapshot,
): Promise<Blob> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIGNAM V2';
  workbook.subject = 'Reporte de audiencia Quividi por campaña';

  const dates = datesInclusive(snapshot.startDate, snapshot.endDate);
  const cameraRowsByLocation = new Map<number, typeof snapshot.cameraDays>();
  for (const row of snapshot.cameraDays) {
    const bucket = cameraRowsByLocation.get(row.locationId) ?? [];
    bucket.push(row);
    cameraRowsByLocation.set(row.locationId, bucket);
  }

  const supportDays = new Map<string, SupportDayMetrics[]>();
  const incidents = [];
  for (const mapping of snapshot.mappings) {
    const rows = mapping.cameras.flatMap(
      (camera) => cameraRowsByLocation.get(camera.locationId) ?? [],
    );
    const days = dates.map((date) => aggregateSupportDay(mapping, date, rows));
    supportDays.set(mapping.key, days);
    incidents.push(...buildMeasurementIncidents(mapping, days));
  }
  const summaries = supportSummaries(snapshot, supportDays);
  const totalPairs = snapshot.mappings.length + snapshot.uncovered.length;
  const quividiCoverage =
    totalPairs === 0 ? 0 : snapshot.mappings.length / totalPairs;
  const allSupportDays = Array.from(supportDays.values()).flat();
  const overallMeasurementCoverage = measurementCoverage(allSupportDays);

  const dashboard = workbook.addWorksheet('Dashboard', {
    views: [{ showGridLines: false }],
  });
  dashboard.columns = [
    { width: 24 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
  ];
  dashboard.mergeCells('A1:F2');
  dashboard.getCell('A1').value = 'QUIVIDI · REPORTE DE AUDIENCIA';
  dashboard.getCell('A1').font = { size: 20, bold: true };
  dashboard.getCell('A1').alignment = { vertical: 'middle' };
  dashboard.mergeCells('A3:F3');
  dashboard.getCell('A3').value =
    snapshot.campaignName +
    ' · ' +
    snapshot.startDate +
    ' a ' +
    snapshot.endDate;
  dashboard.getCell('A3').font = { size: 12, bold: true };

  const kpis = [
    [
      'Cobertura Quividi',
      pct(quividiCoverage),
      QUIVIDI_INDICATOR_DEFINITIONS.quividiCoverage,
    ],
    [
      'Cobertura de medición',
      pct(overallMeasurementCoverage),
      QUIVIDI_INDICATOR_DEFINITIONS.measurementCoverage,
    ],
    [
      'Soportes con Quividi',
      snapshot.mappings.length,
      'Combinaciones tienda + soporte con al menos una cámara Quividi.',
    ],
    [
      'Incidencias de cámara',
      incidents.length,
      'Periodos donde una cámara esperada no tuvo datos disponibles.',
    ],
  ];
  kpis.forEach(([label, value, definition], index) => {
    const col = 1 + index;
    dashboard.getCell(5, col).value = label;
    dashboard.getCell(5, col).font = { bold: true };
    dashboard.getCell(6, col).value = value as string | number;
    dashboard.getCell(6, col).font = { size: 18, bold: true };
    dashboard.getCell(7, col).value = definition;
    dashboard.getCell(7, col).alignment = { wrapText: true, vertical: 'top' };
  });
  dashboard.getRow(7).height = 46;

  dashboard.getCell('A10').value = 'Resultados por soporte';
  dashboard.getCell('A10').font = { bold: true, size: 14 };
  const summaryHeader = [
    'Soporte',
    'OTS',
    'Effective OTS',
    'Watchers',
    'Tasa de atención',
    'Attention Time',
    'Dwell Time',
    'Cobertura medición',
  ];
  dashboard.addRow([]);
  dashboard.addRow(summaryHeader);
  for (const item of summaries) {
    dashboard.addRow([
      item.support,
      item.ots,
      item.effectiveOts,
      item.watchers,
      item.ots > 0 ? item.watchers / item.ots : 0,
      item.attentionSeconds,
      item.dwellSeconds,
      item.measurementCoverage,
    ]);
  }
  const summaryStart = 12;
  dashboard.getRow(summaryStart).font = { bold: true };
  for (
    let row = summaryStart + 1;
    row <= summaryStart + summaries.length;
    row += 1
  ) {
    dashboard.getCell(row, 5).numFmt = '0.0%';
    dashboard.getCell(row, 6).numFmt = '0.0 "s"';
    dashboard.getCell(row, 7).numFmt = '0.0 "s"';
    dashboard.getCell(row, 8).numFmt = '0.0%';
  }

  const qualityRow = summaryStart + summaries.length + 3;
  dashboard.getCell(qualityRow, 1).value = 'Calidad de medición';
  dashboard.getCell(qualityRow, 1).font = { bold: true, size: 14 };
  if (incidents.length === 0) {
    dashboard.getCell(qualityRow + 1, 1).value =
      'Sin incidencias de cámara detectadas en el periodo.';
  } else {
    dashboard.getCell(qualityRow + 1, 1).value =
      'Se detectaron cámaras sin datos durante parte del periodo. SIGNAM utilizó las cámaras disponibles para esos días y dejó la incidencia documentada.';
    dashboard.mergeCells(qualityRow + 1, 1, qualityRow + 1, 6);
    dashboard.getCell(qualityRow + 1, 1).alignment = { wrapText: true };
    let row = qualityRow + 3;
    dashboard.getRow(row).values = [
      'Tienda + soporte',
      'Cámara',
      'Desde',
      'Hasta',
      'Días afectados',
    ];
    dashboard.getRow(row).font = { bold: true };
    row += 1;
    for (const incident of incidents.slice(0, 10)) {
      const mapping = snapshot.mappings.find(
        (item) => item.key === incident.supportKey,
      );
      dashboard.getRow(row).values = [
        mapping
          ? mapping.storeName + ' · ' + mapping.support
          : incident.supportKey,
        incident.cameraName,
        incident.startDate,
        incident.endDate,
        incident.days,
      ];
      row += 1;
    }
  }

  const indicatorsRow = Math.max(qualityRow + incidents.length + 6, 25);
  dashboard.getCell(indicatorsRow, 1).value = 'Qué significa cada indicador';
  dashboard.getCell(indicatorsRow, 1).font = { bold: true, size: 14 };
  let definitionRow = indicatorsRow + 1;
  const definitions = [
    ['OTS', QUIVIDI_INDICATOR_DEFINITIONS.ots],
    ['Effective OTS', QUIVIDI_INDICATOR_DEFINITIONS.effectiveOts],
    ['Watchers', QUIVIDI_INDICATOR_DEFINITIONS.watchers],
    ['Tasa de atención', QUIVIDI_INDICATOR_DEFINITIONS.attentionRate],
    ['Attention Time', QUIVIDI_INDICATOR_DEFINITIONS.attentionTime],
    ['Dwell Time', QUIVIDI_INDICATOR_DEFINITIONS.dwellTime],
    ['Edad', QUIVIDI_INDICATOR_DEFINITIONS.age],
    ['Género', QUIVIDI_INDICATOR_DEFINITIONS.gender],
  ];
  for (const [label, definition] of definitions) {
    dashboard.getCell(definitionRow, 1).value = label;
    dashboard.getCell(definitionRow, 1).font = { bold: true };
    dashboard.mergeCells(definitionRow, 2, definitionRow, 6);
    dashboard.getCell(definitionRow, 2).value = definition;
    dashboard.getCell(definitionRow, 2).alignment = { wrapText: true };
    definitionRow += 1;
  }

  const supportsSheet = workbook.addWorksheet('Soportes');
  supportsSheet.addRow([
    'Tienda',
    'Número',
    'Soporte',
    'Fecha',
    'Estado medición',
    'Cámaras válidas',
    'Cámaras esperadas',
    'OTS ponderado',
    'Effective OTS ponderado',
    'Watchers ponderados',
    'Attention Time',
    'Dwell Time',
  ]);
  supportsSheet.getRow(1).font = { bold: true };
  for (const mapping of snapshot.mappings) {
    for (const day of supportDays.get(mapping.key) ?? []) {
      supportsSheet.addRow([
        mapping.storeName,
        mapping.storeNumber,
        mapping.support,
        day.date,
        day.status,
        day.validCameras,
        day.expectedCameras,
        day.ots,
        day.effectiveOts,
        day.watchers,
        day.attentionSeconds,
        day.dwellSeconds,
      ]);
    }
  }
  supportsSheet.columns.forEach((column) => {
    column.width = 18;
  });

  const camerasSheet = workbook.addWorksheet('Cámaras');
  camerasSheet.addRow([
    'Fecha',
    'Location ID',
    'Cámara',
    'OTS',
    'Effective OTS',
    'Watchers',
    'Attention Time',
    'Dwell Time',
    'Duration (s)',
  ]);
  camerasSheet.getRow(1).font = { bold: true };
  for (const row of snapshot.cameraDays.sort((a, b) =>
    (a.date + a.cameraName).localeCompare(b.date + b.cameraName),
  )) {
    camerasSheet.addRow([
      row.date,
      row.locationId,
      row.cameraName,
      row.ots,
      row.effectiveOts,
      row.watchers,
      row.attentionSeconds,
      row.dwellSeconds,
      row.durationSeconds,
    ]);
  }
  camerasSheet.columns.forEach((column) => {
    column.width = 18;
  });

  const demographics = workbook.addWorksheet('Demografía');
  demographics.addRow([
    'Tienda',
    'Soporte',
    'Fecha',
    'Dimensión',
    'Grupo',
    'Watchers ponderados',
  ]);
  demographics.getRow(1).font = { bold: true };
  for (const mapping of snapshot.mappings) {
    for (const day of supportDays.get(mapping.key) ?? []) {
      for (const [group, value] of Object.entries(day.demographics.gender)) {
        demographics.addRow([
          mapping.storeName,
          mapping.support,
          day.date,
          'Género',
          group,
          value,
        ]);
      }
      for (const [group, value] of Object.entries(day.demographics.age)) {
        demographics.addRow([
          mapping.storeName,
          mapping.support,
          day.date,
          'Edad',
          group,
          value,
        ]);
      }
      for (const [group, value] of Object.entries(day.demographics.ageGender)) {
        demographics.addRow([
          mapping.storeName,
          mapping.support,
          day.date,
          'Edad × Género',
          group,
          value,
        ]);
      }
    }
  }
  demographics.columns.forEach((column) => {
    column.width = 20;
  });

  const quality = workbook.addWorksheet('Calidad de medición');
  quality.addRow([
    'Tienda',
    'Soporte',
    'Cámara',
    'Desde',
    'Hasta',
    'Días afectados',
    'Lectura',
  ]);
  quality.getRow(1).font = { bold: true };
  for (const incident of incidents) {
    const mapping = snapshot.mappings.find(
      (item) => item.key === incident.supportKey,
    );
    quality.addRow([
      mapping?.storeName ?? '',
      mapping?.support ?? '',
      incident.cameraName,
      incident.startDate,
      incident.endDate,
      incident.days,
      'Medición parcial: en esos días se utilizó la cámara disponible. Si ninguna cámara tuvo datos, el día quedó sin medición.',
    ]);
  }
  for (const item of snapshot.uncovered) {
    quality.addRow([
      item.storeName,
      item.support,
      '',
      snapshot.startDate,
      snapshot.endDate,
      dates.length,
      'Sin cobertura Quividi para esta combinación tienda + soporte.',
    ]);
  }
  quality.columns.forEach((column) => {
    column.width = 22;
  });

  const method = workbook.addWorksheet('Metodología');
  method.addRow(['Elemento', 'Explicación']);
  method.getRow(1).font = { bold: true };
  method.addRow([
    'Ponderación de cámaras',
    'Cuando un soporte tiene varias cámaras, SIGNAM promedia las cámaras válidas día por día para evitar duplicar el mismo tráfico.',
  ]);
  method.addRow([
    'Caída parcial',
    'Si una cámara deja de reportar pero otra sigue disponible, se utiliza la cámara disponible y se marca la incidencia.',
  ]);
  method.addRow([
    'Sin medición',
    'Si ninguna cámara del soporte tiene datos en un día, SIGNAM no lo convierte en cero: el día queda sin medición.',
  ]);
  method.addRow([
    'Attention/Dwell',
    'Los tiempos se ponderan por Watchers para evitar promediar de la misma forma periodos con audiencias muy distintas.',
  ]);
  method.addRow([
    'Demografía',
    'Son estimaciones estadísticas de la audiencia detectada. No identifican personas.',
  ]);
  method.columns = [{ width: 26 }, { width: 100 }];
  method.getColumn(2).alignment = { wrapText: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function quividiReportFileName(
  snapshot: Pick<
    QuividiCampaignSnapshot,
    'campaignName' | 'startDate' | 'endDate'
  >,
): string {
  const safe = snapshot.campaignName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return (
    'Quividi_' +
    (safe || 'Campana') +
    '_' +
    snapshot.startDate +
    '_' +
    snapshot.endDate +
    '.xlsx'
  );
}
