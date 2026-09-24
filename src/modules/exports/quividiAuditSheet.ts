import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandCampaignSummary,
  brandExtrapolationByReason,
  brandStoreAttribution,
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
    { width: 20 },
    { width: 20 },
  ];
  sheet.properties.tabColor = { argb: COLORS.amber };

  const summary = brandCampaignSummary(report);
  const { basis, coverage, scope } = summary;

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

  sheet.mergeCells('A4:E4');
  const scopeNote = sheet.getCell('A4');
  scopeNote.value =
    'Esta hoja conserva el OTS tal cual lo agrega Quividi por día completo (00:00–23:59). El PDF comercial acota OTS y dwell time a la franja operativa de cara a la marca (10:00–22:00): si hubo medición fuera de esa franja, el total de esta hoja es mayor que el de portada — no es una discrepancia, son dos alcances distintos por diseño.';
  scopeNote.font = { italic: true, color: { argb: COLORS.amber }, size: 8.5 };
  scopeNote.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  sheet.getRow(4).height = 28;

  let row = 6;

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
    'Soportes contratados',
    scope.measurablePairs + scope.excludedPairs,
    'Todos los soportes del circuito, de cualquier formato. Una tienda con dos soportes cuenta dos veces.',
  );
  row = factRow(
    sheet,
    row,
    'Soportes de formatos con medición',
    scope.measurablePairs,
    'Los que entran en la cifra publicada.',
  );
  row = factRow(
    sheet,
    row,
    'Soportes de formatos sin medición',
    scope.excludedPairs,
    'Suman exhibición pero quedan FUERA del OTS: extrapolarles la audiencia de otro formato supondría que rinden igual.',
  );
  row = factRow(
    sheet,
    row,
    'Días de vigencia',
    scope.days,
    'Días naturales, ambos extremos incluidos.',
  );
  row = factRow(
    sheet,
    row,
    'Par-día del circuito medible',
    scope.measurablePairDays,
    `${scope.measurablePairs} soportes × ${scope.days} días. Es la rejilla sobre la que se calcula la cifra.`,
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

  const byReason = brandExtrapolationByReason(report);
  const byReasonBySupport = new Map(
    byReason.byFormat.map((item) => [item.support, item]),
  );

  row += 1;
  row = bandTitle(
    sheet,
    row,
    '3 · CONSTRUCCIÓN DE LA CIFRA, FORMATO A FORMATO',
  );
  const chainHeaders = [
    'Formato',
    'Par-día medidos',
    'OTS medidos',
    'OTS por par-día',
    'Par-día del formato',
    'Extrapolados: sin dato',
    'Extrapolados: sin cámara',
  ];
  chainHeaders.forEach((label, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    fill(cell, COLORS.blue);
  });
  sheet.getRow(row).height = 24;
  row += 1;

  // Cada formato se completa con SU promedio: un único promedio para todo el
  // circuito haría que un video wall heredara el rendimiento de un mupi.
  for (const format of scope.measurable) {
    const perPairDay =
      format.measuredPairDays > 0
        ? format.measuredOts / format.measuredPairDays
        : 0;
    const reason = byReasonBySupport.get(format.support);
    const cells: Array<[number, number | string, string?]> = [
      [1, format.support],
      [2, format.measuredPairDays, INT],
      [3, format.measuredOts, INT],
      [4, perPairDay, INT],
      [5, format.pairDays, INT],
      [6, reason?.missingOts ?? 0, INT],
      [7, reason?.uncoveredOts ?? 0, INT],
    ];
    for (const [column, value, format_] of cells) {
      const cell = sheet.getCell(row, column);
      cell.value = value;
      if (format_) cell.numFmt = format_;
      cell.alignment = {
        vertical: 'middle',
        horizontal: column === 1 ? 'left' : 'right',
        indent: 1,
      };
    }
    sheet.getRow(row).height = 20;
    row += 1;
  }

  row += 1;
  row = factRow(
    sheet,
    row,
    'OTS medidos',
    summary.measuredOts,
    'Suma directa de los par-día con medición del circuito medible. Sin ninguna estimación.',
  );
  row = factRow(
    sheet,
    row,
    '= OTS estimados de campaña',
    summary.estimatedOts,
    'Suma de aplicar, en cada formato, su propio promedio a su propia rejilla. Es la cifra que publica el informe.',
    { strong: true },
  );
  row = factRow(
    sheet,
    row,
    'De los cuales, extrapolados',
    summary.extrapolatedOts,
    `${scope.measurablePairDays - scope.measuredPairDays} par-día sin medición, completados con el promedio de su formato.`,
  );

  row = factRow(
    sheet,
    row,
    '— por días sin dato (cámara instalada)',
    byReason.missingOts,
    `${byReason.byFormat.reduce((total, item) => total + item.missingPairDays, 0)} par-día: el soporte tiene cámara pero no reportó ese día.`,
  );
  row = factRow(
    sheet,
    row,
    '— por soportes sin cámara instalada',
    byReason.uncoveredOts,
    `${byReason.byFormat.reduce((total, item) => total + item.uncoveredPairDays, 0)} par-día: soportes del universo contratado que nunca tuvieron cámara.`,
  );

  row += 1;
  row = bandTitle(sheet, row, '4 · EL CIRCUITO POR FORMATO');
  const formatHeaders = [
    'Formato',
    'Soportes',
    'Con cámara',
    'Par-día medidos',
    'Entra en la cifra',
  ];
  formatHeaders.forEach((label, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    fill(cell, COLORS.blue);
  });
  sheet.getRow(row).height = 24;
  row += 1;

  for (const format of scope.formats) {
    const cells: Array<[number, number | string]> = [
      [1, format.support],
      [2, format.pairs],
      [3, format.mappedPairs],
      [4, format.measuredPairDays],
      [5, format.measurable ? 'Sí' : 'No'],
    ];
    for (const [column, value] of cells) {
      const cell = sheet.getCell(row, column);
      cell.value = value;
      if (typeof value === 'number' && column > 1) cell.numFmt = INT;
      cell.alignment = {
        vertical: 'middle',
        horizontal: column === 1 ? 'left' : 'right',
        indent: 1,
      };
      if (!format.measurable) {
        fill(cell, COLORS.amberPale);
        cell.font = { color: { argb: COLORS.amber } };
      }
    }
    sheet.getRow(row).height = 20;
    row += 1;
  }

  row += 1;
  row = bandTitle(sheet, row, '5 · COBERTURA — DOS LECTURAS DISTINTAS');
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

  const attribution = brandStoreAttribution(report);
  row += 1;
  row = bandTitle(
    sheet,
    row,
    '6 · CLASIFICACIÓN INFORMATIVA VS. CLASIFICACIÓN TÉCNICA',
  );
  row = factRow(
    sheet,
    row,
    'Informativa (por tienda): OTS de tiendas con medición',
    attribution.measuredStoresSharePercent,
    'Tiendas que midieron algo en algún momento de la vigencia, aunque parte de sus huecos se haya estimado. Es el criterio que sostiene «Tiendas TOP».',
    { format: PCT },
  );
  row = factRow(
    sheet,
    row,
    'Informativa (por tienda): OTS de tiendas sin medición',
    attribution.unmeasuredStoresSharePercent,
    'Tiendas del universo contratado que nunca tuvieron un dato directo (sin cámara, o con cámara sin ningún par-día medido).',
    { format: PCT },
  );
  row = factRow(
    sheet,
    row,
    'Técnica (por par-día): OTS medidos',
    scope.measurablePairDays > 0
      ? (summary.measuredOts / summary.estimatedOts) * 100
      : 0,
    'Par-día del circuito medible con dato directo, sin importar qué tienda los aportó.',
    { format: PCT },
  );
  row = factRow(
    sheet,
    row,
    'Técnica (por par-día): OTS extrapolados',
    scope.measurablePairDays > 0
      ? (summary.extrapolatedOts / summary.estimatedOts) * 100
      : 0,
    'No es el mismo porcentaje que la clasificación informativa: una tienda que midió un solo día sigue del lado «con medición» arriba, pero la mayoría de sus par-día pueden estar extrapolados aquí.',
    { format: PCT, strong: true },
  );

  row += 1;
  row = bandTitle(sheet, row, '7 · DERIVADOS DEL INFORME');
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
  row = bandTitle(
    sheet,
    row,
    '8 · APORTACIÓN POR TIENDA — OBSERVADO Y AJUSTADO',
  );
  const adjustedByStore = new Map(
    attribution.stores.map((store) => [store.storeNumber, store.adjustedOts]),
  );
  const headers = [
    'Tienda',
    'Completitud',
    'Par-día medidos / contratados',
    'OTS medidos',
    'Soportes con cámara',
    'OTS ajustados',
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

    // Sólo las tiendas con al menos un par-día en un formato medible tienen
    // OTS ajustados: una tienda cuyo único soporte es un formato sin ninguna
    // medición (fuera de la cifra) no participa del ajuste.
    const adjustedCell = sheet.getCell(row, 6);
    const adjusted = adjustedByStore.get(store.storeNumber);
    adjustedCell.value = adjusted ?? '—';
    if (typeof adjusted === 'number') adjustedCell.numFmt = INT;
    adjustedCell.alignment = { vertical: 'middle', horizontal: 'right' };

    if (row % 2 === 0) {
      for (let col = 1; col <= 6; col += 1)
        fill(sheet.getCell(row, col), COLORS.pale);
    }
    row += 1;
  }

  if (coverage.estimatedStores > 0) {
    sheet.mergeCells(row, 1, row, 6);
    const cell = sheet.getCell(row, 1);
    cell.value = `Además, ${coverage.estimatedStores} tienda(s) del universo contratado no tienen cámara instalada y no aparecen en esta tabla: su aportación es enteramente extrapolada.`;
    cell.font = { italic: true, color: { argb: COLORS.muted }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    sheet.getRow(row).height = 26;
    row += 1;
  }

  row += 1;
  row = factRow(
    sheet,
    row,
    'OTS ajustados de tiendas con medición (suma de la tabla)',
    attribution.measuredStoresOts,
    'Sólo tiendas que tuvieron al menos un par-día medido en algún momento de la vigencia. Coincide con la suma de «Tiendas TOP» del PDF.',
  );
  row = factRow(
    sheet,
    row,
    '+ OTS de tiendas sin medición (residuo)',
    attribution.unmeasuredStoresOts,
    'Tiendas sin cámara, o con cámara pero sin ningún par-día medido: no tienen fila propia en «Tiendas TOP», pero sí aportan al total.',
  );
  row = factRow(
    sheet,
    row,
    '= OTS estimados de campaña (reconstruido por tienda)',
    attribution.measuredStoresOts + attribution.unmeasuredStoresOts,
    'Reconstruye exactamente el OTS de portada a partir de las tiendas conocidas más el residuo sin cámara.',
    { strong: true },
  );

  row += 1;
  row = bandTitle(sheet, row, '9 · REGLA APLICADA');
  sheet.mergeCells(row, 1, row + 2, 5);
  const rule = sheet.getCell(row, 1);
  rule.value =
    'La cifra publicada cubre únicamente los formatos con medición. Dentro de cada uno, todo hueco de su rejilla par-día se rellena con el promedio de OTS observado en los par-día de ESE MISMO formato que sí midieron, sea el hueco un soporte sin cámara o un día que la cámara instalada no reportó.\n\nLos formatos sin ninguna medición quedan fuera del OTS y se reportan como alcance adicional: aplicarles el promedio de otro formato supondría que un pasillo y un atrio ven pasar a la misma gente.\n\nEste informe no publica el rendimiento individual de ninguna tienda; la tabla de aportación existe únicamente para auditar la construcción de la cifra agregada.';
  rule.font = { color: { argb: COLORS.text }, size: 9.5 };
  rule.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  for (let offset = 0; offset <= 2; offset += 1) {
    sheet.getRow(row + offset).height = 30;
    for (let col = 1; col <= 5; col += 1) {
      fill(sheet.getCell(row + offset, col), COLORS.sky);
    }
  }
}
