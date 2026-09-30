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
  policies: { name: string; status: string; deadline: string | null }[];
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
