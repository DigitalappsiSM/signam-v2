import type { jsPDF } from 'jspdf';
import type { QuividiCampaignReport } from '@/domain';
import {
  brandAge,
  brandDaily,
  brandDayParts,
  brandFindings,
  brandGender,
  brandHeader,
  brandHours,
  brandKpis,
  brandPeaks,
  brandRecommendations,
  brandSegments,
  brandStoreRows,
  brandWeekdays,
  extendedWindowStores,
  formatCount,
  formatPercent,
  type BrandNote,
  type BrandWeekday,
} from './quividiBrandReport';

/**
 * Informe de audiencia en PDF para la marca.
 *
 * Cinco páginas A4: resultados, comportamiento de la audiencia, perfil,
 * tienda + soporte y cierre con siguientes pasos. El contenido lo decide
 * `quividiBrandReport.ts`; aquí solo se dibuja.
 *
 * El documento se presenta como medición de audiencia de in-Store Media: no
 * menciona proveedores ni plataformas de medición, no incluye metodología,
 * incidencias, comparativos entre periodos ni métricas de costo.
 *
 * `jspdf` y `jspdf-autotable` se cargan con import dinámico para no engrosar
 * el bundle principal.
 */

type RGB = readonly [number, number, number];

const DEEP: RGB = [18, 50, 122];
const BLUE: RGB = [29, 78, 216];
const PINK: RGB = [230, 0, 126];
const INK: RGB = [13, 27, 46];
const MUTED: RGB = [94, 110, 136];
const HAIR: RGB = [226, 233, 244];
const SOFT: RGB = [245, 248, 253];
const WHITE: RGB = [255, 255, 255];

const M = 16;

interface DocWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number };
}

type AutoTable = (doc: jsPDF, options: Record<string, unknown>) => void;

function fill(doc: jsPDF, color: RGB): void {
  doc.setFillColor(color[0], color[1], color[2]);
}

function stroke(doc: jsPDF, color: RGB): void {
  doc.setDrawColor(color[0], color[1], color[2]);
}

function ink(doc: jsPDF, color: RGB): void {
  doc.setTextColor(color[0], color[1], color[2]);
}

function text(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: RGB;
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    maxWidth?: number;
  } = {},
): void {
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  doc.setFontSize(options.size ?? 9);
  ink(doc, options.color ?? INK);
  doc.text(value, x, y, {
    align: options.align ?? 'left',
    ...(options.maxWidth ? { maxWidth: options.maxWidth } : {}),
  });
}

/** Título de sección: cuadro rosa, versalita y filete hasta el margen. */
function section(doc: jsPDF, label: string, y: number, width: number): number {
  fill(doc, PINK);
  doc.rect(M, y - 2.6, 2.2, 2.2, 'F');
  text(doc, label.toUpperCase(), M + 4.4, y, { size: 7.6, bold: true });
  const labelWidth = doc.getTextWidth(label.toUpperCase());
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(M + 6.6 + labelWidth, y - 1, M + width, y - 1);
  return y + 5;
}

/** Cornisa de las páginas interiores. */
function runningHead(
  doc: jsPDF,
  report: QuividiCampaignReport,
  topic: string,
  page: number,
  width: number,
): number {
  fill(doc, SOFT);
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 16, 'F');
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(0, 16, doc.internal.pageSize.getWidth(), 16);
  text(doc, report.campaignName, M, 10, { size: 8.5, bold: true });
  text(doc, topic, M + width / 2, 10, {
    size: 8,
    color: MUTED,
    align: 'center',
  });
  text(doc, `0${page} / 05`, M + width, 10, {
    size: 8,
    bold: true,
    color: BLUE,
    align: 'right',
  });
  return 26;
}

function footer(doc: jsPDF, left: string, right: string, width: number): void {
  const pageH = doc.internal.pageSize.getHeight();
  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  doc.line(M, pageH - 14, M + width, pageH - 14);
  text(doc, left, M, pageH - 9, {
    size: 7,
    color: MUTED,
    maxWidth: width - 30,
  });
  text(doc, right, M + width, pageH - 9, {
    size: 7,
    color: MUTED,
    align: 'right',
  });
}

