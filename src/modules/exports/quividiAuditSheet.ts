import type { Cell, Workbook, Worksheet } from 'exceljs';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandCampaignSummary,
  brandExtrapolationByReason,
  brandFormatRate,
  brandPartialDay,
  brandSingleCameraDuplication,
  brandStoreAttribution,
  brandOperationalReport,
  brandStoreAudit,
  formatCivilDate,
  partialDayLabel,
} from './quividiBrandReport';
import {
  brandGapFill,
  gapFillMethodLabel,
  type BrandGapFillEntry,
} from './quividiGapFill';

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
 *
 * Es también el único lugar donde se distingue lo estimado con el promedio
 * propio de cada pantalla (`quividiGapFill.ts`): el PDF lo publica igual que
 * lo medido, y aquí cada celda estimada va en amarillo con una nota.
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
  /** Celdas estimadas con el promedio propio de la pantalla. */
  yellow: 'FFFFF176',
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

/** Marca una celda como estimada: amarillo y nota con cómo se estimó. */
function markEstimated(cell: Cell, note: string): void {
  fill(cell, COLORS.yellow);
  cell.font = { bold: true, color: { argb: COLORS.text } };
  cell.note = note;
}

const REASON_LABELS: Record<BrandGapFillEntry['reason'], string> = {
  'missing-day': 'Día sin dato',
  'missing-hours': 'Horas sin dato',
  'missing-face': 'Cara sin cámara',
};

/** Motivo con las horas estimadas cuando el día sí midió algo. */
function reasonLabel(entry: BrandGapFillEntry): string {
  return entry.reason === 'missing-hours'
    ? `${REASON_LABELS[entry.reason]} (${entry.missingHours} h)`
    : REASON_LABELS[entry.reason];
}

function fillDateLabel(entry: BrandGapFillEntry): string {
  const date = formatCivilDate(entry.date);
  return entry.missingHours > 0 ? `${date} (${entry.missingHours} h)` : date;
}

function gapFillNote(entry: BrandGapFillEntry): string {
  const where = [
    entry.storeNumber,
    entry.storeName,
    entry.support,
    entry.locationName,
  ]
    .filter(Boolean)
    .join(' · ');
  return `${where} — ${formatCivilDate(entry.date)}. Estimado: ${gapFillMethodLabel(entry)}. Se publica en el PDF igual que lo medido.`;
}

function headerRow(sheet: Worksheet, row: number, labels: string[]): number {
  labels.forEach((label, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 9 };
    cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
    fill(cell, COLORS.blue);
  });
  sheet.getRow(row).height = 24;
  return row + 1;
}

function tableRow(
  sheet: Worksheet,
  row: number,
  values: Array<number | string>,
  wrapColumns: readonly number[],
): void {
  values.forEach((value, index) => {
    const cell = sheet.getCell(row, index + 1);
    cell.value = value;
    if (typeof value === 'number') cell.numFmt = INT;
    cell.alignment = {
      vertical: 'middle',
      wrapText: wrapColumns.includes(index + 1),
      horizontal: typeof value === 'number' ? 'right' : 'left',
      indent: 1,
    };
  });
  sheet.getRow(row).height = 30;
}

/**
 * Sección de rellenos con promedio propio: resumen por tienda + soporte (+
 * cámara en zona partida) y detalle día a día. Usa la franja operativa
 * 10:00–22:00 del PDF, así que sus OTS son exactamente los que suma el PDF.
 */
