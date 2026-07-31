import {
  summarizeIssues,
  type ConsolidationResult,
  type ConsolidationIssue,
  type IssueCode,
} from '@/modules/consolidation/consolidate';

/**
 * Reporte de incidencias en PDF para compartir con Liverpool.
 *
 * `jspdf` y `jspdf-autotable` se importan de forma dinámica para no engrosar el
 * bundle principal. El diseño usa una franja de marca, un resumen ejecutivo en
 * tarjetas, tablas por tipo/soporte y el detalle completo, con pie de página
 * numerado. Toda la lógica de datos (etiquetas, filas, métricas) es pura y está
 * cubierta por pruebas; el dibujado del PDF vive en `buildIssuesPdf`.
 */

/** Etiquetas legibles por tipo de incidencia. */
export const ISSUE_LABELS: Record<IssueCode, string> = {
  'store-not-in-catalog': 'Tienda no existe en el catálogo',
  'store-support-mismatch': 'Tienda sin ese soporte (posible error de captura)',
  'screen-inactive': 'Pantalla inactiva',
  'support-not-in-catalog': 'Soporte sin pantallas en el catálogo',
};

function labelFor(code: string): string {
  return ISSUE_LABELS[code as IssueCode] ?? code;
}

export interface IssueDetailOptions {
  /** Incluir la columna "Campaña" (útil solo si el reporte abarca varias). */
  includeCampaign?: boolean;
}

/**
 * Filas de detalle para el reporte, ordenadas por campaña y soporte. Con
 * `includeCampaign` (por defecto) cada fila es `[campaña, soporte, tienda,
 * tipo]`; sin ella, `[soporte, tienda, tipo]` (reporte de una sola campaña).
 */
export function issueDetailRows(
  result: ConsolidationResult,
  opts: IssueDetailOptions = {},
): string[][] {
  const includeCampaign = opts.includeCampaign ?? true;
  return [...result.issues]
    .sort(
      (a, b) =>
        a.campaign.localeCompare(b.campaign, 'es') ||
        a.support.localeCompare(b.support, 'es') ||
        (a.store ?? '').localeCompare(b.store ?? '', 'es'),
    )
    .map((i) =>
      includeCampaign
        ? [i.campaign, i.support, i.store ?? '—', labelFor(i.code)]
        : [i.support, i.store ?? '—', labelFor(i.code)],
    );
}

/** Métricas concisas para el resumen ejecutivo del reporte. */
export interface IssuesMetrics {
  total: number;
  /** Tipos de incidencia distintos. */
  typeCount: number;
  /** Soportes afectados distintos. */
  supportCount: number;
  /** Tiendas afectadas distintas (ignora incidencias sin tienda). */
  storeCount: number;
  /** Soportes InStore Media excluidos de la consolidación. */
  instoreExcluded: number;
}

export function issuesSummaryMetrics(
  result: ConsolidationResult,
): IssuesMetrics {
  const types = new Set<string>();
  const supports = new Set<string>();
  const stores = new Set<string>();
  for (const i of result.issues) {
    types.add(i.code);
    supports.add(i.support);
    if (i.store) stores.add(i.store);
  }
  return {
    total: result.issues.length,
    typeCount: types.size,
    supportCount: supports.size,
    storeCount: stores.size,
    instoreExcluded: result.excludedInstore.length,
  };
}

/**
 * Campaña sujeto del reporte: si todas las incidencias son de una sola campaña,
 * la devuelve; si hay varias (o ninguna), devuelve `fallback`.
 */
export function subjectCampaign(
  issues: readonly ConsolidationIssue[],
  fallback: string | null = null,
): string | null {
  const set = new Set(issues.map((i) => i.campaign));
  if (set.size === 1) return [...set][0] ?? fallback;
  return fallback;
}

function pct(n: number, total: number): string {
  return total > 0 ? `${Math.round((n / total) * 100)}%` : '0%';
}