// ── Gráficas ───────────────────────────────────────────────────────────────

interface Series {
  values: number[];
  color: RGB;
}

/** Líneas de área: dos series en la misma escala de personas, nunca eje doble. */
function lineChart(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  labels: string[],
  series: Series[],
  highlight: readonly boolean[] = [],
): void {
  const max = Math.max(
    1,
    ...series.flatMap((item) => item.values.map((value) => value)),
  );
  const step = labels.length > 1 ? w / (labels.length - 1) : w;

  highlight.forEach((flagged, index) => {
    if (!flagged) return;
    fill(doc, SOFT);
    doc.rect(x + step * index - step / 2, y, step, h, 'F');
  });

  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  for (let tick = 0; tick <= 3; tick += 1) {
    const ty = y + h - (h * tick) / 3;
    doc.line(x, ty, x + w, ty);
    text(doc, formatCount((max * tick) / 3), x - 2, ty + 1.2, {
      size: 6,
      color: MUTED,
      align: 'right',
    });
  }

  for (const item of series) {
    stroke(doc, item.color);
    doc.setLineWidth(0.7);
    item.values.forEach((value, index) => {
      if (index === 0) return;
      const previous = item.values[index - 1] ?? 0;
      doc.line(
        x + step * (index - 1),
        y + h - (previous / max) * h,
        x + step * index,
        y + h - (value / max) * h,
      );
    });
  }

  labels.forEach((label, index) => {
    if (index % 2 !== 0 && index !== labels.length - 1) return;
    text(doc, label, x + step * index, y + h + 4, {
      size: 6,
      color: MUTED,
      align: 'center',
    });
  });
}

/** Barras agrupadas: OTS y Watchers comparten escala de personas. */
function groupedBars(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  labels: string[],
  series: Series[],
): void {
  const max = Math.max(1, ...series.flatMap((item) => item.values));
  const slot = w / Math.max(1, labels.length);
  const barW = Math.min(2.6, (slot - 1.6) / series.length);

  stroke(doc, HAIR);
  doc.setLineWidth(0.2);
  for (let tick = 0; tick <= 2; tick += 1) {
    const ty = y + h - (h * tick) / 2;
    doc.line(x, ty, x + w, ty);
    text(doc, formatCount((max * tick) / 2), x - 2, ty + 1.2, {
      size: 6,
      color: MUTED,
      align: 'right',
    });
  }

  labels.forEach((label, index) => {
    const center = x + slot * index + slot / 2;
    series.forEach((item, seriesIndex) => {
      const value = item.values[index] ?? 0;
      const barH = (value / max) * h;
      fill(doc, item.color);
      doc.rect(
        center + (seriesIndex === 0 ? -barW - 0.3 : 0.3),
        y + h - barH,
        barW,
        barH,
        'F',
      );
    });
    if (index % 2 === 0) {
      text(doc, label, center, y + h + 4, {
        size: 6,
        color: MUTED,
        align: 'center',
      });
    }
  });
}

/** Barras horizontales con etiqueta directa al final de cada barra. */
function horizontalBars(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  labels: string[],
  values: number[],
  notes: string[],
  color: RGB,
): number {
  const max = Math.max(1, ...values);
  const labelW = 42;
  const rowH = 6.4;
  labels.forEach((label, index) => {
    const top = y + rowH * index;
    const value = values[index] ?? 0;
    const barW = Math.max(0.6, (value / max) * (w - labelW - 34));
    text(doc, label, x + labelW - 2, top + 3.4, {
      size: 7,
      bold: true,
      align: 'right',
    });
    fill(doc, color);
    doc.rect(x + labelW, top, barW, 3.6, 'F');
    text(doc, notes[index] ?? '', x + labelW + barW + 2, top + 3.2, {
      size: 6.6,
      color: MUTED,
    });
  });
  return y + rowH * labels.length;
}

