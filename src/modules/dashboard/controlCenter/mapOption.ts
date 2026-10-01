import type { EChartsOption } from 'echarts';
import type { ControlPalette } from './palette';
import {
  INCIDENT_LABEL,
  worstSeverity,
  type ControlCenterModel,
  type IncidentKind,
  type MapStore,
} from './mapModel';

/** Capas del mapa y su filtro secundario. */
export type MapLayer = 'campaigns' | 'incidents' | 'audience';
export type CampaignFilter = 'all' | 'brand' | 'liverpool';
export type IncidentFilter = 'all' | IncidentKind;

export interface MapView {
  layer: MapLayer;
  campaignFilter: CampaignFilter;
  incidentFilter: IncidentFilter;
  /** Tienda resaltada por el navegador de tickets. */
  focusStore: string | null;
}

export const NATION_VIEW = { center: [-102.3, 23.6], zoom: 1.15 };
export const VALLE_VIEW = { center: [-99.17, 19.45], zoom: 9 };

const fmt = (n: number) => new Intl.NumberFormat('es-MX').format(Math.round(n));

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function storeIncidents(store: MapStore, filter: IncidentFilter) {
  return filter === 'all'
    ? store.incidents
    : store.incidents.filter((i) => i.kind === filter);
}

export function storeCampaigns(store: MapStore, filter: CampaignFilter) {
  return filter === 'brand'
    ? store.campaigns.provider
    : filter === 'liverpool'
      ? store.campaigns.institutional
      : store.totalCampaigns;
}

/** Valor del coroplético por estado según la capa y su filtro. */
export function stateValue(
  model: ControlCenterModel,
  view: MapView,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of model.states) {
    out.set(
      s.state,
      view.layer === 'campaigns'
        ? view.campaignFilter === 'brand'
          ? s.provider
          : view.campaignFilter === 'liverpool'
            ? s.institutional
            : s.campaigns
        : view.layer === 'incidents'
          ? view.incidentFilter === 'all'
            ? s.incidentTotal
            : s.incidents[view.incidentFilter]
          : s.ots,
    );
  }
  return out;
}

const size = (v: number, k: number, max = 22) =>
  Math.max(5, Math.min(max, 4 + Math.sqrt(Math.max(0, v)) * k));

interface Point {
  name: string;
  value: [number, number, number];
  storeNumber: string;
  symbolSize: number;
  symbolOffset?: [number, number];
  symbol?: string;
  itemStyle: Record<string, unknown>;
}

/**
 * Opción ECharts del mapa (pura: misma entrada, misma salida). Solo se
 * dibujan tiendas con coordenadas; el coroplético por estado sí incluye las
 * que no tienen.
 */