interface DocWithAutoTable {
  lastAutoTable: { finalY: number };
}

// Paleta del reporte (gama azul, en línea con la app).
const NAVY: [number, number, number] = [30, 58, 138]; // franja superior + detalle
const BLUE: [number, number, number] = [37, 99, 235]; // acentos + resúmenes
const DARK: [number, number, number] = [30, 41, 59];
const MUTED: [number, number, number] = [100, 116, 139];
const BORDER: [number, number, number] = [219, 227, 240];
const ROW_ALT: [number, number, number] = [240, 245, 252];
const ACCENT_TINT: [number, number, number] = [235, 242, 254];
const ACCENT_BORDER: [number, number, number] = [147, 197, 253];

export interface IssuesPdfMeta {
  campaignName?: string;
  calendarName?: string;
}

/** Genera el PDF del reporte de incidencias y lo devuelve como Blob. */
export async function buildIssuesPdf(
  result: ConsolidationResult,
  meta: IssuesPdfMeta = {},
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 14;
  const contentW = pageW - M * 2;
  const finalY = () =>
    (doc as unknown as DocWithAutoTable).lastAutoTable.finalY;

  // --- Franja de marca ---
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 30, 'F');
  // Banda de acento más clara al pie de la franja.
  doc.setFillColor(...BLUE);
  doc.rect(0, 30, pageW, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('SIGNAM V2', M, 12);
  doc.setFontSize(18);
  doc.text('Reporte de incidencias', M, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const now = new Date().toLocaleString('es-MX');
  doc.text(`Generado: ${now}`, pageW - M, 12, { align: 'right' });
  doc.text('Confidencial · Liverpool / Admira', pageW - M, 18, {
    align: 'right',
  });

  // --- Sujeto (campaña / calendario) ---
  const subject = subjectCampaign(result.issues, meta.campaignName ?? null);
  let y = 40;
  doc.setTextColor(...MUTED);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('CAMPAÑA', M, y);
  doc.setTextColor(...DARK);
  doc.setFontSize(14);
  doc.text(subject ?? 'Todas las campañas', M, y + 6.5);
  y += 6.5;
  if (meta.calendarName) {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Calendario: ${meta.calendarName}`, M, y + 6);
    y += 6;
  }
  y += 9;

  const metrics = issuesSummaryMetrics(result);

  // --- Estado sin incidencias ---
  if (metrics.total === 0) {
    doc.setDrawColor(167, 216, 184);
    doc.setFillColor(232, 245, 236);
    doc.roundedRect(M, y, contentW, 24, 2, 2, 'FD');
    doc.setTextColor(33, 110, 57);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Sin incidencias', M + 6, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text(
      'Esta campaña cruza correctamente contra el catálogo activo: no hay',
      M + 6,
      y + 16,
    );
    doc.text('tiendas ni soportes con errores.', M + 6, y + 21);
    drawFooter(doc, pageW, pageH, M);
    return doc.output('blob');
  }

  // --- Resumen ejecutivo (tarjetas) ---
  const cards: { value: number; label: string; accent: boolean }[] = [
    { value: metrics.total, label: 'Incidencias', accent: true },
    { value: metrics.typeCount, label: 'Tipos', accent: false },
    { value: metrics.supportCount, label: 'Soportes afectados', accent: false },
    { value: metrics.storeCount, label: 'Tiendas afectadas', accent: false },
  ];
  const gap = 4;
  const cardW = (contentW - gap * (cards.length - 1)) / cards.length;
  const cardH = 20;
  cards.forEach((c, i) => {
    drawStatCard(
      doc,
      M + i * (cardW + gap),
      y,
      cardW,
      cardH,
      String(c.value),
      c.label,
      c.accent,
    );
  });
  y += cardH + 6;

  if (metrics.instoreExcluded > 0) {
    doc.setTextColor(...MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `Soportes InStore Media (Muppi's / Pendón) excluidos de la consolidación: ${metrics.instoreExcluded}`,
      M,
      y,
    );
    y += 6;
  }

  const summary = summarizeIssues(result.issues);

  // --- Resumen por tipo ---
  y = sectionTitle(doc, M, y + 2, 'Resumen por tipo');
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [['Tipo de incidencia', 'Cantidad', '%']],
    body: Object.entries(summary.byCode)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => [labelFor(c), String(n), pct(n, metrics.total)]),
    theme: 'striped',
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      textColor: DARK,
      lineColor: BORDER,
      lineWidth: 0.1,
    },
    headStyles: { fillColor: BLUE, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: ROW_ALT },
    columnStyles: {
      1: { halign: 'right', cellWidth: 26 },
      2: { halign: 'right', cellWidth: 18 },
    },
  });

  // --- Resumen por soporte ---
  y = sectionTitle(doc, M, finalY() + 10, 'Resumen por soporte');
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [['Soporte', 'Incidencias', '%']],
    body: Object.entries(summary.bySupport)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => [s, String(n), pct(n, metrics.total)]),
    theme: 'striped',
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      textColor: DARK,
      lineColor: BORDER,
      lineWidth: 0.1,
    },
    headStyles: { fillColor: BLUE, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: ROW_ALT },
    columnStyles: {
      1: { halign: 'right', cellWidth: 26 },
      2: { halign: 'right', cellWidth: 18 },
    },
  });

  // --- Detalle de incidencias ---
  const includeCampaign =
    new Set(result.issues.map((i) => i.campaign)).size > 1;
  const detailHead = includeCampaign
    ? ['Campaña', 'Soporte', 'Tienda', 'Incidencia']
    : ['Soporte', 'Tienda', 'Incidencia'];
  y = sectionTitle(doc, M, finalY() + 10, 'Detalle de incidencias');
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [detailHead],
    body: issueDetailRows(result, { includeCampaign }),
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      textColor: DARK,
      lineColor: BORDER,
      lineWidth: 0.1,
      overflow: 'linebreak',
    },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: ROW_ALT },
  });

  drawFooter(doc, pageW, pageH, M);
  return doc.output('blob');
}