/** Barra apilada con leyenda propia: para repartos de dos o tres categorías. */
function stackedBar(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  parts: readonly { label: string; share: number; color: RGB }[],
): number {
  let cursor = x;
  for (const part of parts) {
    const width = (part.share / 100) * w;
    fill(doc, part.color);
    doc.rect(cursor, y, Math.max(width - 0.6, 0.6), 7, 'F');
    if (width > 24) {
      text(doc, formatPercent(part.share), cursor + width / 2, y + 4.6, {
        size: 7,
        bold: true,
        color: WHITE,
        align: 'center',
      });
    }
    cursor += width;
  }
  let legendX = x;
  for (const part of parts) {
    fill(doc, part.color);
    doc.rect(legendX, y + 11, 2.4, 2.4, 'F');
    text(
      doc,
      `${part.label} · ${formatPercent(part.share)}`,
      legendX + 3.6,
      y + 13.3,
      {
        size: 6.6,
        color: MUTED,
      },
    );
    legendX += 42;
  }
  return y + 18;
}

/** Leyenda de series con la definición del término embebida. */
function legend(
  doc: jsPDF,
  x: number,
  y: number,
  entries: readonly { label: string; color: RGB }[],
): void {
  let cursor = x;
  for (const entry of entries) {
    fill(doc, entry.color);
    doc.rect(cursor, y - 2, 2.4, 2.4, 'F');
    text(doc, entry.label, cursor + 3.6, y, { size: 6.6, color: MUTED });
    cursor += doc.getTextWidth(entry.label) + 10;
  }
}

/** Notas al margen: la lectura de negocio junto a la gráfica que la sostiene. */
function marginNotes(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  title: string,
  notes: readonly BrandNote[],
): number {
  text(doc, title.toUpperCase(), x, y, { size: 6.6, bold: true, color: PINK });
  let cursor = y + 3;
  stroke(doc, INK);
  doc.setLineWidth(0.4);
  doc.line(x, cursor, x + w, cursor);
  for (const note of notes) {
    cursor += 4;
    text(doc, note.title, x, cursor, { size: 7, bold: true, maxWidth: w });
    const titleLines = doc.splitTextToSize(note.title, w).length as number;
    cursor += 3 * titleLines;
    text(doc, note.body, x, cursor, { size: 6.6, color: MUTED, maxWidth: w });
    const bodyLines = doc.splitTextToSize(note.body, w).length as number;
    cursor += 2.9 * bodyLines + 2;
    stroke(doc, HAIR);
    doc.setLineWidth(0.2);
    doc.line(x, cursor, x + w, cursor);
  }
  return cursor;
}

// ── Páginas ────────────────────────────────────────────────────────────────

