import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandCampaignSummary,
  brandStoreAudit,
  formatCivilDate,
} from './quividiBrandReport';

/**
 * Hoja de auditoría del informe comercial.
 *
 * Reconstruye, paso a paso, cómo se llegó a las cifras que publica el PDF:
 * qué universo se contrató, qué parte se midió de verdad, qué hueco se
 * extrapoló y con qué promedio. Es la única hoja que explica el salto entre
 * los OTS medidos y los OTS estimados, y la que permite defender la cifra
 * ante la marca sin abrir el detalle operativo.
 *
 * No recalcula nada: consume exactamente las mismas funciones puras que el
 * PDF, de modo que una discrepancia entre ambos es imposible por construcción.
 */

const COLORS = {
  navy: 'FF092A4A',
  blue: 'FF1479D1',
  sky: 'FFEAF5FD',
  pale: 'FFF4F8FB',
  white: 'FFFFFFFF',
  text: 'FF102A43',
  muted: 'FF61788C',
  line: 'FFD7E3EC',
  amber: 'FFF59E0B',
  amberPale: 'FFFFF5DE',
} as const;

const INT = '#,##0';
const PCT = '0.0"%"';

function fill(cell: Cell, color: string): void {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function bandTitle(sheet: Worksheet, row: number, label: string): number {
  sheet.mergeCells(row, 1, row, 5);
  const cell = sheet.getCell(row, 1);
  cell.value = label;
  cell.font = { bold: true, size: 10, color: { argb: COLORS.white } };
  cell.alignment = { vertical: 'middle', indent: 1 };
  for (let col = 1; col <= 5; col += 1)
    fill(sheet.getCell(row, col), COLORS.navy);
  sheet.getRow(row).height = 22;
  return row + 1;
}

/** Fila «concepto → valor» con una nota opcional que explica de dónde sale. */
function factRow(
  sheet: Worksheet,
  row: number,
  label: string,
  value: number | string,
  note: string,
  options: { format?: string; strong?: boolean } = {},
): number {
  const labelCell = sheet.getCell(row, 1);
  labelCell.value = label;
  labelCell.font = {
    bold: options.strong ?? false,
    color: { argb: COLORS.text },
  };
  labelCell.alignment = { vertical: 'middle', indent: 1 };

  const valueCell = sheet.getCell(row, 2);
  valueCell.value = value;
  valueCell.numFmt = options.format ?? INT;
  valueCell.font = {
    bold: true,
    color: { argb: options.strong ? COLORS.blue : COLORS.text },
    size: options.strong ? 12 : 11,
  };
  valueCell.alignment = { vertical: 'middle', horizontal: 'right' };

  sheet.mergeCells(row, 3, row, 5);
  const noteCell = sheet.getCell(row, 3);
  noteCell.value = note;
  noteCell.font = { color: { argb: COLORS.muted }, size: 9 };
  noteCell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };

  if (options.strong) {
    for (let col = 1; col <= 5; col += 1)
      fill(sheet.getCell(row, col), COLORS.sky);
  }
  sheet.getRow(row).height = options.strong ? 24 : 20;
  return row + 1;
}

