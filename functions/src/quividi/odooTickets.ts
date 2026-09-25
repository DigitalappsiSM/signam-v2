import type { CameraOperationalHealth } from './cameraAlerts';

const ODOO_BASE_URL = 'https://in-storemedia.odoo.com';
const LIVERPOOL_PARENT_PARTNER_ID = 80;
const HELPDESK_TEAM_ID = 6;
const HELPDESK_USER_ID = 8;

export type CameraTicketDispatchMode = 'automatic' | 'manual';
export type CameraTicketPersistenceState = 'ticket_created' | 'send_error';

export interface CameraTicketStateDoc {
  schemaVersion: 1;
  measurementPointId: string;
  state: CameraTicketPersistenceState;
  odooTicketId: number | null;
  odooTicketName: string;
  dispatchMode: CameraTicketDispatchMode;
  alertId: string;
  locationId: number;
  lastHealthStatus: CameraOperationalHealth;
  latestDate: string;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  lastRecoveryDate: string | null;
  lastRecoveryCommentAt: number | null;
}

export type OdooCall = (
  model: string,
  method: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function odooClient(
  apiKey: string,
  transport: typeof fetch = fetch,
): OdooCall {
  if (!apiKey) throw new Error('ODOO_API_KEY no configurada.');
  return async (model, method, args) => {
    const response = await transport(
      `${ODOO_BASE_URL}/json/2/${model}/${method}`,
      {
        method: 'POST',
        headers: {
          Authorization: `bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      throw new Error(`Odoo ${model}.${method}: HTTP ${response.status}`);
    }
    return response.json() as Promise<unknown>;
  };
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      )
    : [];
}

function positiveId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function relationId(value: unknown): number | null {
  return Array.isArray(value) ? positiveId(value[0]) : positiveId(value);
}

function determinant(storeNumber: string): string {
  const trimmed = storeNumber.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('La tienda no tiene un determinante numérico válido.');
  }
  return String(Number.parseInt(trimmed, 10)).padStart(3, '0');
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      (
        {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        } as Record<string, string>
      )[char] ?? char,
  );
}

export function cameraTicketSubject(measurementPointId: string): string {
  return `[CAMARAS][${measurementPointId}] Incidencia Quividi`;
}

async function resolveLiverpoolPartnerId(
  call: OdooCall,
  storeNumber: string,
): Promise<number> {
  const det = determinant(storeNumber);
  const rows = asRows(
    await call('res.partner', 'search_read', {
      domain: [
        ['parent_id', '=', LIVERPOOL_PARENT_PARTNER_ID],
        ['name', 'ilike', `${det} -`],
      ],
      fields: ['id', 'name', 'parent_id'],
      limit: 10,
    }),
  );
  const matches = rows.filter((row) => {
    const name = typeof row.name === 'string' ? row.name : '';
    return (
      name.startsWith(`${det} -`) &&
      relationId(row.parent_id) === LIVERPOOL_PARENT_PARTNER_ID
    );
  });
  if (matches.length !== 1) {
    throw new Error(
      `No se pudo resolver de forma única la sucursal Liverpool ${det} en Odoo.`,
    );
  }
  const id = positiveId(matches[0]?.id);
  if (!id) throw new Error('La sucursal Odoo no tiene un ID válido.');
  return id;
}

async function resolveCameraTagId(call: OdooCall): Promise<number | null> {
  const rows = asRows(
    await call('helpdesk.tag', 'search_read', {
      domain: [['name', '=ilike', 'camaras']],
      fields: ['id', 'name'],
      limit: 10,
    }),
  );
  const exact = rows.filter(
    (row) =>
      typeof row.name === 'string' &&
      row.name.trim().toLocaleLowerCase('es-MX') === 'camaras',
  );
  return exact.length === 1 ? positiveId(exact[0]?.id) : null;
}

async function openTicketWithSubject(
  call: OdooCall,
  subject: string,
): Promise<number | null> {
  const tickets = asRows(
    await call('helpdesk.ticket', 'search_read', {
      domain: [['name', '=', subject]],
      fields: ['id', 'stage_id'],
      limit: 10,
      order: 'id desc',
    }),
  );
  if (tickets.length === 0) return null;

  const stageIds = Array.from(
    new Set(
      tickets
        .map((ticket) => relationId(ticket.stage_id))
        .filter((id): id is number => id !== null),
    ),
  );
  const stages =
    stageIds.length > 0
      ? asRows(
          await call('helpdesk.stage', 'search_read', {
            domain: [['id', 'in', stageIds]],
            fields: ['id', 'fold'],
            limit: stageIds.length,
          }),
        )
      : [];
  const folded = new Map(
    stages.map((stage) => [positiveId(stage.id), stage.fold === true]),
  );
  for (const ticket of tickets) {
    const ticketId = positiveId(ticket.id);
    if (!ticketId) continue;
    const stageId = relationId(ticket.stage_id);
    if (!stageId || folded.get(stageId) !== true) return ticketId;
  }
  return null;
}

export interface CreateCameraTicketInput {
  measurementPointId: string;
  alertId: string;
  locationId: number;
  locationName: string;
  storeNumber: string;
  storeName: string;
  support: string;
  healthStatus: Exclude<CameraOperationalHealth, 'normal'>;
  latestDate: string;
  coreMeasuredHours: number;
  expectedCoreHours: number;
  coreOts: number;
  dispatchMode: CameraTicketDispatchMode;
}

export async function createOrReuseCameraTicket(
  call: OdooCall,
  input: CreateCameraTicketInput,
): Promise<{ ticketId: number; reused: boolean; subject: string }> {
  const subject = cameraTicketSubject(input.measurementPointId);
  const existing = await openTicketWithSubject(call, subject);
  if (existing) return { ticketId: existing, reused: true, subject };

  const partnerId = await resolveLiverpoolPartnerId(call, input.storeNumber);
  const tagId = await resolveCameraTagId(call);
  const description = [
    'Origen: SIGNAM · Salud de cámaras',
    `Punto SIGNAM: ${input.measurementPointId}`,
    `Tienda: ${determinant(input.storeNumber)} - ${input.storeName}`,
    `Soporte: ${input.support}`,
    `Location ID actual: ${input.locationId}`,
    `Cámara Quividi: ${input.locationName}`,
    `Estado detectado: ${input.healthStatus}`,
    `Último día completo: ${input.latestDate}`,
    `Cobertura núcleo: ${input.coreMeasuredHours}/${input.expectedCoreHours} h`,
    `OTS núcleo: ${input.coreOts}`,
    `Envío: ${input.dispatchMode === 'automatic' ? 'automático' : 'manual'}`,
    '',
    'SIGNAM no cerrará este ticket automáticamente. El cierre corresponde al equipo técnico.',
  ].join('\n');

  const values: Record<string, unknown> = {
    name: subject,
    description: `<pre>${escapeHtml(description)}</pre>`,
    team_id: HELPDESK_TEAM_ID,
    user_id: HELPDESK_USER_ID,
    priority: '3',
    partner_id: partnerId,
  };
  if (tagId) values.tag_ids = [[6, 0, [tagId]]];

  const created = await call('helpdesk.ticket', 'create', {
    vals_list: [values],
  });
  const ticketId =
    Array.isArray(created) && created.length === 1
      ? positiveId(created[0])
      : null;
  if (!ticketId) {
    throw new Error(
      'Odoo no devolvió un folio verificable. Revisa antes de reenviar.',
    );
  }
  return { ticketId, reused: false, subject };
}

export async function postCameraRecoveryComment(
  call: OdooCall,
  ticketId: number,
  input: {
    measurementPointId: string;
    recoveredDate: string;
    locationId: number;
    locationName: string;
  },
): Promise<void> {
  await call('helpdesk.ticket', 'message_post', {
    ids: [ticketId],
    body:
      '<p><strong>SIGNAM:</strong> el punto <code>' +
      escapeHtml(input.measurementPointId) +
      '</code> volvió a estado normal el ' +
      escapeHtml(input.recoveredDate) +
      '. Location ID actual: ' +
      String(input.locationId) +
      ' · ' +
      escapeHtml(input.locationName) +
      '.</p><p>El ticket queda abierto para validación y cierre del equipo técnico.</p>',
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note',
  });
}