function coverPage(doc: jsPDF, report: QuividiCampaignReport, width: number) {
  const header = brandHeader(report);
  const pageW = doc.internal.pageSize.getWidth();

  fill(doc, DEEP);
  doc.rect(0, 0, pageW, 52, 'F');
  fill(doc, PINK);
  doc.rect(0, 52, pageW * 0.24, 1.4, 'F');
  fill(doc, BLUE);
  doc.rect(pageW * 0.24, 52, pageW * 0.76, 1.4, 'F');

  text(doc, 'in-Store Media', M, 14, { size: 11, bold: true, color: WHITE });
  text(doc, 'REPORTE DE AUDIENCIA', M, 19, {
    size: 6.6,
    color: [168, 196, 247],
  });
  // Co-branding: el retailer siempre; el logo de la marca se embebe cuando
  // existe y, si no, el bloque se colapsa sin dejar hueco.
  text(doc, 'LIVERPOOL', M + width, 16, {
    size: 11,
    bold: true,
    color: WHITE,
    align: 'right',
  });

  text(doc, header.campaignName, M, 36, { size: 20, bold: true, color: WHITE });
  text(
    doc,
    `${header.periodLabel} · ${header.days} días de exhibición`,
    M,
    43,
    { size: 9, color: [207, 224, 255] },
  );

  let y = 64;
  const chips = [
    ['Soporte', header.supports.join(' · ') || '—'],
    ['Tiendas', String(header.stores)],
    ['Pantallas', String(header.screens)],
    ['En pantalla', header.windowLabel],
  ];
  let chipX = M;
  for (const [label, value] of chips) {
    text(doc, label ?? '', chipX, y, { size: 6.4, color: MUTED });
    text(doc, value ?? '', chipX, y + 4, { size: 8.4, bold: true });
    chipX += width / chips.length;
  }

  y = section(doc, 'Resultados de la campaña', y + 14, width);
  const kpis = brandKpis(report);
  const colW = width / 3;
  kpis.forEach((kpi, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const kx = M + colW * col;
    const ky = y + row * 24;
    stroke(doc, HAIR);
    doc.setLineWidth(0.2);
    doc.line(kx, ky, kx + colW - 4, ky);
    text(doc, kpi.label.toUpperCase(), kx, ky + 4, { size: 6.2, color: MUTED });
    text(doc, kpi.value, kx, ky + 12, { size: 16, bold: true, color: DEEP });
    text(doc, kpi.unit, kx, ky + 16, { size: 6.2, color: MUTED });
    text(doc, kpi.meaning, kx, ky + 20, {
      size: 6,
      color: MUTED,
      maxWidth: colW - 6,
    });
  });

  y = section(doc, 'OTS y Watchers día a día', y + 52, width);
  const daily = brandDaily(report);
  const chartW = width - 56;
  lineChart(
    doc,
    M + 8,
    y,
    chartW - 8,
    58,
    daily.map((point) => point.label),
    [
      { values: daily.map((point) => point.ots), color: BLUE },
      { values: daily.map((point) => point.watchers), color: PINK },
    ],
    daily.map((point) => point.weekend),
  );
  legend(doc, M + 8, y + 68, [
    { label: 'OTS · con oportunidad de ver', color: BLUE },
    { label: 'Watchers · que miraron', color: PINK },
  ]);
  marginNotes(
    doc,
    M + chartW + 4,
    y,
    width - chartW - 4,
    'Lo más relevante',
    brandFindings(report),
  );

  footer(
    doc,
    'Medición de audiencia in-Store Media · Datos anónimos y estadísticos: no identifican personas.',
    'Página 1 de 5',
    width,
  );
}

function behaviourPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  width: number,
  autoTable: AutoTable,
) {
  let y = runningHead(doc, report, 'Comportamiento de la audiencia', 2, width);
  const header = brandHeader(report);
  const hours = brandHours(report);
  const chartW = width - 56;

  y = section(doc, 'La audiencia a lo largo de la jornada', y, width);
  text(doc, 'OTS y Watchers por hora', M + 8, y + 2, { size: 8, bold: true });
  text(
    doc,
    `Ventana de exhibición ${header.windowLabel}. La campaña estuvo al aire toda la jornada.`,
    M + 8,
    y + 6,
    { size: 6.4, color: MUTED },
  );
  groupedBars(
    doc,
    M + 8,
    y + 10,
    chartW - 8,
    40,
    hours.map((point) => `${point.hour}h`),
    [
      { values: hours.map((point) => point.ots), color: BLUE },
      { values: hours.map((point) => point.watchers), color: PINK },
    ],
  );
  legend(doc, M + 8, y + 60, [
    { label: 'OTS', color: BLUE },
    { label: 'Watchers', color: PINK },
  ]);

  const parts = brandDayParts(report);
  const weekdays = brandWeekdays(report).filter((day) => day.ots > 0);
  marginNotes(
    doc,
    M + chartW + 4,
    y,
    width - chartW - 4,
    'Lo más relevante',
    behaviourNotes(parts, weekdays),
  );

  y = section(doc, 'Reparto de la jornada y de la semana', y + 70, width);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    tableWidth: width / 2 - 4,
    head: [['Momento', 'OTS', 'Share', 'Conversion']],
    body: parts.map((part) => [
      `${part.label} · ${part.range}`,
      formatCount(part.ots),
      formatPercent(part.share),
      formatPercent(part.conversion),
    ]),
    ...tableStyle(),
  });
  autoTable(doc, {
    startY: y,
    margin: { left: M + width / 2 + 4, right: M },
    tableWidth: width / 2 - 4,
    head: [['Día', 'OTS', 'Share']],
    body: weekdays.map((day) => [
      day.label,
      formatCount(day.ots),
      formatPercent(day.share),
    ]),
    ...tableStyle(),
  });

  const afterTables = (doc as DocWithAutoTable).lastAutoTable.finalY + 8;
  const y2 = section(doc, 'Picos de audiencia del periodo', afterTables, width);
  autoTable(doc, {
    startY: y2,
    margin: { left: M, right: M },
    head: [['Momento', 'Tienda · Soporte', 'OTS', 'Watchers', 'Conversion']],
    body: brandPeaks(report).map((peak) => [
      peak.label,
      `${peak.store} · ${peak.support}`,
      formatCount(peak.ots),
      formatCount(peak.watchers),
      formatPercent(peak.conversion),
    ]),
    ...tableStyle(),
  });

  const extended = extendedWindowStores(report);
  footer(
    doc,
    extended.length > 0
      ? `Horario de exhibición ${header.windowLabel}. ${extended.join(', ')} suma exposición desde las 08:00 h por su ubicación en el área de restaurante.`
      : `Horario de exhibición ${header.windowLabel}.`,
    'Página 2 de 5',
    width,
  );
}