export function addQuividiAuditSheet(
  wb: Workbook,
  report: QuividiCampaignReport,
): void {
  const sheet = wb.addWorksheet('Auditoría de cifras', {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [
    { width: 44 },
    { width: 18 },
    { width: 26 },
    { width: 26 },
    { width: 30 },
  ];
  sheet.properties.tabColor = { argb: COLORS.amber };

  const summary = brandCampaignSummary(report);
  const { basis, coverage } = summary;

  sheet.mergeCells('A1:E2');
  const title = sheet.getCell('A1');
  title.value = 'CÓMO SE CONSTRUYERON LAS CIFRAS DEL INFORME';
  title.font = { bold: true, size: 14, color: { argb: COLORS.white } };
  title.alignment = { vertical: 'middle', indent: 1 };
  for (let col = 1; col <= 5; col += 1)
    fill(sheet.getCell(1, col), COLORS.navy);

  sheet.mergeCells('A3:E3');
  const subtitle = sheet.getCell('A3');
  subtitle.value = `${report.campaignName}  ·  ${formatCivilDate(report.startDate)} a ${formatCivilDate(report.endDate)}  ·  ${basis.days} días`;
  subtitle.font = { color: { argb: COLORS.muted }, size: 10 };
  subtitle.alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(3).height = 20;

  let row = 5;

  row = bandTitle(sheet, row, '1 · UNIVERSO CONTRATADO');
  row = factRow(
    sheet,
    row,
    'Tiendas de la campaña',
    coverage.totalStores,
    'Alcance resuelto desde el calendario Liverpool y, cuando aplica, EKON.',
  );
  row = factRow(
    sheet,
    row,
    'Pares tienda-soporte',
    basis.totalPairs,
    'Una tienda con dos soportes cuenta como dos pares: los OTS se acumulan por soporte.',
  );
  row = factRow(
    sheet,
    row,
    'Días de vigencia',
    basis.days,
    'Días naturales, ambos extremos incluidos.',
  );
  row = factRow(
    sheet,
    row,
    'Par-día del universo',
    basis.totalPairDays,
    `${basis.totalPairs} pares × ${basis.days} días. Es la rejilla completa que debía medirse.`,
    { strong: true },
  );

  row += 1;
  row = bandTitle(sheet, row, '2 · QUÉ SE MIDIÓ REALMENTE');
  row = factRow(
    sheet,
    row,
    'Par-día con medición completa',
    basis.completePairDays,
    'Todas las cámaras del soporte reportaron la jornada entera.',
  );
  row = factRow(
    sheet,
    row,
    'Par-día con medición parcial',
    basis.partialPairDays,
    'La duración medida cayó frente a la habitual de esa cámara. Se usa el dato, se marca la incidencia.',
  );
  row = factRow(
    sheet,
    row,
    'Par-día sin dato (cámara instalada)',
    basis.missingPairDays,
    'El soporte tiene cámara pero no reportó ese día. Ver hoja «Calidad medición».',
  );
  row = factRow(
    sheet,
    row,
    'Par-día sin cámara instalada',
    basis.uncoveredPairDays,
    'Soportes del universo contratado que nunca han tenido medición.',
  );
  row = factRow(
    sheet,
    row,
    'Par-día medidos',
    basis.measuredPairDays,
    'Completos más parciales. Es la base real de la extrapolación.',
    { strong: true },
  );

  row += 1;
  row = bandTitle(sheet, row, '3 · CONSTRUCCIÓN DE LA CIFRA PUBLICADA');
  row = factRow(
    sheet,
    row,
    'OTS medidos',
    summary.measuredOts,
    'Suma directa de los par-día con medición. No incluye ninguna estimación.',
  );
  row = factRow(
    sheet,
    row,
    '÷ Par-día medidos',
    basis.measuredPairDays,
    'Se divide por lo medido, nunca por la rejilla completa.',
  );
  row = factRow(
    sheet,
    row,
    '= OTS por par-día medido',
    basis.otsPerMeasuredPairDay,
    'Promedio observado. Los días sin dato no entran como cero y por tanto no lo deflactan.',
    { strong: true },
  );
  row = factRow(
    sheet,
    row,
    '× Par-día del universo',
    basis.totalPairDays,
    'El promedio observado se aplica a la rejilla completa.',
  );
  row = factRow(
    sheet,
    row,
    '= OTS estimados de campaña',
    summary.estimatedOts,
    'Cifra que publica el informe comercial.',
    { strong: true },
  );
  row = factRow(
    sheet,
    row,
    'De los cuales, extrapolados',
    summary.extrapolatedOts,
    `${basis.totalPairDays - basis.measuredPairDays} par-día sin medición rellenados al promedio observado.`,
  );

  row += 1;
  row = bandTitle(sheet, row, '4 · COBERTURA — DOS LECTURAS DISTINTAS');
  row = factRow(
    sheet,
    row,
    'Cobertura por tienda (despliegue)',
    coverage.measuredPercent,
    `${coverage.measuredStores} de ${coverage.totalStores} tiendas midieron en algún momento de la vigencia.`,
    { format: PCT },
  );
  row = factRow(
    sheet,
    row,
    'Cobertura por tienda-día (completitud)',
    coverage.storeDayPercent,
    `${coverage.measuredStoreDays} de ${coverage.totalStoreDays} tienda-día con medición. En vigencias largas es siempre menor que la anterior: una cámara caída deja de cubrir sin que el despliegue cambie.`,
    { format: PCT, strong: true },
  );

  row += 1;
  row = bandTitle(sheet, row, '5 · DERIVADOS DEL INFORME');
  row = factRow(
    sheet,
    row,
    'OTS promedio diario',
    summary.dailyAverage,
    `OTS estimados ÷ ${basis.days} días.`,
  );
  row = factRow(
    sheet,
    row,
    'OTS promedio diario / tienda',
    summary.dailyPerStore,
    `OTS estimados ÷ ${basis.days} días ÷ ${coverage.totalStores} tiendas.`,
  );
  row = factRow(
    sheet,
    row,
    'OTS promedio diario / soporte',
    summary.dailyPerSupport,
    `OTS estimados ÷ ${basis.days} días ÷ ${basis.totalPairs} pares.`,
  );

  row += 1;
  row = bandTitle(sheet, row, '6 · APORTACIÓN POR TIENDA');
  const headers = [
    'Tienda',
    'Completitud',
    'Par-día medidos / contratados',
    'OTS medidos',
    'Soportes con cámara',
  ];
  headers.forEach((label, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    fill(cell, COLORS.blue);
  });
  sheet.getRow(row).height = 24;
  row += 1;

  const audit = brandStoreAudit(report);
  for (const store of audit) {
    const nameCell = sheet.getCell(row, 1);
    nameCell.value = `${store.storeNumber} · ${store.storeName}`;
    nameCell.alignment = { vertical: 'middle', indent: 1 };

    const pctCell = sheet.getCell(row, 2);
    pctCell.value = store.completenessPercent;
    pctCell.numFmt = PCT;
    pctCell.alignment = { vertical: 'middle', horizontal: 'right' };
    // Se resalta la tienda que aporta menos de tres cuartas partes de lo
    // contratado: es la que explica el hueco extrapolado.
    if (store.completenessPercent < 75) {
      fill(pctCell, COLORS.amberPale);
      pctCell.font = { bold: true, color: { argb: COLORS.amber } };
    }

    const ratioCell = sheet.getCell(row, 3);
    ratioCell.value = `${store.measuredPairDays} / ${store.totalPairDays}`;
    ratioCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const otsCell = sheet.getCell(row, 4);
    otsCell.value = store.measuredOts;
    otsCell.numFmt = INT;
    otsCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const pairsCell = sheet.getCell(row, 5);
    pairsCell.value = store.pairs;
    pairsCell.alignment = { vertical: 'middle', horizontal: 'right' };

    if (row % 2 === 0) {
      for (let col = 1; col <= 5; col += 1)
        fill(sheet.getCell(row, col), COLORS.pale);
    }
    row += 1;
  }

  if (coverage.estimatedStores > 0) {
    sheet.mergeCells(row, 1, row, 5);
    const cell = sheet.getCell(row, 1);
    cell.value = `Además, ${coverage.estimatedStores} tienda(s) del universo contratado no tienen cámara instalada y no aparecen en esta tabla: su aportación es enteramente extrapolada.`;
    cell.font = { italic: true, color: { argb: COLORS.muted }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(row).height = 26;
    row += 1;
  }

  row += 1;
  row = bandTitle(sheet, row, '7 · REGLA APLICADA');
  sheet.mergeCells(row, 1, row + 2, 5);
  const rule = sheet.getCell(row, 1);
  rule.value =
    'Todo hueco de la rejilla par-día se rellena con el promedio de OTS observado en los par-día que sí midieron, sea el hueco un soporte sin cámara o un día que la cámara instalada no reportó. Ambos huecos son el mismo problema — universo contratado sin medir — y reciben el mismo tratamiento.\n\nLa cobertura se comunica por tienda-día porque es la que refleja la completitud real de la vigencia. La cobertura por tienda describe el despliegue de cámaras y se conserva sólo como referencia operativa.\n\nEste informe no publica el rendimiento individual de ninguna tienda; la tabla anterior existe únicamente para auditar la construcción de la cifra agregada.';
  rule.font = { color: { argb: COLORS.text }, size: 9.5 };
  rule.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  for (let offset = 0; offset <= 2; offset += 1) {
    sheet.getRow(row + offset).height = 30;
    for (let col = 1; col <= 5; col += 1) {
      fill(sheet.getCell(row + offset, col), COLORS.sky);
    }
  }
}
