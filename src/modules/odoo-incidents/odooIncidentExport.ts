import { incidentAnalytics } from '@/domain/odooAnalytics';
import {
  incidentSla,
  policyKind,
  summarizeIncidents,
  type OdooIncident,
} from '@/domain/odooIncidents';
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
      ...(
        [
          ['resolución', summary.resolutionSla],
          ['primera respuesta', summary.responseSla],
        ] as const
      ).flatMap(([kind, stats]) => [
        [`SLA ${kind} cumplimiento (%)`, stats.compliance],
        [`SLA ${kind} cumplidos`, stats.passed],
        [`SLA ${kind} evaluados`, stats.evaluated],
        [`SLA ${kind} incumplidos`, stats.failed],
        [`SLA ${kind} en curso`, stats.ongoing],
        [`SLA ${kind} sin dato`, stats.missing],
      ]),
      ['SLA global incumplidos', summary.failed],
      ['SLA global cumplimiento (%)', summary.compliance],
      ['Tickets con resultado SLA global', summary.evaluated],
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
      'SLA global',
      'Creación UTC',
      'Cierre UTC',
      'Primera respuesta (h Odoo)',
      'Resolución (h Odoo)',
      'Etiquetas',
      'Enlace Odoo',
      'SLA de resolución',
      'SLA de primera respuesta',
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
      incidentSla(ticket, 'resolution'),
      incidentSla(ticket, 'response'),
    ]),
  );
  detail.getColumn(2).width = 55;
  sheet(
    'Políticas SLA',
    [
      'Ticket',
      'Política',
      'Resultado Odoo',
      'Límite UTC',
      'Tipo de SLA',
      'Etapa objetivo',
    ],
    tickets.flatMap((ticket) =>
      ticket.policies.map((policy) => [
        ticket.id,
        policy.name,
        policy.status,
        policy.deadline,
        policyKind(policy) === 'resolution'
          ? 'Resolución'
          : policyKind(policy) === 'response'
            ? 'Primera respuesta'
            : 'Sin identificar',
        policy.targetStage ?? '',
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
        'SLA global incumplidos',
        'SLA global cumplimiento (%)',
        'Tickets con resultado SLA global',
        'Respuesta media (h)',
        'Muestra respuesta',
        'Resolución media (h)',
        'Muestra resolución',
        'SLA resolución (%)',
        'Resolución evaluados',
        'Resolución incumplidos',
        'SLA primera respuesta (%)',
        'Respuesta evaluados',
        'Respuesta incumplidos',
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
        row.resolutionSla.compliance,
        row.resolutionSla.evaluated,
        row.resolutionSla.failed,
        row.responseSla.compliance,
        row.responseSla.evaluated,
        row.responseSla.failed,
      ]),
    );
  }
  sheet(
    'Tiendas técnicas',
    [
      'Retailer',
      'Tienda',
      'Incidencias Soporte-Cámaras',
      'SLA global incumplidos',
    ],
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
        'SLA global',
        'Resultados actuales de Odoo, no una foto al cierre del mes. Incumplido si alguna política falla; cumplido si todas están alcanzadas.',
      ],
      [
        'Resolución y respuesta',
        'Se calculan por separado con políticas identificadas por nombre explícito o etapa objetivo reconocida. Las ambiguas no se asignan; se conserva Sin dato. Respuesta tardía no penaliza resolución.',
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