export function buildMapOption(
  model: ControlCenterModel,
  view: MapView,
  palette: ControlPalette,
  geo: { center: number[]; zoom: number },
): EChartsOption {
  const located = model.stores.filter(
    (s): s is MapStore & { coord: [number, number] } => s.coord !== null,
  );
  const glow = (color: string) => ({
    color,
    shadowBlur: 10,
    shadowColor: color,
    borderColor: 'rgba(255,255,255,0.45)',
    borderWidth: 0.6,
  });
  const point = (
    s: MapStore & { coord: [number, number] },
    v: number,
    extra: Partial<Point>,
  ): Point => ({
    name: s.name,
    value: [s.coord[0], s.coord[1], v],
    storeNumber: s.storeNumber,
    symbolSize: 6,
    itemStyle: {},
    ...extra,
  });

  const series: Record<string, unknown>[] = [];
  let ripple: Point[] = [];
  let ramp: string[];

  if (view.layer === 'campaigns') {
    ramp = palette.ramp.campaigns;
    const active = located.filter((s) => s.active);
    const both = view.campaignFilter === 'all';
    if (view.campaignFilter !== 'liverpool')
      series.push({
        name: 'Marcas',
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 2,
        data: active
          .filter((s) => s.campaigns.provider > 0)
          .map((s) => {
            const sz = size(s.campaigns.provider, 3);
            return point(s, s.campaigns.provider, {
              symbolSize: sz,
              symbolOffset: both ? [-sz / 2 + 1, 0] : [0, 0],
              itemStyle: glow(palette.brand),
            });
          }),
      });
    if (view.campaignFilter !== 'brand')
      series.push({
        name: 'Liverpool',
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 2,
        data: active
          .filter((s) => s.campaigns.institutional > 0)
          .map((s) => {
            const sz = size(s.campaigns.institutional, 3.6);
            return point(s, s.campaigns.institutional, {
              symbolSize: sz,
              symbolOffset: both ? [sz / 2 - 1, 0] : [0, 0],
              itemStyle: glow(palette.liverpool),
            });
          }),
      });
    series.push({
      name: 'Sin campañas',
      type: 'scatter',
      coordinateSystem: 'geo',
      zlevel: 1,
      data: located
        .filter(
          (s) => !s.active || storeCampaigns(s, view.campaignFilter) === 0,
        )
        .map((s) =>
          point(s, 0, { symbolSize: 5, itemStyle: { color: palette.idle } }),
        ),
    });
    ripple = active
      .filter((s) => storeCampaigns(s, view.campaignFilter) > 0)
      .sort(
        (a, b) =>
          storeCampaigns(b, view.campaignFilter) -
          storeCampaigns(a, view.campaignFilter),
      )
      .slice(0, 8)
      .map((s) =>
        point(s, storeCampaigns(s, view.campaignFilter), {
          symbolSize: 12,
          itemStyle: {
            color:
              view.campaignFilter === 'liverpool'
                ? palette.liverpool
                : palette.brand,
          },
        }),
      );
  } else if (view.layer === 'incidents') {
    ramp = palette.ramp.incidents;
    const pts = located
      .filter((s) => s.active)
      .map((s) => {
        const list = storeIncidents(s, view.incidentFilter);
        if (list.length === 0)
          return point(s, 0, {
            symbolSize: 5,
            itemStyle: { color: palette.ok, opacity: 0.45 },
          });
        const color =
          view.incidentFilter === 'all'
            ? palette.severity[worstSeverity(list) ?? 'medium']
            : palette.incident[view.incidentFilter];
        return point(s, list.length, {
          symbolSize: size(list.length, 6),
          itemStyle: glow(color),
        });
      });
    series.push({
      name: 'Incidencias',
      type: 'scatter',
      coordinateSystem: 'geo',
      zlevel: 2,
      data: pts,
    });
    ripple = located
      .filter((s) =>
        storeIncidents(s, view.incidentFilter).some(
          (i) => i.severity === 'critical',
        ),
      )
      .map((s) =>
        point(s, storeIncidents(s, view.incidentFilter).length, {
          symbolSize: 12,
          itemStyle: { color: palette.severity.critical },
        }),
      );
  } else {
    ramp = palette.ramp.audience;
    series.push({
      name: 'Audiencia',
      type: 'scatter',
      coordinateSystem: 'geo',
      zlevel: 2,
      data: located
        .filter((s) => s.active)
        .map((s) =>
          s.ots === null
            ? point(s, 0, {
                symbolSize: 5,
                symbol: 'emptyCircle',
                itemStyle: { color: palette.idle },
              })
            : point(s, s.ots, {
                symbolSize: Math.max(6, Math.min(26, Math.sqrt(s.ots) / 6)),
                itemStyle: glow(palette.audience),
              }),
        ),
    });
    ripple = located
      .filter((s) => (s.ots ?? 0) > 0)
      .sort((a, b) => (b.ots ?? 0) - (a.ots ?? 0))
      .slice(0, 6)
      .map((s) =>
        point(s, s.ots ?? 0, {
          symbolSize: 12,
          itemStyle: { color: palette.audience },
        }),
      );
  }

  series.push({
    type: 'effectScatter',
    coordinateSystem: 'geo',
    zlevel: 3,
    data: ripple,
    rippleEffect: { brushType: 'stroke', scale: 3, period: 3.4 },
  });
  const focus = view.focusStore
    ? located.find((s) => s.storeNumber === view.focusStore)
    : undefined;
  series.push({
    id: 'focus',
    type: 'effectScatter',
    coordinateSystem: 'geo',
    zlevel: 4,
    data: focus
      ? [
          point(focus, 1, {
            symbolSize: 18,
            itemStyle: { color: palette.focus },
          }),
        ]
      : [],
    rippleEffect: { brushType: 'stroke', scale: 4.5, period: 2 },
  });

  const values = stateValue(model, view);
  const max = Math.max(1, ...values.values());
  series.unshift({
    type: 'map',
    geoIndex: 0,
    data: [...values].map(([name, value]) => ({ name, value })),
  });

  const byNumber = new Map(model.stores.map((s) => [s.storeNumber, s]));
  const stateByName = new Map(model.states.map((s) => [s.state, s]));
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      textStyle: { color: palette.text },
      extraCssText:
        'backdrop-filter:blur(10px);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25)',
      formatter: (raw: unknown) => {
        const p = raw as {
          name: string;
          data?: { storeNumber?: string };
        };
        const s = p.data?.storeNumber ? byNumber.get(p.data.storeNumber) : null;
        if (s) {
          const inc = s.incidents.length;
          return [
            `<b>${escapeHtml(s.name)}</b> · #${escapeHtml(s.storeNumber)}`,
            `<span style="color:${palette.textMuted}">${escapeHtml(
              [s.municipality, s.state].filter(Boolean).join(', '),
            )}</span>`,
            `<span style="color:${palette.brand}">●</span> Marcas <b>${s.campaigns.provider}</b> &nbsp; <span style="color:${palette.liverpool}">●</span> Liverpool <b>${s.campaigns.institutional}</b>`,
            `Incidencias <b>${inc}</b>${
              inc
                ? ` (${Object.entries(INCIDENT_LABEL)
                    .map(([k, l]) => [
                      l,
                      s.incidents.filter((i) => i.kind === k).length,
                    ])
                    .filter(([, n]) => n)
                    .map(([l, n]) => `${l} ${n}`)
                    .join(', ')})`
                : ''
            }`,
            `OTS último día <b>${s.ots === null ? 'sin cámara' : fmt(s.ots)}</b>`,
          ].join('<br>');
        }
        const st = stateByName.get(p.name as never);
        return st
          ? `<b>${escapeHtml(p.name)}</b><br>${st.stores} tiendas · <span style="color:${palette.brand}">${st.provider}</span> / <span style="color:${palette.liverpool}">${st.institutional}</span> campañas<br>${st.incidentTotal} incidencias · ${fmt(st.ots)} OTS`
          : `<b>${escapeHtml(p.name)}</b><br><span style="color:${palette.textMuted}">Sin tiendas Liverpool</span>`;
      },
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      seriesIndex: 0,
      inRange: { color: ramp },
    },
    geo: {
      map: 'mexico',
      roam: true,
      center: geo.center,
      zoom: geo.zoom,
      scaleLimit: { min: 1, max: 24 },
      label: { show: false },
      itemStyle: {
        areaColor: palette.land,
        borderColor: palette.border,
        borderWidth: 0.8,
        shadowColor: palette.glow,
        shadowBlur: 18,
      },
      emphasis: {
        label: { show: false },
        itemStyle: { areaColor: ramp[2] },
      },
      select: { disabled: true },
    },
    series: series as EChartsOption['series'],
  };
}
