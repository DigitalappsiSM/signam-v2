import type { Theme } from '@/app/theme';
import type { IncidentKind, Severity } from './mapModel';

/**
 * Colores del Centro de Control para cada tema. ECharts pinta en canvas y no
 * lee variables CSS, así que los literales viven aquí, uno por tema, con el
 * mismo papel que los tokens de `global.css`.
 *
 * Decisión de negocio (Centro de Control): campañas de **marca/proveedor en
 * azul** y **Liverpool institucional en rosa**.
 */
export interface ControlPalette {
  brand: string;
  liverpool: string;
  audience: string;
  ok: string;
  idle: string;
  text: string;
  textMuted: string;
  land: string;
  border: string;
  glow: string;
  tooltipBg: string;
  tooltipBorder: string;
  focus: string;
  incident: Record<IncidentKind, string>;
  severity: Record<Severity, string>;
  /** Rampas del coroplético por estado, de menor a mayor. */
  ramp: { campaigns: string[]; incidents: string[]; audience: string[] };
}

const LIGHT: ControlPalette = {
  brand: '#2563eb',
  liverpool: '#db2777',
  audience: '#0d9488',
  ok: '#16a34a',
  idle: '#94a3b8',
  text: '#10243f',
  textMuted: '#5a6b85',
  land: '#e8eef8',
  border: 'rgba(29, 78, 216, 0.35)',
  glow: 'rgba(37, 99, 235, 0.18)',
  tooltipBg: 'rgba(255, 255, 255, 0.96)',
  tooltipBorder: 'rgba(148, 163, 184, 0.45)',
  focus: '#0f172a',
  incident: {
    support: '#dc2626',
    content: '#d97706',
    camera: '#7c3aed',
    other: '#64748b',
  },
  severity: { critical: '#dc2626', high: '#d97706', medium: '#2563eb' },
  ramp: {
    campaigns: ['#e8eef8', '#bcd0f5', '#7ea6ee', '#3b74e0'],
    incidents: ['#f1eef4', '#f6c7cf', '#ee8b9a', '#d9465f'],
    audience: ['#e9f3f2', '#b7e0da', '#6cc3b6', '#1f9c8c'],
  },
};

const DARK: ControlPalette = {
  brand: '#4b86ff',
  liverpool: '#ff4fa3',
  audience: '#2fd6c8',
  ok: '#35d49a',
  idle: '#5b6b8c',
  text: '#f4f7fc',
  textMuted: '#9fb0c8',
  land: '#0f1c36',
  border: 'rgba(124, 196, 255, 0.35)',
  glow: 'rgba(61, 139, 255, 0.35)',
  tooltipBg: 'rgba(12, 22, 44, 0.94)',
  tooltipBorder: 'rgba(160, 195, 255, 0.25)',
  focus: '#ffffff',
  incident: {
    support: '#ff5d6c',
    content: '#ffb547',
    camera: '#9b8cff',
    other: '#9fb0c8',
  },
  severity: { critical: '#ff5d6c', high: '#ffb547', medium: '#7cc4ff' },
  ramp: {
    campaigns: ['#101d38', '#1a3668', '#264f96', '#3567b8'],
    incidents: ['#1a2340', '#4a2744', '#8f3050', '#c53c58'],
    audience: ['#0f2230', '#12414a', '#18645f', '#1f8a80'],
  },
};

export function controlPalette(theme: Theme): ControlPalette {
  return theme === 'dark' ? DARK : LIGHT;
}
