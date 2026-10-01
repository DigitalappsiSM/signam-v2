import {
  classify,
  labeled,
  normalized,
  plainHtml,
  relation,
  text,
  type Row,
} from '../odoo/analysis';

/**
 * Proyección mínima para el Centro de Control del panel. Solo lleva lo que el
 * mapa necesita: sin descripción, solicitante ni datos personales, porque la
 * leen también los roles de consulta (incluido `commercial`).
 */
export interface ControlCenterTicket {
  id: number;
  title: string;
  category: string;
  /** Número de tienda normalizado (sin ceros a la izquierda), si se pudo leer. */
  storeNumber: string | null;
  storeLabel: string | null;
  stage: string;
  assignee: string;
  createdAt: string;
  url: string;
}

export interface ControlCenterCamera {
  /** Location ID de Quividi: distingue dos cámaras de la misma pantalla. */
  locationId: number;
  storeNumber: string;
  storeName: string;
  support: string;
  status: 'normal' | 'no_measurement' | 'partial_measurement' | 'no_ots';
  severity: 'none' | 'medium' | 'high' | 'critical';
  latestDate: string;
  consecutiveDays: number;
  coreOts: number;
  ticketId: number | null;
}

export interface ControlCenterSnapshot {
  generatedAt: string;
  /** `null` cuando Odoo no respondió; el resto del panel sigue funcionando. */
  tickets: ControlCenterTicket[] | null;
  cameras: ControlCenterCamera[] | null;
  camerasLatestDate: string | null;
  warnings: string[];
}

/** Ventana de creación que se consulta para encontrar tickets todavía abiertos. */
export const OPEN_TICKET_LOOKBACK_DAYS = 120;

/** Un ticket resuelto, cerrado o cancelado no es una incidencia abierta. */
export function isOpenStage(stage: string): boolean {
  return !/^(resuelto|cerrado|solucionado)$|cancelad/.test(normalized(stage));
}

/**
 * Lee el número de tienda de la etiqueta «Tienda:» o del contacto Odoo de la
 * sucursal (`078 - Guadalajara`). Una persona o el contacto genérico del
 * retailer nunca se toma como tienda.
 */
export function storeFromTicket(
  description: string,
  partner: string,
): { storeNumber: string | null; storeLabel: string | null } {
  const label =
    labeled(description, 'Tienda') ||
    (/(^|,\s*)\d{2,4}\s*-\s*/.test(partner)
      ? partner.replace(/^.*?,\s*(?=\d{2,4}\s*-)/, '')
      : '');
  const digits = /^\s*(\d{1,4})\b/.exec(label)?.[1];
  return {
    storeNumber: digits ? String(Number.parseInt(digits, 10)) : null,
    storeLabel: label || null,
  };
}

/** Fecha Odoo (UTC, `AAAA-MM-DD HH:MM:SS`) de hace `days` días. */
export function odooDateDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function toTicket(
  row: Row,
  tagNames: string[],
): ControlCenterTicket | null {
  const stage = relation(row.stage_id);
  if (!isOpenStage(stage)) return null;
  const description = plainHtml(row.description);
  const retailer = relation(row.team_id);
  const { storeNumber, storeLabel } = storeFromTicket(
    description,
    relation(row.partner_id),
  );
  const teamId = Array.isArray(row.team_id) ? Number(row.team_id[0]) : 0;
  return {
    id: Number(row.id),
    title: text(row.name),
    category: classify(retailer, tagNames, text(row.name), description),
    storeNumber,
    storeLabel,
    stage,
    assignee: relation(row.user_id) || 'Sin asignar',
    createdAt: text(row.create_date),
    url: `https://in-storemedia.odoo.com/odoo/helpdesk/${teamId}/tickets/${Number(row.id)}`,
  };
}
