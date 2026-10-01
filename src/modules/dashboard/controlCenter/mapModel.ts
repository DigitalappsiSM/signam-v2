import {
  compareStoreNumbers,
  normalizeStoreNumber,
  type MexicanState,
  type StoreDirectoryEntry,
  type StoreZone,
} from '@/domain/stores';
import type {
  CameraStatus,
  ControlCenterCamera,
  ControlCenterTicket,
} from '@/services/controlCenter';
import type { StoreOccupancy } from '../occupancyModel';

/**
 * Modelo puro del mapa del Centro de Control. Cruza, por número de tienda:
 * - el directorio de tiendas (nombre, estado, zona, coordenadas);
 * - la ocupación del periodo (campañas institucionales y de proveedor);
 * - los tickets abiertos de Odoo (Soporte, Contenido, Cámaras);
 * - la salud vigente de las cámaras Quividi (alertas y OTS del último día).
 *
 * Una tienda sin coordenadas cuenta en su estado y en los listados, pero no se
 * dibuja como punto (nunca se inventa una ubicación). Una tienda con datos que
 * no está en el directorio se reporta en `unlocated`.
 */

export type IncidentKind = 'support' | 'content' | 'camera' | 'other';
export type Severity = 'critical' | 'high' | 'medium';

export const INCIDENT_KINDS: IncidentKind[] = [
  'support',
  'content',
  'camera',
  'other',
];

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  support: 'Soporte',
  content: 'Contenido',
  camera: 'Cámaras',
  other: 'Sin clasificar',
};

export const CAMERA_STATUS_LABEL: Record<CameraStatus, string> = {
  normal: 'Normal',
  no_ots: 'Sin OTS',
  no_measurement: 'Sin medición',
  partial_measurement: 'Medición parcial',
};

/** Incidencia unificada: ticket de Odoo o alerta vigente de cámara Quividi. */
export interface MapIncident {
  id: string;
  kind: IncidentKind;
  source: 'odoo' | 'quividi';
  storeNumber: string;
  title: string;
  detail: string;
  /** Horas desde que se abrió (ticket) o días en alerta × 24 (cámara). */
  ageHours: number;
  severity: Severity;
  url: string | null;
  ticketId: number | null;
  stage: string;
  assignee: string;
}

export interface MapStore {
  storeNumber: string;
  name: string;
  state: MexicanState | null;
  zone: StoreZone | null;
  municipality: string;
  /** `[lng, lat]` o `null` si la tienda no tiene coordenadas. */
  coord: [number, number] | null;
  active: boolean;
  campaigns: { institutional: number; provider: number; unknown: number };
  totalCampaigns: number;
  screens: number;
  incidents: MapIncident[];
  cameras: { total: number; alerting: number };
  /** OTS del último día medido (suma de cámaras con medición). `null` sin cámaras. */
  ots: number | null;
}

export interface StateAggregate {
  state: MexicanState;
  stores: number;
  institutional: number;
  provider: number;
  campaigns: number;
  incidents: Record<IncidentKind, number>;
  incidentTotal: number;
  ots: number;
}

export interface ControlCenterModel {
  stores: MapStore[];
  states: StateAggregate[];
  incidents: MapIncident[];
  /** Números de tienda con datos que no están en el directorio. */
  unlocated: string[];
  /** Tiendas activas del directorio que no tienen coordenadas. */
  withoutCoordinates: number;
}

export interface ControlCenterInput {
  directory: readonly StoreDirectoryEntry[];
  occupancy: readonly StoreOccupancy[];
  tickets: readonly ControlCenterTicket[] | null;
  cameras: readonly ControlCenterCamera[] | null;
  now: Date;
}

function ticketKind(category: string): IncidentKind {
  if (category === 'Soporte') return 'support';
  if (category === 'Contenido') return 'content';
  if (category === 'Cámaras') return 'camera';
  return 'other';
}

/** Horas desde una fecha UTC de Odoo (`AAAA-MM-DD HH:MM:SS`). */
export function hoursSince(odooUtc: string, now: Date): number {
  const t = Date.parse(odooUtc.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((now.getTime() - t) / 3_600_000));
}

/**
 * Severidad del semáforo: un ticket con más de 72 h abierto o una cámara sin
 * OTS es crítica; más de 24 h abierto o una cámara sin medición es alta.
 */
export function ticketSeverity(ageHours: number): Severity {
  return ageHours > 72 ? 'critical' : ageHours > 24 ? 'high' : 'medium';
}

export function cameraSeverity(status: CameraStatus): Severity {
  return status === 'no_ots'
    ? 'critical'
    : status === 'no_measurement'
      ? 'high'
      : 'medium';
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

export function compareIncidents(a: MapIncident, b: MapIncident): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    b.ageHours - a.ageHours ||
    a.id.localeCompare(b.id)
  );
}

