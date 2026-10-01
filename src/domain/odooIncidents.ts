export interface OdooIncident {
  id: number;
  title: string;
  retailer: string;
  store: string | null;
  requester: string;
  assignee: string;
  stage: string;
  closed: boolean;
  cancelled: boolean;
  category: string;
  modality: string;
  tags: string[];
  createdAt: string;
  closedAt: string | null;
  firstResponseHours: number | null;
  resolutionHours: number | null;
  sla: string;
  policies: {
    name: string;
    status: string;
    deadline: string | null;
    targetStage?: string;
  }[];
  url: string;
}
export interface OdooOverview {
  month: string;
  fetchedAt: string;
  warnings: string[];
  missingFields: string[];
  tickets: OdooIncident[];
}
export function mexicoMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}
export type SlaKind = 'response' | 'resolution' | 'unknown';
/** Explicit policy names, then an unambiguous target stage; never infer from hours. */
export function policyKind(policy: OdooIncident['policies'][number]): SlaKind {
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const name = normalize(policy.name);
  const response = /\b(primera respuesta|first response|first reply)\b/.test(
    name,
  );
  const resolution =
    /\b(resolucion|resolution|cierre|close|closing|resuelto|solucion)\b/.test(
      name,
    );
  if (response && resolution) return 'unknown';
  if (response) return 'response';
  if (resolution) return 'resolution';
  const stage = normalize(policy.targetStage ?? '');
  if (/^(resuelto|cerrado|solucionado|resolved|closed|solved)$/.test(stage))
    return 'resolution';
  if (/^(en progreso|in progress)$/.test(stage)) return 'response';
  return 'unknown';
}
export function incidentSla(
  ticket: OdooIncident,
  kind: Exclude<SlaKind, 'unknown'>,
): string {
  if (ticket.cancelled) return 'No aplica';
  const policies = ticket.policies.filter(
    (policy) => policyKind(policy) === kind,
  );
  if (!policies.length) return 'Sin dato';
  if (policies.some((policy) => policy.status === 'failed'))
    return 'Incumplido';
  if (policies.every((policy) => policy.status === 'reached'))
    return 'Cumplido';
  if (
    policies.every((policy) => ['reached', 'ongoing'].includes(policy.status))
  )
    return 'En curso';
  return 'Sin dato';
}
export function summarizeSla(
  tickets: OdooIncident[],
  kind: Exclude<SlaKind, 'unknown'>,
) {
  const states = tickets
    .filter((ticket) => !ticket.cancelled)
    .map((ticket) => incidentSla(ticket, kind));
  const passed = states.filter((state) => state === 'Cumplido').length;
  const failed = states.filter((state) => state === 'Incumplido').length;
  const evaluated = passed + failed;
  return {
    passed,
    failed,
    evaluated,
    compliance: evaluated ? (100 * passed) / evaluated : null,
    ongoing: states.filter((state) => state === 'En curso').length,
    missing: states.filter((state) => state === 'Sin dato').length,
  };
}
export function summarizeIncidents(tickets: OdooIncident[]) {
  const eligible = tickets.filter((ticket) => !ticket.cancelled);
  const results = eligible.filter((ticket) =>
    ['Cumplido', 'Incumplido'].includes(ticket.sla),
  );
  const mean = (values: (number | null)[]) => {
    const valid = values.filter((value): value is number => value !== null);
    return {
      value: valid.length
        ? valid.reduce((sum, value) => sum + value, 0) / valid.length
        : null,
      count: valid.length,
    };
  };
  const stores = new Map<
    string,
    { retailer: string; store: string; tickets: number; failed: number }
  >();
  for (const ticket of eligible) {
    if (!ticket.store || !['Soporte', 'Cámaras'].includes(ticket.category))
      continue;
    const key = `${ticket.retailer}::${ticket.store}`;
    const store = stores.get(key) ?? {
      retailer: ticket.retailer,
      store: ticket.store,
      tickets: 0,
      failed: 0,
    };
    store.tickets++;
    if (ticket.sla === 'Incumplido') store.failed++;
    stores.set(key, store);
  }
  return {
    responseSla: summarizeSla(tickets, 'response'),
    resolutionSla: summarizeSla(tickets, 'resolution'),
    total: tickets.length,
    open: eligible.filter((ticket) => !ticket.closed).length,
    closed: eligible.filter((ticket) => ticket.closed).length,
    failed: results.filter((ticket) => ticket.sla === 'Incumplido').length,
    compliance: results.length
      ? (100 * results.filter((ticket) => ticket.sla === 'Cumplido').length) /
        results.length
      : null,
    evaluated: results.length,
    firstResponse: mean(eligible.map((ticket) => ticket.firstResponseHours)),
    resolution: mean(
      eligible
        .filter((ticket) => ticket.closed)
        .map((ticket) => ticket.resolutionHours),
    ),
    stores: [...stores.values()].sort(
      (a, b) => b.tickets - a.tickets || a.store.localeCompare(b.store),
    ),
  };
}