/** Título de sección con barra de acento; devuelve la Y para la tabla siguiente. */
function sectionTitle(
  doc: import('jspdf').jsPDF,
  x: number,
  y: number,
  text: string,
): number {
  doc.setFillColor(...BLUE);
  doc.rect(x, y - 3.2, 1.6, 4.6, 'F');
  doc.setTextColor(...DARK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(text, x + 4, y);
  doc.setFont('helvetica', 'normal');
  return y + 3;
}

/** Tarjeta de estadística del resumen ejecutivo. */
function drawStatCard(
  doc: import('jspdf').jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  label: string,
  accent: boolean,
): void {
  doc.setDrawColor(
    accent ? ACCENT_BORDER[0] : BORDER[0],
    accent ? ACCENT_BORDER[1] : BORDER[1],
    accent ? ACCENT_BORDER[2] : BORDER[2],
  );
  doc.setFillColor(
    accent ? ACCENT_TINT[0] : 246,
    accent ? ACCENT_TINT[1] : 248,
    accent ? ACCENT_TINT[2] : 251,
  );
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  if (accent) doc.setTextColor(...BLUE);
  else doc.setTextColor(...DARK);
  doc.text(value, x + w / 2, y + 10, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x + w / 2, y + 15.5, {
    align: 'center',
    maxWidth: w - 4,
  });
}

/** Pie de página numerado en todas las páginas. */
function drawFooter(
  doc: import('jspdf').jsPDF,
  pageW: number,
  pageH: number,
  M: number,
): void {
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(M, pageH - 12, pageW - M, pageH - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('SIGNAM V2 · Reporte de incidencias', M, pageH - 7);
    doc.text(`Página ${p} de ${pageCount}`, pageW - M, pageH - 7, {
      align: 'right',
    });
  }
}
