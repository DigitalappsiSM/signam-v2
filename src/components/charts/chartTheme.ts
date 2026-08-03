import type { Theme } from '@/app/theme';

/**
 * Paleta y estilos base para las gráficas ECharts, coherentes con los tokens
 * de `global.css` en cada tema. Base azul + detalle magenta Liverpool.
 */
export interface ChartPalette {
  institutional: string;
  provider: string;
  unknown: string;
  accent: string;
  magenta: string;
  text: string;
  textMuted: string;
  axisLine: string;
  splitLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  areaTop: string;
  areaBottom: string;
  providerArea: string;
  unknownArea: string;
}

const LIGHT: ChartPalette = {
  institutional: '#2563eb',
  provider: '#ec0f8c',
  unknown: '#f59e0b',
  accent: '#2563eb',
  magenta: '#ec0f8c',
  text: '#0f1b2d',
  textMuted: '#5b6577',
  axisLine: '#c7d0e0',
  splitLine: 'rgba(15, 27, 45, 0.08)',
  tooltipBg: 'rgba(255, 255, 255, 0.96)',
  tooltipBorder: 'rgba(148, 163, 184, 0.4)',
  areaTop: 'rgba(37, 99, 235, 0.32)',
  areaBottom: 'rgba(37, 99, 235, 0.02)',
  providerArea: 'rgba(236, 15, 140, 0.24)',
  unknownArea: 'rgba(245, 158, 11, 0.24)',
};

const DARK: ChartPalette = {
  institutional: '#3b82f6',
  provider: '#f45bb0',
  unknown: '#fbbf24',
  accent: '#60a5fa',
  magenta: '#f45bb0',
  text: '#e6edf8',
  textMuted: '#93a1bd',
  axisLine: '#2b3a5a',
  splitLine: 'rgba(148, 176, 226, 0.1)',
  tooltipBg: 'rgba(17, 26, 46, 0.96)',
  tooltipBorder: 'rgba(120, 145, 190, 0.35)',
  areaTop: 'rgba(59, 130, 246, 0.42)',
  areaBottom: 'rgba(59, 130, 246, 0.02)',
  providerArea: 'rgba(244, 91, 176, 0.28)',
  unknownArea: 'rgba(251, 191, 36, 0.28)',
};

export function chartPalette(theme: Theme): ChartPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