export function worstSeverity(list: readonly MapIncident[]): Severity | null {
  let worst: Severity | null = null;
  for (const i of list) {
    if (worst === null || SEVERITY_RANK[i.severity] < SEVERITY_RANK[worst])
      worst = i.severity;
  }
  return worst;
}

function emptyIncidents(): Record<IncidentKind, number> {
  return { support: 0, content: 0, camera: 0, other: 0 };
}

export function buildControlCenterModel(
  input: ControlCenterInput,
): ControlCenterModel {
  const byNumber = new Map<string, MapStore>();
  const unlocated = new Set<string>();

  for (const e of input.directory) {
    byNumber.set(e.storeNumber, {
      storeNumber: e.storeNumber,
      name: e.name,
      state: e.state,
      zone: e.zone,
      municipality: e.municipality,
      coord: e.lat !== null && e.lng !== null ? [e.lng, e.lat] : null,
      active: e.status === 'active',
      campaigns: { institutional: 0, provider: 0, unknown: 0 },
      totalCampaigns: 0,
      screens: 0,
      incidents: [],
      cameras: { total: 0, alerting: 0 },
      ots: null,
    });
  }
  const store = (raw: string | null | undefined): MapStore | null => {
    const n = normalizeStoreNumber(raw ?? '');
    if (n === '') return null;
    const s = byNumber.get(n);
    if (!s) unlocated.add(n);
    return s ?? null;
  };

  for (const o of input.occupancy) {
    const s = store(o.storeNumber);
    if (!s) continue;
    s.campaigns.institutional += o.classification.institutional;
    s.campaigns.provider += o.classification.provider;
    s.campaigns.unknown += o.classification.unknown;
    s.totalCampaigns += o.distinctCampaigns;
    s.screens += o.physicalScreens;
  }

  const incidents: MapIncident[] = [];
  for (const t of input.tickets ?? []) {
    const s = store(t.storeNumber);
    if (!s) continue;
    const age = hoursSince(t.createdAt, input.now);
    const incident: MapIncident = {
      id: `odoo-${t.id}`,
      kind: ticketKind(t.category),
      source: 'odoo',
      storeNumber: s.storeNumber,
      title: t.title,
      detail: t.assignee,
      ageHours: age,
      severity: ticketSeverity(age),
      url: t.url,
      ticketId: t.id,
      stage: t.stage,
      assignee: t.assignee,
    };
    s.incidents.push(incident);
    incidents.push(incident);
  }

  for (const c of input.cameras ?? []) {
    const s = store(c.storeNumber);
    if (!s) continue;
    s.cameras.total += 1;
    if (c.status !== 'no_ots' && c.status !== 'no_measurement')
      s.ots = (s.ots ?? 0) + c.coreOts;
    else s.ots = s.ots ?? 0;
    if (c.status === 'normal') continue;
    s.cameras.alerting += 1;
    const incident: MapIncident = {
      id: `cam-${c.locationId}`,
      kind: 'camera',
      source: 'quividi',
      storeNumber: s.storeNumber,
      title: CAMERA_STATUS_LABEL[c.status],
      detail: c.support,
      ageHours: Math.max(1, c.consecutiveDays) * 24,
      severity: cameraSeverity(c.status),
      url: null,
      ticketId: c.ticketId,
      stage: c.ticketId ? 'Con ticket' : 'Sin ticket',
      assignee: '',
    };
    s.incidents.push(incident);
    incidents.push(incident);
  }

  const stores = [...byNumber.values()].sort((a, b) =>
    compareStoreNumbers(a.storeNumber, b.storeNumber),
  );
  for (const s of stores) s.incidents.sort(compareIncidents);

  const states = new Map<MexicanState, StateAggregate>();
  for (const s of stores) {
    if (!s.state) continue;
    const agg = states.get(s.state) ?? {
      state: s.state,
      stores: 0,
      institutional: 0,
      provider: 0,
      campaigns: 0,
      incidents: emptyIncidents(),
      incidentTotal: 0,
      ots: 0,
    };
    agg.stores += 1;
    agg.institutional += s.campaigns.institutional;
    agg.provider += s.campaigns.provider;
    agg.campaigns += s.totalCampaigns;
    for (const i of s.incidents) {
      agg.incidents[i.kind] += 1;
      agg.incidentTotal += 1;
    }
    agg.ots += s.ots ?? 0;
    states.set(s.state, agg);
  }

  return {
    stores,
    states: [...states.values()],
    incidents: incidents.sort(compareIncidents),
    unlocated: [...unlocated].sort(compareStoreNumbers),
    withoutCoordinates: stores.filter((s) => s.active && s.coord === null)
      .length,
  };
}
