import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/charts/EChart';
import { useTheme } from '@/app/theme';
import { incidentAnalytics } from '@/domain/odooAnalytics';
import {
  incidentSla,
  summarizeIncidents,
  type OdooIncident,
} from '@/domain/odooIncidents';
const COLORS = ['#3b82f6', '#06b6d4', '#ef4444', '#f59e0b', '#8b5cf6'];
const metric = (value: number | null) =>
  value === null ? 'Sin dato' : `${value.toFixed(1)} h`;
export function OdooAnalyticsPanels({
  tickets,
  month,
  reference,
  view = 'overview',
}: {
  tickets: OdooIncident[];
  month: string;
  reference: string;
  view?: 'overview' | 'performance';
}) {
  const { theme } = useTheme();
  const model = incidentAnalytics(tickets, month, reference);
  const summary = summarizeIncidents(tickets);
  const textColor = theme === 'dark' ? '#dbeafe' : '#334155';
  const base: EChartsOption = {
    color: COLORS,
    textStyle: { color: textColor },
    tooltip: { trigger: 'axis', confine: true, renderMode: 'richText' },
    grid: { left: 50, right: 25, top: 40, bottom: 50 },
  };
  const line: EChartsOption = {
    ...base,
    xAxis: {
      type: 'category',
      data: model.daily.map((day) => day.date.slice(8)),
      axisLabel: { color: textColor },
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: textColor } },
    series: [
      {
        name: 'Tickets creados',
        type: 'line',
        smooth: false,
        data: model.daily.map((day) => day.count),
        areaStyle: { opacity: 0.13 },
        symbolSize: 6,
      },
    ],
  };
  const slaChart = (
    kind: 'resolution' | 'response' | 'global',
  ): EChartsOption => ({
    ...base,
    legend: {
      textStyle: { color: textColor },
      data: ['Cumplido', 'Incumplido', 'En curso', 'Sin dato / no aplica'],
    },
    xAxis: {
      type: 'category',
      data: model.categories.map((row) => row.name),
      axisLabel: { color: textColor },
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: textColor } },
    series: ['Cumplido', 'Incumplido', 'En curso', 'Sin dato / no aplica'].map(
      (state, i) => ({
        name: state,
        type: 'bar',
        stack: 'tickets',
        itemStyle: { color: ['#10b981', '#ef4444', '#3b82f6', '#94a3b8'][i] },
        data: model.categories.map(
          (row) =>
            tickets.filter(
              (ticket) =>
                ticket.category === row.name &&
                (state === 'Sin dato / no aplica'
                  ? ['Sin dato', 'No aplica'].includes(
                      kind === 'global'
                        ? ticket.sla
                        : incidentSla(ticket, kind),
                    )
                  : (kind === 'global'
                      ? ticket.sla
                      : incidentSla(ticket, kind)) === state),
            ).length,
        ),
      }),
    ),
  });
  const modalities: EChartsOption = {
    ...base,
    tooltip: { trigger: 'item', confine: true, renderMode: 'richText' },
    legend: { bottom: 0, textStyle: { color: textColor } },
    series: [
      {
        name: 'Modalidad',
        type: 'pie',
        radius: ['45%', '72%'],
        center: ['50%', '45%'],
        label: { show: false },
        data: model.modalities.map((row) => ({
          name: row.name,
          value: row.total,
        })),
      },
    ],
  };
  const times: EChartsOption = {
    ...base,
    legend: {
      data: ['Primera respuesta', 'Resolución'],
      textStyle: { color: textColor },
    },
    xAxis: {
      type: 'category',
      data: model.retailers.map((row) => row.name),
      axisLabel: { color: textColor, interval: 0, rotate: 15 },
    },
    yAxis: {
      type: 'value',
      name: 'Horas de Odoo',
      axisLabel: { color: textColor },
    },
    series: [
      {
        name: 'Primera respuesta',
        type: 'bar',
        data: model.retailers.map((row) => row.firstResponse.value),
      },
      {
        name: 'Resolución',
        type: 'bar',
        data: model.retailers.map((row) => row.resolution.value),
      },
    ],
  };
  const panels = [
    {
      title: 'Evolución diaria de tickets',
      note: 'Por fecha de creación. Cada punto permite consultar el volumen del día.',
      option: line,
      label: 'Tickets creados por día',
      rows: model.daily.map((row) => [row.date, String(row.count)]),
    },
    ...(['resolution', 'response', 'global'] as const).map((kind) => ({
      title:
        kind === 'resolution'
          ? 'SLA de resolución por categoría'
          : kind === 'response'
            ? 'SLA de primera respuesta por categoría'
            : 'SLA global por categoría',
      note:
        kind === 'global'
          ? 'Resultado combinado de todas las políticas del ticket.'
          : 'Políticas de Odoo evaluadas por separado; sin dato cuando no se identifica el tipo.',
      option: slaChart(kind),
      label: `Resultados SLA de ${kind === 'resolution' ? 'resolución' : kind === 'response' ? 'primera respuesta' : 'global'} por categoría`,
      rows: model.categories.map((row) => {
        const stats =
          kind === 'resolution'
            ? row.resolutionSla
            : kind === 'response'
              ? row.responseSla
              : {
                  passed: row.evaluated - row.failed,
                  failed: row.failed,
                  ongoing: tickets.filter(
                    (ticket) =>
                      ticket.category === row.name && ticket.sla === 'En curso',
                  ).length,
                  missing: tickets.filter(
                    (ticket) =>
                      ticket.category === row.name &&
                      ['Sin dato', 'No aplica'].includes(ticket.sla),
                  ).length,
                };
        return [
          row.name,
          `${stats.passed} cumplidos · ${stats.failed} incumplidos · ${stats.ongoing} en curso · ${stats.missing} sin dato`,
        ] as [string, string];
      }),
    })),
    {
      title: 'Modalidad de atención',
      note: 'Se conserva Sin dato cuando no hay etiqueta. Mixta significa ambas etiquetas.',
      option: modalities,
      label: 'Tickets por modalidad de atención',
      rows: model.modalities.map((row) => [row.name, String(row.total)]),
    },
    {
      title: 'Respuesta y resolución por retailer',
      note: 'Promedios con datos disponibles. Las resoluciones incluyen solo tickets resueltos.',
      option: times,
      label: 'Horas promedio de respuesta y resolución por retailer',
      rows: model.retailers.map((row) => [
        row.name,
        `${metric(row.firstResponse.value)} respuesta (${row.firstResponse.count}) · ${metric(row.resolution.value)} resolución (${row.resolution.count})`,
      ]),
    },
  ];
  return (
    <>
      {view === 'overview' && (
        <section className="odoo-executive">
          <span className="odoo-eyebrow">LECTURA EJECUTIVA</span>
          <h2>De la incidencia al resultado</h2>
          <div className="odoo-executive-facts">
            <p>
              <strong>{summary.open}</strong> tickets siguen abiertos dentro de
              la selección.
            </p>
            <p>
              <strong>{summary.resolutionSla.failed}</strong> tienen SLA de
              resolución incumplido. Primera respuesta:{' '}
              {summary.responseSla.failed} incumplidos.
            </p>
            <p>
              <strong>{model.retailers[0]?.name ?? 'Sin datos'}</strong>{' '}
              concentra el mayor volumen de tickets de la selección.
            </p>
          </div>
        </section>
      )}
      {view === 'performance' && (
        <>
          <section
            className="odoo-kpis odoo-secondary-kpis"
            aria-label="Distribución de tiempos"
          >
            {[
              ['Mediana de respuesta', model.responseMedian],
              ['P90 de respuesta', model.responseP90],
              ['Mediana de resolución', model.closureMedian],
              ['P90 de resolución', model.closureP90],
            ].map(([name, value]) => (
              <article key={String(name)}>
                <span>{name}</span>
                <strong>
                  {metric(typeof value === 'number' ? value : null)}
                </strong>
              </article>
            ))}
          </section>
          <p className="text-muted">
            Mediana: tiempo central. P90: el 90% de los tiempos registrados está
            por debajo de ese valor. Los datos faltantes se excluyen.
          </p>
        </>
      )}
      {view === 'overview' && (
        <section className="odoo-chart-grid">
          {panels.map((panel) => (
            <article className="odoo-panel" key={panel.title}>
              <h2>{panel.title}</h2>
              <p className="text-muted">{panel.note}</p>
              {tickets.length ? (
                <EChart
                  option={panel.option}
                  height={300}
                  ariaLabel={panel.label}
                />
              ) : (
                <p>No hay datos para graficar.</p>
              )}
              <details>
                <summary>Ver datos de la gráfica</summary>
                <table>
                  <tbody>
                    {panel.rows.map(([name, value]) => (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td>{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </article>
          ))}
        </section>
      )}
      {view === 'performance' && (
        <>
          <section className="odoo-chart-grid">
            <article className="odoo-panel">
              <h2>Antigüedad de tickets abiertos</h2>
              <p className="text-muted">
                Horas naturales desde su creación, al momento de la consulta. No
                equivale al reloj de SLA ni resta pausas; una reapertura
                conserva la fecha de alta.
              </p>
              {model.ages.map((row) => (
                <div className="odoo-progress-row" key={row.name}>
                  <span>{row.name}</span>
                  <progress
                    max={Math.max(1, summary.open)}
                    value={row.count}
                    aria-label={row.name}
                  />
                  <strong>{row.count}</strong>
                </div>
              ))}
            </article>
            <article className="odoo-panel">
              <h2>Calidad de la información</h2>
              <p className="text-muted">
                Campos que limitan el análisis. Un ticket puede aparecer en
                varios indicadores.
              </p>
              {model.quality.map((row) => (
                <div className="odoo-progress-row" key={row.name}>
                  <span>{row.name}</span>
                  <progress
                    max={Math.max(1, tickets.length)}
                    value={row.count}
                    aria-label={row.name}
                  />
                  <strong>{row.count}</strong>
                </div>
              ))}
            </article>
          </section>
          <section className="odoo-chart-grid">
            {[
              { title: 'Atención por responsable', rows: model.assignees },
              { title: 'Solicitantes con más tickets', rows: model.requesters },
            ].map((group) => (
              <article className="odoo-panel" key={group.title}>
                <h2>{group.title}</h2>
                <div className="odoo-table">
                  <table>
                    <thead>
                      <tr>
                        {[
                          'Nombre',
                          'Tickets',
                          'Abiertos',
                          'SLA resolución',
                          'SLA primera respuesta',
                          'SLA global',
                          'Respuesta media',
                          'Resolución media',
                        ].map((label) => (
                          <th scope="col" key={label}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.slice(0, 10).map((row) => (
                        <tr key={row.name}>
                          <th scope="row">{row.name}</th>
                          <td>{row.total}</td>
                          <td>{row.open}</td>
                          {[row.resolutionSla, row.responseSla].map(
                            (stats, index) => (
                              <td key={index}>
                                {stats.compliance === null
                                  ? 'Sin dato'
                                  : `${stats.compliance.toFixed(1)}%`}
                                <small>{stats.evaluated} con resultado</small>
                              </td>
                            ),
                          )}
                          <td>
                            {row.compliance === null
                              ? 'Sin dato'
                              : `${row.compliance.toFixed(1)}%`}
                            <small>{row.evaluated} con resultado</small>
                          </td>
                          <td>
                            {metric(row.firstResponse.value)}
                            <small>{row.firstResponse.count} con dato</small>
                          </td>
                          <td>
                            {metric(row.resolution.value)}
                            <small>{row.resolution.count} con dato</small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted">
                  Primeros 10 por volumen. El Excel incluye todos. Asignación
                  actual; no atribuye cada intervención histórica.
                </p>
              </article>
            ))}
          </section>
        </>
      )}
    </>
  );
}
