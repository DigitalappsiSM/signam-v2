import { summarizeIncidents, type OdooIncident } from './odooIncidents';
export function percentile(
  values: (number | null)[],
  fraction: number,
): number | null {
  const sorted = values
    .filter(
      (value): value is number => value !== null && Number.isFinite(value),
    )
    .sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const left = Math.floor(position);
  const lower = sorted[left] ?? 0;
  return (
    lower + ((sorted[Math.ceil(position)] ?? lower) - lower) * (position - left)
  );
}
export function groupIncidents(
  tickets: OdooIncident[],
  key: (ticket: OdooIncident) => string,
) {
  const groups = new Map<string, OdooIncident[]>();
  for (const ticket of tickets) {
    const label = key(ticket);
    groups.set(label, [...(groups.get(label) ?? []), ticket]);
  }
  return [...groups]
    .map(([name, rows]) => ({ name, ...summarizeIncidents(rows) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
export function incidentAnalytics(
  tickets: OdooIncident[],
  month: string,
  reference: string,
) {
  const eligible = tickets.filter((ticket) => !ticket.cancelled);
  const response = eligible.map((ticket) => ticket.firstResponseHours);
  const closure = eligible
    .filter((ticket) => ticket.closed)
    .map((ticket) => ticket.resolutionHours);
  const daily = new Map<string, number>();
  for (const ticket of tickets) {
    if (!ticket.createdAt) continue;
    const parsed = new Date(ticket.createdAt.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(parsed.getTime())) continue;
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(parsed);
    const part = (type: string) =>
      parts.find((value) => value.type === type)?.value;
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    daily.set(date, (daily.get(date) ?? 0) + 1);
  }
  const now = new Date(reference).getTime();
  const ages = [
    { name: 'Menos de 24 h', count: 0 },
    { name: '24–48 h', count: 0 },
    { name: '48–72 h', count: 0 },
    { name: 'Más de 72 h', count: 0 },
    { name: 'Sin fecha', count: 0 },
  ];
  for (const ticket of eligible.filter((ticket) => !ticket.closed)) {
    const created = ticket.createdAt
      ? new Date(ticket.createdAt.replace(' ', 'T') + 'Z').getTime()
      : NaN;
    const elapsed = (now - created) / 3600000;
    const index =
      !Number.isFinite(elapsed) || elapsed < 0
        ? 4
        : elapsed < 24
          ? 0
          : elapsed < 48
            ? 1
            : elapsed < 72
              ? 2
              : 3;
    const bucket = ages[index];
    if (bucket) bucket.count++;
  }
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5));
  const days = Array.from(
    { length: new Date(Date.UTC(year, m, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
  ).filter((date) => new Date(`${date}T06:00:00Z`).getTime() <= now);
  return {
    responseMedian: percentile(response, 0.5),
    responseP90: percentile(response, 0.9),
    closureMedian: percentile(closure, 0.5),
    closureP90: percentile(closure, 0.9),
    daily: days.map((date) => ({ date, count: daily.get(date) ?? 0 })),
    ages,
    retailers: groupIncidents(tickets, (ticket) => ticket.retailer),
    categories: groupIncidents(tickets, (ticket) => ticket.category),
    modalities: groupIncidents(tickets, (ticket) => ticket.modality),
    assignees: groupIncidents(tickets, (ticket) => ticket.assignee),
    requesters: groupIncidents(tickets, (ticket) => ticket.requester),
    quality: [
      {
        name: 'Sin tienda identificada',
        count: tickets.filter((ticket) => !ticket.store).length,
      },
      {
        name: 'Sin categoría específica',
        count: tickets.filter((ticket) =>
          ['General', 'Sin clasificar'].includes(ticket.category),
        ).length,
      },
      {
        name: 'Sin modalidad',
        count: tickets.filter((ticket) => ticket.modality === 'Sin dato')
          .length,
      },
      {
        name: 'Sin resultado SLA disponible',
        count: eligible.filter((ticket) => ticket.sla === 'Sin dato').length,
      },
    ],
  };
}