function addGapFillSection(
  sheet: Worksheet,
  startRow: number,
  report: QuividiCampaignReport,
): number {
  const fills = brandGapFill(brandOperationalReport(report)).fills;
  let row = bandTitle(
    sheet,
    startRow,
    '11 · HORAS Y DÍAS ESTIMADOS CON EL PROMEDIO PROPIO DE CADA CÁMARA',
  );
  sheet.mergeCells(row, 1, row, 7);
  const note = sheet.getCell(row, 1);
  note.value =
    'Regla (Mupis y Banners): lo que una cámara no midió dentro de la franja 10:00–22:00 se completa con el promedio de ESA misma tienda + soporte + cámara — total diario de sus días completos (12 h medidas) entre semana (lunes a viernes) o fin de semana (sábado y domingo); si no tiene ese tipo de día, de todos sus días completos, y si no tiene ninguno completo, de sus días medidos. Cada hora sin dato vale ese promedio ÷ 12; un día sin ninguna hora, el promedio completo. Con 2 cámaras se rellena cada una y luego se combina: zona partida (Mupi de Insurgentes, BANNER DIGITAL) suma; el resto toma la más alta × 2 (lo estimado sólo cuenta cuando supera a lo medido). En zona partida, una cara sin cámara copia día a día el valor de su cara hermana. Lo estimado se publica en el PDF igual que lo medido; aquí va en amarillo. Cifras de la franja 10:00–22:00, las mismas que suma el PDF.';
  note.font = { italic: true, color: { argb: COLORS.text }, size: 8.5 };
  note.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  sheet.getRow(row).height = 96;
  row += 1;

  if (fills.length === 0) {
    sheet.mergeCells(row, 1, row, 7);
    const cell = sheet.getCell(row, 1);
    cell.value =
      'Ninguna cámara con medición tuvo horas ni días sin dato: no se estimó nada con promedio propio.';
    cell.font = { color: { argb: COLORS.muted }, size: 9 };
    cell.alignment = { vertical: 'middle', indent: 1 };
    return row + 1;
  }

  row += 1;
  row = headerRow(sheet, row, [
    'Tienda · Soporte',
    'Cámara / cara',
    'Días con estimación',
    'Fechas (horas estimadas)',
    'OTS estimados (PDF)',
    'Watchers estimados',
    'Cómo se estimó',
  ]);
  const groups = new Map<string, BrandGapFillEntry[]>();
  for (const entry of fills) {
    const key = `${entry.storeNumber}|${entry.support}|${entry.locationId ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  for (const entries of groups.values()) {
    const first = entries[0]!;
    const methods = Array.from(
      new Set(entries.map((entry) => gapFillMethodLabel(entry))),
    );
    tableRow(
      sheet,
      row,
      [
        `${first.storeNumber} · ${first.storeName} · ${first.support}`,
        first.locationName || 'Par completo',
        entries.length,
        entries.map(fillDateLabel).join(', '),
        entries.reduce((total, entry) => total + entry.publishedOts, 0),
        entries.reduce((total, entry) => total + entry.publishedWatchers, 0),
        methods.join(' · '),
      ],
      [4, 7],
    );
    const reasons = Array.from(
      new Set(entries.map((entry) => REASON_LABELS[entry.reason])),
    );
    const explanation = `${reasons.join(' · ')}: ${methods.join(' · ')}.`;
    markEstimated(sheet.getCell(row, 5), explanation);
    markEstimated(sheet.getCell(row, 6), explanation);
    row += 1;
  }
  row = factRow(
    sheet,
    row,
    'OTS estimados con promedio propio (PDF)',
    fills.reduce((total, entry) => total + entry.publishedOts, 0),
    'Ya incluidos en la cifra del PDF, dentro de «Tiendas TOP» de cada tienda.',
    { strong: true },
  );

  row += 1;
  row = headerRow(sheet, row, [
    'Tienda · Soporte',
    'Cámara / cara',
    'Fecha',
    'Motivo',
    'OTS estimados (PDF)',
    'Watchers estimados',
    'Cómo se estimó',
  ]);
  for (const entry of fills) {
    tableRow(
      sheet,
      row,
      [
        `${entry.storeNumber} · ${entry.storeName} · ${entry.support}`,
        entry.locationName || 'Par completo',
        formatCivilDate(entry.date),
        reasonLabel(entry),
        entry.publishedOts,
        entry.publishedWatchers,
        gapFillMethodLabel(entry),
      ],
      [7],
    );
    const explanation = gapFillNote(entry);
    markEstimated(sheet.getCell(row, 5), explanation);
    markEstimated(sheet.getCell(row, 6), explanation);
    row += 1;
  }
  return row;
}

export function addQuividiAuditSheet(
  wb: Workbook,
  input: QuividiCampaignReport,
): void {
  // Misma regla que el PDF: huecos completados con el promedio propio de cada
  // pantalla antes de reconstruir la cifra.
  const report = brandGapFill(input).report;
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
    { width: 44 },
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
    'Completos más parciales: sólo lo medido de verdad.',
    { strong: true },
  );
  row = factRow(
    sheet,
    row,
    'Par-día sin dato completados con promedio propio',
    basis.filledPairDays,
    'La pantalla sí midió otros días: se completa con SU promedio (ver sección 11). Además, en BANNER DIGITAL se completan caras sueltas dentro de días medidos.',
  );
  if (basis.filledPairDays > 0) {
    markEstimated(
      sheet.getCell(row - 1, 2),
      'Par-día enteramente estimados con el promedio propio de la pantalla. Detalle en la sección 11.',
    );
  }

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
    // Base sin par-día enteramente rellenados: la misma que usa el PDF.
    const perPairDay = brandFormatRate(format);
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
    '+ OTS completados con promedio propio',
    summary.filledOts,
    'Días y caras sin dato de pantallas que sí midieron, con el promedio de esa misma pantalla. Aquí por día completo; la sección 11 detalla la franja 10:00–22:00 del PDF.',
  );
  if (summary.filledOts > 0) {
    markEstimated(
      sheet.getCell(row - 1, 2),
      'Estimado con el promedio propio de cada pantalla (entre semana / fin de semana). Detalle por tienda, soporte y cámara en la sección 11.',
    );
  }
  const partial = brandPartialDay(report);
  if (partial) {
    row = factRow(
      sheet,
      row,
      '— de ellos, día incompleto',
      summary.partialOts,
      `${formatCivilDate(partial.date)} · ${partialDayLabel(partial.until)}. Sólo lo medido: queda fuera de la rejilla, no entra al promedio y no se extrapola.`,
    );
  }
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
    'De los cuales, extrapolados por formato',
    summary.extrapolatedOts,
    `${scope.measurablePairDays - scope.measuredPairDays} par-día de pantallas sin ningún día medido o sin cámara, completados con el promedio de su formato.`,
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
    'OTS publicados',
    'Soportes con cámara',
    'OTS ajustados',
    'De ellos, promedio propio',
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

    // Detalle de la duplicación: igual a «OTS medidos» salvo que el soporte
    // tenga 1 cámara, o 2 fuera de zona partida, caso en el que viene
    // duplicado (ver sección 10).
    const publishedCell = sheet.getCell(row, 5);
    publishedCell.value = store.publishedOts;
    publishedCell.numFmt = INT;
    publishedCell.alignment = { vertical: 'middle', horizontal: 'right' };
    if (store.publishedOts !== store.measuredOts) {
      fill(publishedCell, COLORS.amberPale);
      publishedCell.font = { color: { argb: COLORS.amber } };
    }

    const pairsCell = sheet.getCell(row, 6);
    pairsCell.value = store.pairs;
    pairsCell.alignment = { vertical: 'middle', horizontal: 'right' };

    // Sólo las tiendas con al menos un par-día en un formato medible tienen
    // OTS ajustados: una tienda cuyo único soporte es un formato sin ninguna
    // medición (fuera de la cifra) no participa del ajuste.
    const adjustedCell = sheet.getCell(row, 7);
    const adjusted = adjustedByStore.get(store.storeNumber);
    adjustedCell.value = adjusted ?? '—';
    if (typeof adjusted === 'number') adjustedCell.numFmt = INT;
    adjustedCell.alignment = { vertical: 'middle', horizontal: 'right' };

    const filledCell = sheet.getCell(row, 8);
    filledCell.value = store.filledOts;
    filledCell.numFmt = INT;
    filledCell.alignment = { vertical: 'middle', horizontal: 'right' };

    if (row % 2 === 0) {
      for (let col = 1; col <= 8; col += 1)
        fill(sheet.getCell(row, col), COLORS.pale);
    }
    if (store.filledOts > 0) {
      markEstimated(
        filledCell,
        `${store.storeNumber} · ${store.storeName}: OTS completados con el promedio propio de sus pantallas (días o caras sin dato). Detalle en la sección 11.`,
      );
    }
    row += 1;
  }

  if (coverage.estimatedStores > 0) {
    sheet.mergeCells(row, 1, row, 7);
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
    'La cifra publicada cubre únicamente los formatos con medición. Un día que una pantalla no reportó se completa con el promedio de ESA MISMA pantalla (tienda + soporte), entre semana o fin de semana según el día; en BANNER DIGITAL, cara a cara, y una cara sin cámara copia día a día a su cara hermana (sección 11). Sólo una pantalla que no midió ningún día, o un soporte sin cámara, se completa con el promedio de su formato.\n\nLos formatos sin ninguna medición quedan fuera del OTS y se reportan como alcance adicional: aplicarles el promedio de otro formato supondría que un pasillo y un atrio ven pasar a la misma gente.\n\nLos pares de una sola cámara configurada se duplican (ver sección 10): la mayoría son en realidad 2 pantallas en el mismo sitio. Los pares de 2+ cámaras no se duplican: ahí la combinación ya resuelve zona partida, brecha entre cámaras o promedio.\n\nEste informe no publica el rendimiento individual de ninguna tienda; la tabla de aportación existe únicamente para auditar la construcción de la cifra agregada.';
  rule.font = { color: { argb: COLORS.text }, size: 9.5 };
  rule.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  for (let offset = 0; offset <= 2; offset += 1) {
    sheet.getRow(row + offset).height = 30;
    for (let col = 1; col <= 5; col += 1) {
      fill(sheet.getCell(row + offset, col), COLORS.sky);
    }
  }
  row += 3;

  const duplication = brandSingleCameraDuplication(report);
  row += 1;
  row = bandTitle(sheet, row, '10 · DUPLICACIÓN DE LA CIFRA (1 Y 2 CÁMARAS)');
  sheet.mergeCells(row, 1, row, 5);
  const duplicationNote = sheet.getCell(row, 1);
  duplicationNote.value =
    'Directriz de negocio (no una regla de extrapolación): la mayoría de los circuitos tienen 2 pantallas en el mismo sitio y la cámara mide una. Con 1 cámara se duplica su lectura; con 2 cámaras se toma la más alta y se duplica. Se excluyen la zona partida (Insurgentes, Banner Digital), que suma sus 2 cámaras, los circuitos de 3+ cámaras y los formatos sin ninguna medición.';
  duplicationNote.font = {
    italic: true,
    color: { argb: COLORS.amber },
    size: 8.5,
  };
  duplicationNote.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
  sheet.getRow(row).height = 34;
  row += 1;

  row = factRow(
    sheet,
    row,
    'Pares duplicados (circuito medible)',
    duplication.pairs,
    'Tienda+soporte con 1 cámara configurada, o 2 cámaras fuera de zona partida, dentro de los formatos con medición.',
  );
  row = factRow(
    sheet,
    row,
    'OTS medidos en esos pares, sin duplicar',
    duplication.measuredOts,
    'Lo que reportó la cámara (o la más alta de las dos), antes de cualquier ajuste de negocio.',
  );
  row = factRow(
    sheet,
    row,
    '+ OTS añadidos por duplicación',
    duplication.addedOts,
    'Igual a «OTS medidos en esos pares, sin duplicar»: duplicar es sumarlo una vez más.',
  );
  row = factRow(
    sheet,
    row,
    '= OTS publicados de esos pares (ya incluidos arriba)',
    duplication.publishedOts,
    'Esta cifra ya forma parte de «OTS medidos» y «OTS estimados de campaña» de la sección 3 — no se suma de nuevo.',
    { strong: true },
  );

  row += 1;
  addGapFillSection(sheet, row, input);
}
