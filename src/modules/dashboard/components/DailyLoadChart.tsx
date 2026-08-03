import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/charts/EChart';
import { chartPalette } from '@/components/charts/chartTheme';
import type { Theme } from '@/app/theme';
import type { DailyLoadPoint } from '../occupancyModel';

function ddmm(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

/**
 * Área apilada de **campañas simultáneas por día** (por clasificación), con el
 * pico del periodo marcado. Es la lectura temporal de la métrica de carga.
 */
export function DailyLoadChart({
  series,
  theme,
}: {
  series: DailyLoadPoint[];
  theme: Theme;
}) {
  const option = useMemo<EChartsOption>(() => {
    const p = chartPalette(theme);
    const dates = series.map((s) => ddmm(s.date));
    const areaGradient = {
      type: 'linear' as const,
      x: 0,
      y: 0,
      x2: 0,
      y2: 1,
      colorStops: [
        { offset: 0, color: p.areaTop },
        { offset: 1, color: p.areaBottom },
      ],
    };
    const peak = series.reduce((m, s) => Math.max(m, s.total), 0);
    return {
      backgroundColor: 'transparent',
      grid: { left: 8, right: 16, top: 30, bottom: 6, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: p.textMuted, fontSize: 11 },
        data: ['Institucional', 'Proveedor', 'Pendiente'],
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLine: { lineStyle: { color: p.axisLine } },
        axisTick: { show: false },
        axisLabel: { color: p.textMuted, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: p.textMuted, fontSize: 11 },
        splitLine: { lineStyle: { color: p.splitLine } },
      },
      series: [
        {
          name: 'Institucional',
          type: 'line',
          stack: 'carga',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: p.institutional },
          areaStyle: { color: areaGradient },
          itemStyle: { color: p.institutional },
          data: series.map((s) => s.institutional),
        },
        {
          name: 'Proveedor',
          type: 'line',
          stack: 'carga',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: p.provider },
          areaStyle: { color: p.providerArea },
          itemStyle: { color: p.provider },
          data: series.map((s) => s.provider),
        },
        {
          name: 'Pendiente',
          type: 'line',
          stack: 'carga',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: p.unknown },
          areaStyle: { color: p.unknownArea },
          itemStyle: { color: p.unknown },
          data: series.map((s) => s.unknown),
        },
        // Serie invisible del total, solo para marcar el pico del periodo.
        {
          name: 'Pico',
          type: 'line',
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 0, opacity: 0 },
          silent: true,
          tooltip: { show: false },
          data: series.map((s) => s.total),
          markPoint:
            peak > 0
              ? {
                  symbolSize: 46,
                  itemStyle: { color: p.magenta },
                  label: { color: '#fff', fontWeight: 700, fontSize: 11 },
                  data: [{ type: 'max', name: 'Pico' }],
                }
              : undefined,
        },
      ],
    };
  }, [series, theme]);

  const peak = series.reduce((m, s) => Math.max(m, s.total), 0);
  return (
    <EChart
      option={option}
      height={280}
      ariaLabel={`Campañas simultáneas por día. Pico del periodo: ${peak}.`}
    />
  );
}