function audiencePage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  width: number,
  autoTable: AutoTable,
) {
  let y = runningHead(doc, report, 'Perfil de la audiencia', 3, width);
  const gender = brandGender(report);
  const age = brandAge(report);
  const totalWatchers = gender.reduce(
    (total, item) => total + item.watchers,
    0,
  );

  y = section(doc, 'Quién mira la pantalla', y, width);
  text(doc, 'Género de los Watchers', M, y + 2, { size: 8, bold: true });
  text(
    doc,
    `Sobre las ${formatCount(totalWatchers)} personas que miraron la pantalla.`,
    M,
    y + 6,
    { size: 6.4, color: MUTED },
  );
  const genderY = stackedBar(
    doc,
    M,
    y + 9,
    width / 2 - 8,
    gender.slice(0, 3).map((item, index) => ({
      label: item.label,
      share: item.share,
      color: index === 0 ? PINK : index === 1 ? BLUE : MUTED,
    })),
  );

  text(doc, 'Rango de edad', M + width / 2 + 4, y + 2, { size: 8, bold: true });
  text(
    doc,
    'Estimación estadística de la audiencia.',
    M + width / 2 + 4,
    y + 6,
    {
      size: 6.4,
      color: MUTED,
    },
  );
  horizontalBars(
    doc,
    M + width / 2 + 4,
    y + 10,
    width / 2 - 4,
    age.map((item) => item.label),
    age.map((item) => item.share),
    age.map((item) => formatPercent(item.share)),
    BLUE,
  );

  const y3 = section(doc, 'Segmentos de audiencia', genderY + 14, width);
  text(
    doc,
    'Cruce de género y edad sobre el total de Watchers: el share indica qué parte de quienes miraron pertenece a cada segmento.',
    M,
    y3,
    { size: 6.4, color: MUTED, maxWidth: width },
  );
  autoTable(doc, {
    startY: y3 + 6,
    margin: { left: M, right: M },
    head: [['Segmento', 'Watchers', 'Share']],
    body: brandSegments(report).map((segment) => [
      segment.label,
      formatCount(segment.watchers),
      formatPercent(segment.share),
    ]),
    ...tableStyle(),
  });

  footer(
    doc,
    'Medición propia sobre audiencia anónima: no se almacenan imágenes ni datos personales.',
    'Página 3 de 5',
    width,
  );
}

