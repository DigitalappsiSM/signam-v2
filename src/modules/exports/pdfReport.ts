import {
  summarizeIssues,
  type ConsolidationResult,
  type IssueCode,
} from '@/modules/consolidation/consolidate';

/**
 * Reporte de incidencias en PDF para compartir con Liverpool.
 *
 * `jspdf` y `jspdf-autotable` se importan de forma dinámica para no engrosar el
 * bundle principal.
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

/** Filas de detalle para el reporte: [campaña, soporte, tienda, tipo]. */
export function issueDetailRows(result: ConsolidationResult): string[][] {
  return [...result.issues]
    .sort(
      (a, b) =>
        a.campaign.localeCompare(b.campaign, 'es') ||
        a.support.localeCompare(b.support, 'es'),
    )
    .map((i) => [i.campaign, i.support, i.store ?? '—', labelFor(i.code)]);
}

interface DocWithAutoTable {
  lastAutoTable: { finalY: number };
}

/** Genera el PDF del reporte de incidencias y lo devuelve como Blob. */
export async function buildIssuesPdf(
  result: ConsolidationResult,
  meta: { calendarName?: string } = {},
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF();
  const summary = summarizeIssues(result.issues);
  const now = new Date().toLocaleString('es-MX');

  doc.setFontSize(16);
  doc.text('SIGNAM V2 — Reporte de incidencias', 14, 18);
  doc.setFontSize(10);
  doc.text(`Generado: ${now}`, 14, 25);
  if (meta.calendarName) doc.text(`Calendario: ${meta.calendarName}`, 14, 31);
  doc.text(
    `Total de incidencias: ${summary.total}`,
    14,
    meta.calendarName ? 37 : 31,
  );

  const finalY = () =>
    (doc as unknown as DocWithAutoTable).lastAutoTable.finalY;

  autoTable(doc, {
    startY: (meta.calendarName ? 37 : 31) + 6,
    head: [['Tipo de incidencia', 'Cantidad']],
    body: Object.entries(summary.byCode).map(([c, n]) => [
      labelFor(c),
      String(n),
    ]),
    styles: { fontSize: 9 },
  });

  autoTable(doc, {
    startY: finalY() + 6,
    head: [['Soporte', 'Incidencias']],
    body: Object.entries(summary.bySupport)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => [s, String(n)]),
    styles: { fontSize: 9 },
  });

  autoTable(doc, {
    startY: finalY() + 6,
    head: [['Campaña', 'Soporte', 'Tienda', 'Tipo']],
    body: issueDetailRows(result),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [225, 10, 29] },
  });

  return doc.output('blob');
}
