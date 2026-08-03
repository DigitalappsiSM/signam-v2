import { useEffect, useRef } from 'react';
import type { EChartsOption, ECharts } from 'echarts';

/**
 * Envoltura de **Apache ECharts** con carga diferida (import dinámico → chunk
 * aparte). No forma parte del bundle inicial: solo se descarga cuando se monta
 * una gráfica.
 *
 * Accesible: el contenedor expone `role="img"` con `aria-label`; el lienzo es
 * decorativo (los mismos datos se ofrecen en tarjetas y listas navegables).
 * En entornos sin canvas real (p. ej. jsdom en pruebas) se omite el render sin
 * lanzar errores.
 */

/** ¿El entorno puede pintar un canvas 2D real? (falso en jsdom sin canvas). */
function canRenderCanvas(): boolean {
  try {
    const c = document.createElement('canvas');
    return typeof c.getContext === 'function' && c.getContext('2d') !== null;
  } catch {
    return false;
  }
}

export function EChart({
  option,
  height = 300,
  ariaLabel,
  className,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    if (!ref.current || !canRenderCanvas()) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;

    void import('echarts').then((echarts) => {
      if (disposed || !ref.current) return;
      const chart = echarts.init(ref.current, undefined, {
        renderer: 'canvas',
      });
      chartRef.current = chart;
      chart.setOption(optionRef.current);
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => chart.resize());
        observer.observe(ref.current);
      }
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  // Actualiza la opción sin recrear el gráfico.
  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ width: '100%', height }}
    />
  );
}