function placesPage(
  doc: jsPDF,
  report: QuividiCampaignReport,
  width: number,
  autoTable: AutoTable,
) {
  let y = runningHead(doc, report, 'Tienda y soporte', 4, width);
  const rows = brandStoreRows(report);

  y = section(doc, 'OTS por tienda y soporte', y, width);
  const barsEnd = horizontalBars(
    doc,
    M,
    y,
    width,
    rows.map((row) => row.store),
    rows.map((row) => row.ots),
    rows.map((row) => `${formatCount(row.ots)} · ${formatPercent(row.share)}`),
    BLUE,
  );

  const y2 = section(doc, 'Detalle por tienda', barsEnd + 8, width);
  autoTable(doc, {
    startY: y2,
    margin: { left: M, right: M },
    head: [
      [
        'Tienda · Soporte',
        'Pantallas',
        'OTS',
        'Share',
        'Watchers',
        'Conversion',
        'Día pico',
        'Hora pico',
      ],
    ],
    body: rows.map((row) => [
      `${row.store} · ${row.support}`,
      String(row.screens),
      formatCount(row.ots),
      formatPercent(row.share),
      formatCount(row.watchers),
      formatPercent(row.conversion),
      row.peakWeekday,
      row.peakHour,
    ]),
    ...tableStyle(),
  });

  const y3 = section(
    doc,
    'Rendimiento comparable',
    (doc as DocWithAutoTable).lastAutoTable.finalY + 8,
    width,
  );
  text(
    doc,
    'OTS diarios por tienda-soporte. El índice compara cada tienda con la mediana del circuito en este periodo: 100 es esa mediana.',
    M,
    y3,
    { size: 6.4, color: MUTED, maxWidth: width },
  );
  horizontalBars(
    doc,
    M,
    y3 + 6,
    width,
    rows.map((row) => row.store),
    rows.map((row) => row.index),
    rows.map(
      (row) => `${formatCount(row.dailyOts)} OTS/día · índice ${row.index}`,
    ),
    DEEP,
  );

  footer(
    doc,
    'Día y hora pico: el momento de mayor audiencia de cada tienda, referencia para reforzar promotoría.',
    'Página 4 de 5',
    width,
  );
}

function closingPage(doc: jsPDF, report: QuividiCampaignReport, width: number) {
  let y = runningHead(doc, report, 'Conclusiones y siguientes pasos', 5, width);

  y = section(doc, 'Las cifras de la campaña', y, width);
  const figures = brandKpis(report);
  const colW = width / 3;
  figures.forEach((figure, index) => {
    const fx = M + colW * (index % 3);
    const fy = y + Math.floor(index / 3) * 24;
    stroke(doc, HAIR);
    doc.setLineWidth(0.2);
    doc.line(fx, fy, fx + colW - 4, fy);
    text(doc, figure.label.toUpperCase(), fx, fy + 4, {
      size: 6.2,
      color: MUTED,
    });
    text(doc, figure.value, fx, fy + 12, { size: 14, bold: true, color: DEEP });
    text(doc, figure.meaning, fx, fy + 16.5, {
      size: 6,
      color: MUTED,
      maxWidth: colW - 6,
    });
  });

  y = section(doc, 'Conclusiones', y + 52, width);
  const findings = brandFindings(report);
  const noteW = width / Math.max(1, findings.length) - 4;
  findings.forEach((note, index) => {
    const nx = M + (noteW + 4) * index;
    stroke(doc, index === 1 ? PINK : DEEP);
    doc.setLineWidth(0.6);
    doc.line(nx, y, nx + noteW, y);
    text(doc, note.title, nx, y + 5, { size: 8, bold: true, maxWidth: noteW });
    const titleLines = doc.splitTextToSize(note.title, noteW).length as number;
    text(doc, note.body, nx, y + 5 + 3.6 * titleLines, {
      size: 6.6,
      color: MUTED,
      maxWidth: noteW,
    });
  });

  y = section(doc, 'Siguientes pasos', y + 38, width);
  let cursor = y;
  brandRecommendations(report).forEach((note, index) => {
    fill(doc, BLUE);
    doc.roundedRect(M, cursor - 3, 5, 5, 1, 1, 'F');
    text(doc, String(index + 1), M + 2.5, cursor + 0.6, {
      size: 7,
      bold: true,
      color: WHITE,
      align: 'center',
    });
    text(doc, note.title, M + 8, cursor, { size: 8, bold: true });
    text(doc, note.body, M + 8, cursor + 4, {
      size: 6.8,
      color: MUTED,
      maxWidth: width - 8,
    });
    const lines = doc.splitTextToSize(note.body, width - 8).length as number;
    cursor += 8 + 3.1 * lines;
    stroke(doc, HAIR);
    doc.setLineWidth(0.2);
    doc.line(M, cursor - 3, M + width, cursor - 3);
  });

  footer(
    doc,
    'in-Store Media · Medición de audiencia propia · Datos anónimos y estadísticos.',
    'Página 5 de 5',
    width,
  );
}

