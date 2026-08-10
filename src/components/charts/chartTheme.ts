import type { Theme } from '@/app/theme';

/**
 * Paleta y estilos base para las gráficas ECharts, coherentes con los tokens
 * de `global.css` en cada tema. Identidad in-Store Media: azul dominante, con
 * verde esmeralda como serie secundaria y ámbar para "otros/desconocido".
 * El magenta de Liverpool queda retirado; el antiguo campo `magenta` se
 * reasigna a un azul cielo secundario para no romper los consumidores.
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
  provider: '#0e9f6e',
  unknown: '#f59e0b',
  accent: '#1d4ed8',
  magenta: '#0ea5e9',
  text: '#10243f',
  textMuted: '#5a6b85',
  axisLine: '#c7d3e6',
  splitLine: 'rgba(16, 36, 63, 0.08)',
  tooltipBg: 'rgba(255, 255, 255, 0.96)',
  tooltipBorder: 'rgba(148, 163, 184, 0.4)',
  areaTop: 'rgba(37, 99, 235, 0.32)',
  areaBottom: 'rgba(37, 99, 235, 0.02)',
  providerArea: 'rgba(14, 159, 110, 0.22)',
  unknownArea: 'rgba(245, 158, 11, 0.24)',
};

const DARK: ChartPalette = {
  institutional: '#4b86ff',
  provider: '#2dd4a7',
  unknown: '#fbbf24',
  accent: '#5a90ff',
  magenta: '#38bdf8',
  text: '#f4f7fc',
  textMuted: '#9fb0c8',
  axisLine: '#2c3e5e',
  splitLine: 'rgba(148, 176, 226, 0.1)',
  tooltipBg: 'rgba(16, 31, 53, 0.96)',
  tooltipBorder: 'rgba(120, 145, 190, 0.35)',
  areaTop: 'rgba(47, 117, 255, 0.42)',
  areaBottom: 'rgba(47, 117, 255, 0.02)',
  providerArea: 'rgba(45, 212, 167, 0.26)',
  unknownArea: 'rgba(251, 191, 36, 0.28)',
};

export function chartPalette(theme: Theme): ChartPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
