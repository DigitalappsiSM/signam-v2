import { incidentAnalytics } from '@/domain/odooAnalytics';
import { summarizeIncidents, type OdooIncident } from '@/domain/odooIncidents';
export async function buildOdooWorkbook(
  tickets: OdooIncident[],
  month: string,
  reference: string,
  filters: Record<string, string>,
) {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  workbook.creator = 'SIGNAM · in-Store Media';
  workbook.created = new Date(reference);
  const analytics = incidentAnalytics(tickets, month, reference);
  const summary = summarizeIncidents(tickets);
  const sheet = (
    name: string,
    headers: string[],
    rows: (string | number | null)[][],
  ) => {
    const ws = workbook.addWorksheet(name, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.addRow(headers);
    rows.forEach((row) =>
      ws.addRow(row.map((value) => (value === null ? 'Sin dato' : value))),
    );
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF10243F' },
    };
    ws.getRow(1).height = 28;
    ws.columns.forEach((column, index) => {
      column.width = index === 0 ? 32 : 24;
      column.alignment = { vertical: 'top', wrapText: true };
    });
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, rows.length + 1), column: headers.length },
    };
    return ws;
  };
  sheet(
    'Resumen',
    ['Indicador', 'Valor'],
    [
      ['Mes de creación', month],
      ['Consulta (UTC)', reference],
      ['Tickets', summary.total],
      ['Abiertos', summary.open],
      ['Resueltos', summary.closed],
      ['SLA incumplidos', summary.failed],
      ['SLA cumplimiento (%)', summary.compliance],
      ['Tickets con resultado SLA', summary.evaluated],
      ['Primera respuesta media (h)', summary.firstResponse.value],
      ['Muestra primera respuesta', summary.firstResponse.count],
      ['Resolución media (h)', summary.resolution.value],
      ['Muestra resolución', summary.resolution.count],
      ['Respuesta mediana (h)', analytics.responseMedian],
      ['Respuesta P90 (h)', analytics.responseP90],
      ['Resolución mediana (h)', analytics.closureMedian],
      ['Resolución P90 (h)', analytics.closureP90],
      ...Object.entries(filters).map(
        ([key, value]) => [key, value || 'Todos'] as [string, string],
      ),
    ],
  );
  const detail = sheet(
    'Tickets',
    [
      'ID',
      'Título',
      'Retailer',
      'Tienda',
      'Categoría',
      'Atención',
      'Solicitante',
      'Responsable',
      'Estado',
      'SLA',
      'Creación UTC',
      'Cierre UTC',
      'Primera respuesta (h Odoo)',
      'Resolución (h Odoo)',
      'Etiquetas',
      'Enlace Odoo',
    ],
    tickets.map((ticket) => [
      ticket.id,
      ticket.title,
      ticket.retailer,
      ticket.store,
      ticket.category,
      ticket.modality,
      ticket.requester,
      ticket.assignee,
      ticket.stage,
      ticket.sla,
      ticket.createdAt,
      ticket.closedAt,
      ticket.firstResponseHours,
      ticket.resolutionHours,
      ticket.tags.join(' · '),
      ticket.url,
    ]),
  );
  detail.getColumn(2).width = 55;
  sheet(
    'Políticas SLA',
    ['Ticket', 'Política', 'Resultado Odoo', 'Límite UTC'],
    tickets.flatMap((ticket) =>
      ticket.policies.map((policy) => [
        ticket.id,
        policy.name,
        policy.status,
        policy.deadline,
      ]),
    ),
  );
  for (const [name, groups] of [
    ['Retailers', analytics.retailers],
    ['Categorías', analytics.categories],
    ['Atención', analytics.modalities],
    ['Responsables', analytics.assignees],
    ['Solicitantes', analytics.requesters],
  ] as const) {
    sheet(
      name,
      [
        'Nombre',
        'Tickets',
        'Abiertos',
        'Resueltos',
        'SLA incumplidos',
        'SLA cumplimiento (%)',
        'Tickets con resultado SLA',
        'Respuesta media (h)',
        'Muestra respuesta',
        'Resolución media (h)',
        'Muestra resolución',
      ],
      groups.map((row) => [
        row.name,
        row.total,
        row.open,
        row.closed,
        row.failed,
        row.compliance,
        row.evaluated,
        row.firstResponse.value,
        row.firstResponse.count,
        row.resolution.value,
        row.resolution.count,
      ]),
    );
  }
  sheet(
    'Tiendas técnicas',
    ['Retailer', 'Tienda', 'Incidencias Soporte-Cámaras', 'SLA incumplidos'],
    summary.stores.map((row) => [
      row.retailer,
      row.store,
      row.tickets,
      row.failed,
    ]),
  );
  sheet(
    'Evolución diaria',
    ['Fecha México', 'Tickets creados'],
    analytics.daily.map((row) => [row.date, row.count]),
  );
  sheet(
    'Calidad y antigüedad',
    ['Indicador', 'Tickets'],
    [...analytics.quality, ...analytics.ages].map((row) => [
      row.name,
      row.count,
    ]),
  );
  sheet(
    'Metodología',
    ['Tema', 'Criterio'],
    [
      [
        'Periodo',
        'Fecha de creación en Ciudad de México; no incluye backlog previo. Los cierres son de esa cohorte de tickets.',
      ],
      [
        'SLA',
        'Resultados actuales de Odoo, no una foto al cierre del mes. Incumplido si alguna política falla; cumplido si todas están alcanzadas.',
      ],
      [
        'Porcentaje SLA',
        'Cumplidos / (Cumplidos + Incumplidos), sin cancelados, en curso o sin dato.',
      ],
      [
        'Horas',
        'Campos reportados por Odoo; no se recalculan calendarios, pausas ni metas contractuales. Faltantes se excluyen, nunca son cero.',
      ],
      [
        'Antigüedad',
        'Horas naturales desde creación al consultar; no equivale a SLA y no reinicia al reabrir.',
      ],
      [
        'Responsable',
        'Asignación actual, no tiempo dedicado por cada agente durante el historial.',
      ],
      [
        'Modalidad',
        'Etiquetas aplicadas. Una solicitud de visita en comentarios no acredita atención in situ realizada.',
      ],
      [
        'Tiendas',
        'Solo tienda identificada en campo estructurado o partner con determinante. Ranking técnico: soporte/cámaras, excluye cancelados.',
      ],
      [
        'Solicitante',
        'Solicitante estructurado; fallback nombre cliente Odoo; no se sustituye por responsable.',
      ],
      [
        'P90',
        'Percentil interpolado sobre tiempos disponibles; se informa también el tamaño de muestra.',
      ],
      [
        'Filtros',
        'Todas las hojas usan los mismos tickets seleccionados en la pantalla.',
      ],
    ],
  );
  return workbook;
}
export async function downloadOdooWorkbook(
  tickets: OdooIncident[],
  month: string,
  reference: string,
  filters: Record<string, string>,
) {
  const workbook = await buildOdooWorkbook(tickets, month, reference, filters);
  const bytes = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `Incidencias_Odoo_${month}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