function tableStyle(): Record<string, unknown> {
  return {
    theme: 'plain',
    styles: {
      font: 'helvetica',
      fontSize: 7,
      cellPadding: { top: 1.6, bottom: 1.6, left: 1.6, right: 1.6 },
      textColor: [INK[0], INK[1], INK[2]],
      lineColor: [HAIR[0], HAIR[1], HAIR[2]],
      lineWidth: { bottom: 0.1 },
    },
    headStyles: {
      fontSize: 6.2,
      fontStyle: 'bold',
      textColor: [MUTED[0], MUTED[1], MUTED[2]],
      lineColor: [INK[0], INK[1], INK[2]],
      lineWidth: { bottom: 0.3 },
    },
    columnStyles: { 0: { halign: 'left' } },
    didParseCell: (data: {
      column: { index: number };
      cell: { styles: { halign: string } };
    }) => {
      if (data.column.index > 0) data.cell.styles.halign = 'right';
    },
  };
}

// ── Lectura específica de la página 2 ──────────────────────────────────────

function behaviourNotes(
  parts: readonly { label: string; range: string; share: number }[],
  weekdays: readonly BrandWeekday[],
): BrandNote[] {
  const notes: BrandNote[] = [];
  const top = [...parts].sort((a, b) => b.share - a.share)[0];
  if (top) {
    notes.push({
      title: 'Cobertura continua',
      body: `La campaña estuvo al aire toda la jornada: el pico de ${top.range}, que concentra el ${formatPercent(top.share)} de los OTS, quedó cubierto de principio a fin.`,
    });
  }
  const weekend = weekdays
    .filter((day) => day.weekend)
    .reduce((total, day) => total + day.share, 0);
  if (weekend > 0) {
    notes.push({
      title: 'Dónde reforzar piso',
      body: `El fin de semana aporta el ${formatPercent(weekend)} de los OTS de la semana: es la referencia para programar promotoría y activaciones.`,
    });
  }
  return notes;
}

// ── API pública ────────────────────────────────────────────────────────────

/** Genera el informe de audiencia de la campaña y lo devuelve como Blob. */
export async function buildQuividiCampaignPdfBlob(
  report: QuividiCampaignReport,
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable'))
    .default as unknown as AutoTable;

  const doc = new JsPdf({ unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth() - M * 2;

  coverPage(doc, report, width);
  doc.addPage();
  behaviourPage(doc, report, width, autoTable);
  doc.addPage();
  audiencePage(doc, report, width, autoTable);
  doc.addPage();
  placesPage(doc, report, width, autoTable);
  doc.addPage();
  closingPage(doc, report, width);

  return doc.output('blob');
}

/** Nombre del archivo, con la misma forma que el resto de exportaciones. */
export function quividiCampaignPdfFileName(
  report: QuividiCampaignReport,
): string {
  const safe = report.campaignName.replace(/[\\/:*?"<>|]/g, '_').trim();
  return `Audiencia_${safe || 'campana'}_${report.startDate}_${report.endDate}.pdf`;
}
