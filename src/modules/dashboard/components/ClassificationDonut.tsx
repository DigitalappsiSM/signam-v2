import { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import { EChart } from '@/components/charts/EChart';
import { chartPalette } from '@/components/charts/chartTheme';
import type { Theme } from '@/app/theme';
import {
  CLASSIFICATION_LABEL,
  type ClassificationBreakdown,
} from '../occupancyModel';

/** Dona de **campañas del periodo por clasificación** (Institucional / Proveedor / Pendiente). */
export function ClassificationDonut({
  breakdown,
  theme,
}: {
  breakdown: ClassificationBreakdown;
  theme: Theme;
}) {
  const total =
    breakdown.institutional + breakdown.provider + breakdown.unknown;

  const option = useMemo<EChartsOption>(() => {
    const p = chartPalette(theme);
    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: p.tooltipBg,
        borderColor: p.tooltipBorder,
        textStyle: { color: p.text, fontSize: 12 },
        formatter: '{b}: {c} ({d}%)',
      },
      legend: {
        bottom: 0,
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { color: p.textMuted, fontSize: 11 },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '82%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: false,
          label: {
            show: true,
            position: 'center',
            formatter: () => `${total}\ncampañas`,
            color: p.text,
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 16,
          },
          labelLine: { show: false },
          itemStyle: {
            borderColor: p.tooltipBg,
            borderWidth: 2,
          },
          data: [
            {
              name: CLASSIFICATION_LABEL.institutional,
              value: breakdown.institutional,
              itemStyle: { color: p.institutional },
            },
            {
              name: CLASSIFICATION_LABEL.provider,
              value: breakdown.provider,
              itemStyle: { color: p.provider },
            },
            {
              name: CLASSIFICATION_LABEL.unknown,
              value: breakdown.unknown,
              itemStyle: { color: p.unknown },
            },
          ],
        },
      ],
    };
  }, [breakdown, theme, total]);

  const label = `Campañas por clasificación. Institucional ${breakdown.institutional}, Proveedor ${breakdown.provider}, Pendiente ${breakdown.unknown}.`;
  return <EChart option={option} height={260} ariaLabel={label} />;
}
