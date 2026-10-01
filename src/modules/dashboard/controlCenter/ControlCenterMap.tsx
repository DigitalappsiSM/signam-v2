import { useEffect, useRef, useState } from 'react';
import type { ECharts } from 'echarts';
import type { ControlCenterModel } from './mapModel';
import type { ControlPalette } from './palette';
import {
  NATION_VIEW,
  VALLE_VIEW,
  buildMapOption,
  type MapView,
} from './mapOption';

/**
 * Mapa de México del Centro de Control. ECharts y el GeoJSON de estados
 * (Natural Earth, dominio público, simplificado) se cargan bajo demanda en
 * chunks propios. En entornos sin canvas (jsdom) no pinta y no falla: los
 * mismos datos están en las tarjetas y listas del panel.
 */

function canRenderCanvas(): boolean {
  try {
    const c = document.createElement('canvas');
    return typeof c.getContext === 'function' && c.getContext('2d') !== null;
  } catch {
    return false;
  }
}

let mapRegistered: Promise<typeof import('echarts')> | null = null;

function loadMap(): Promise<typeof import('echarts')> {
  mapRegistered ??= Promise.all([
    import('echarts'),
    import('./mexico-states.json'),
  ]).then(([echarts, geo]) => {
    echarts.registerMap(
      'mexico',
      (geo as { default: unknown }).default as Parameters<
        typeof echarts.registerMap
      >[1],
    );
    return echarts;
  });
  return mapRegistered;
}

export function ControlCenterMap({
  model,
  view,
  palette,
  zoomTarget,
  onStoreClick,
  onStateClick,
}: {
  model: ControlCenterModel;
  view: MapView;
  palette: ControlPalette;
  /** Cambia el encuadre cuando cambia el valor (`nation`, `valle` o una tienda). */
  zoomTarget: { key: number; target: 'nation' | 'valle' | [number, number] };
  onStoreClick: (storeNumber: string) => void;
  onStateClick: (state: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onStoreClick, onStateClick });
  handlers.current = { onStoreClick, onStateClick };
  const geoRef = useRef<{ center: number[]; zoom: number }>(NATION_VIEW);

  useEffect(() => {
    if (!ref.current || !canRenderCanvas()) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    void loadMap()
      .then((echarts) => {
        if (disposed || !ref.current) return;
        const chart = echarts.init(ref.current, undefined, {
          renderer: 'canvas',
        });
        chartRef.current = chart;
        chart.on('click', (raw) => {
          const p = raw as {
            componentType?: string;
            seriesType?: string;
            name?: string;
            data?: { storeNumber?: string };
          };
          if (p.data?.storeNumber)
            handlers.current.onStoreClick(p.data.storeNumber);
          else if (
            (p.componentType === 'geo' || p.seriesType === 'map') &&
            p.name
          )
            handlers.current.onStateClick(p.name);
        });
        // Conserva el encuadre que el usuario deja con zoom/arrastre.
        chart.on('georoam', () => {
          const g = (
            chart.getOption() as {
              geo?: { center?: number[]; zoom?: number }[];
            }
          ).geo?.[0];
          if (g?.center && g.zoom)
            geoRef.current = { center: g.center, zoom: g.zoom };
        });
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => chart.resize());
          observer.observe(ref.current);
        }
        setReady(true);
      })
      .catch(() => {
        /* Sin mapa: el resto del panel sigue disponible. */
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !chartRef.current) return;
    chartRef.current.setOption(
      buildMapOption(model, view, palette, geoRef.current),
      { replaceMerge: ['series'] },
    );
  }, [ready, model, view, palette]);

  useEffect(() => {
    if (!ready || !chartRef.current) return;
    const t = zoomTarget.target;
    const next =
      t === 'nation'
        ? NATION_VIEW
        : t === 'valle'
          ? VALLE_VIEW
          : { center: t, zoom: Math.max(geoRef.current.zoom, 5) };
    geoRef.current = next;
    chartRef.current.setOption({ geo: next });
  }, [ready, zoomTarget]);

  return (
    <div
      ref={ref}
      className="cc-map__canvas"
      role="img"
      aria-label="Mapa de México con las tiendas Liverpool: campañas, incidencias y audiencias por estado"
    />
  );
}
