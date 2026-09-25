import type { Firestore } from 'firebase-admin/firestore';
import type { ScreenDoc } from './effectiveScope';

export const CAMERA_TICKET_STATE_COLLECTION = 'quividiCameraTicketState';

export type TicketOperationalHealth =
  | 'normal'
  | 'no_measurement'
  | 'partial_measurement'
  | 'no_ots';

export interface TicketHealthEvaluation {
  locationId: number;
  currentStatus: TicketOperationalHealth;
  latestDate: string;
  incidentStartDate: string | null;
}

export type CameraTicketStatus =
  | 'creating'
  | 'created'
  | 'recovery_notified'
  | 'error';

export interface CameraPointBinding {
  measurementPointId: string;
  measurementPointCode: string;
  locationId: number;
  storeNumber: string;
  storeName: string;
  support: string;
}

export interface CameraTicketStateDoc {
  schemaVersion: 1;
  measurementPointId: string;
  measurementPointCode: string;
  locationId: number;
  storeNumber: string;
  storeName: string;
  support: string;
  ticketId: number | null;
  ticketStatus: CameraTicketStatus;
  creationMode: 'automatic' | 'manual';
  incidentStartedDate: string;
  ticketSubject: string;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  recoveryNotifiedAt: number | null;
}

const ODOO_BASE = 'https://in-storemedia.odoo.com';
const LIVERPOOL_PARENT_PARTNER_ID = 80;
const HELPDESK_TEAM_ID = 6;
const HELPDESK_USER_ID = 8;
const CAMERA_TAG_NAME = '[camaras]';

function validLocationId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

export function buildCameraPointBindings(
  screens: readonly ScreenDoc[],
): Map<number, CameraPointBinding> {
  const bindings = new Map<number, CameraPointBinding>();
  const duplicates = new Set<number>();

  for (const screen of screens) {
    if (screen.metadata?.active === false) continue;
    const storeNumber = screen.original?.['Numero de Tienda']?.trim() ?? '';
    const storeName = screen.original?.['Nombre de tienda']?.trim() ?? '';
    const support = screen.metadata?.calendarSupport?.trim() ?? '';
    const slots = [
      {
        locationId: validLocationId(screen.metadata?.quividiLocationId),
        measurementPointId: screen.metadata?.measurementPointId?.trim() ?? '',
        measurementPointCode:
          screen.metadata?.measurementPointCode?.trim() ?? '',
      },
      {
        locationId: validLocationId(screen.metadata?.quividiLocationId2),
        measurementPointId: screen.metadata?.measurementPointId2?.trim() ?? '',
        measurementPointCode:
          screen.metadata?.measurementPointCode2?.trim() ?? '',
      },
    ];

    for (const slot of slots) {
      if (!slot.locationId || !slot.measurementPointId) continue;
      if (bindings.has(slot.locationId)) {
        duplicates.add(slot.locationId);
        continue;
      }
      bindings.set(slot.locationId, {
        measurementPointId: slot.measurementPointId,
        measurementPointCode: slot.measurementPointCode,
        locationId: slot.locationId,
        storeNumber,
        storeName,
        support,
      });
    }
  }

  for (const duplicate of duplicates) bindings.delete(duplicate);
  return bindings;
}

async function odooCall<T>(
  key: string,
  model: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    ODOO_BASE + '/json/2/' + model + '/' + method,
    {
      method: 'POST',
      headers: {
        Authorization: 'bearer ' + key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      'Odoo ' + model + '.' + method + ': HTTP ' + response.status,
    );
  }
  return (await response.json()) as T;
}

function determinant(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error('La tienda no tiene un determinante numérico válido.');
  }
  return String(Number.parseInt(trimmed, 10)).padStart(3, '0');
}

async function resolveStorePartnerId(
  key: string,
  storeNumber: string,
): Promise<number> {
  const code = determinant(storeNumber);
  const stores = await odooCall<
    Array<{ id: number; name?: string; parent_id?: [number, string] | false }>
  >(key, 'res.partner', 'search_read', {
    domain: [['parent_id', '=', LIVERPOOL_PARENT_PARTNER_ID]],
    fields: ['id', 'name', 'parent_id'],
    limit: 200,
  });
  const matches = stores.filter((store) =>
    (store.name ?? '').trim().startsWith(code + ' - '),
  );
  if (matches.length !== 1 || !Number.isInteger(matches[0]?.id)) {
    throw new Error(
      'No se pudo resolver de forma única la sucursal Liverpool ' +
        code +
        ' en Odoo.',
    );
  }
  return matches[0]!.id;
}

async function cameraTagId(key: string): Promise<number> {
  const tags = await odooCall<Array<{ id: number; name?: string }>>(
    key,
    'helpdesk.tag',
    'search_read',
    {
      domain: [['name', '=ilike', CAMERA_TAG_NAME]],
      fields: ['id', 'name'],
      limit: 2,
    },
  );
  if (tags.length === 1 && Number.isInteger(tags[0]?.id)) return tags[0]!.id;
  if (tags.length > 1) {
    throw new Error('La etiqueta [camaras] está duplicada en Odoo.');
  }
  const created = await odooCall<number[]>(key, 'helpdesk.tag', 'create', {
    vals_list: [{ name: CAMERA_TAG_NAME }],
  });
  if (
    !Array.isArray(created) ||
    created.length !== 1 ||
    !Number.isInteger(created[0])
  ) {
    throw new Error('No fue posible crear la etiqueta [camaras] en Odoo.');
  }
  return created[0]!;
}

function ticketSubject(
  binding: CameraPointBinding,
  startedDate: string,
): string {
  return (
    '[CAMARAS][' +
    binding.measurementPointId +
    '][' +
    startedDate +
    '] Incidencia Quividi'
  );
}

function statusLabel(status: TicketOperationalHealth): string {
  switch (status) {
    case 'no_measurement':
      return 'Sin medición';
    case 'partial_measurement':
      return 'Medición parcial';
    case 'no_ots':
      return 'Sin OTS';
    default:
      return 'Normal';
  }
}

async function createOdooTicket(
  key: string,
  binding: CameraPointBinding,
  evaluation: TicketHealthEvaluation,
): Promise<{ ticketId: number; subject: string }> {
  const partnerId = await resolveStorePartnerId(key, binding.storeNumber);
  const tagId = await cameraTagId(key);
  const startedDate = evaluation.incidentStartDate ?? evaluation.latestDate;
  const subject = ticketSubject(binding, startedDate);
  const description = [
    'Incidencia detectada por SIGNAM.',
    'Punto SIGNAM: ' + binding.measurementPointId,
    'Tienda: ' + binding.storeNumber + ' - ' + binding.storeName,
    'Soporte: ' + binding.support,
    'Location ID vigente: ' + binding.locationId,
    'Estado: ' + statusLabel(evaluation.currentStatus),
    'Desde: ' + startedDate,
    'Último día evaluado: ' + evaluation.latestDate,
    '',
    'El cierre del ticket debe realizarlo el equipo técnico. SIGNAM solo notificará la recuperación.',
  ].join('\n');
  const escaped = description
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const created = await odooCall<number[]>(key, 'helpdesk.ticket', 'create', {
    vals_list: [
      {
        name: subject,
        description: '<pre>' + escaped + '</pre>',
        team_id: HELPDESK_TEAM_ID,
        user_id: HELPDESK_USER_ID,
        priority: '3',
        partner_id: partnerId,
        tag_ids: [[6, 0, [tagId]]],
      },
    ],
  });
  const ticketId =
    Array.isArray(created) && created.length === 1 ? created[0] : null;
  if (!Number.isInteger(ticketId) || (ticketId ?? 0) <= 0) {
    throw new Error(
      'Odoo no devolvió un folio verificable. Revisa Odoo antes de reintentar.',
    );
  }
  return { ticketId: ticketId!, subject };
}

async function postRecoveryComment(
  key: string,
  ticketId: number,
  binding: CameraPointBinding,
  latestDate: string,
): Promise<void> {
  await odooCall(key, 'helpdesk.ticket', 'message_post', {
    ids: [ticketId],
    body:
      'SIGNAM detectó recuperación del punto ' +
      binding.measurementPointId +
      ' (Location ID vigente ' +
      binding.locationId +
      ') el ' +
      latestDate +
      '. El ticket permanece abierto para validación y cierre del equipo técnico.',
    message_type: 'comment',
    subtype_xmlid: 'mail.mt_note',
  });
}

async function createTicketForEvaluation(
  db: Firestore,
  key: string,
  binding: CameraPointBinding,
  evaluation: TicketHealthEvaluation,
  mode: 'automatic' | 'manual',
  now: number,
): Promise<CameraTicketStateDoc> {
  const ref = db
    .collection(CAMERA_TICKET_STATE_COLLECTION)
    .doc(binding.measurementPointId);
  const existing = await ref.get();
  const previous = existing.data() as Partial<CameraTicketStateDoc> | undefined;

  if (
    previous?.ticketStatus === 'created' &&
    typeof previous.ticketId === 'number'
  ) {
    return previous as CameraTicketStateDoc;
  }

  const startedDate = evaluation.incidentStartDate ?? evaluation.latestDate;
  const subject = ticketSubject(binding, startedDate);
  await ref.set(
    {
      schemaVersion: 1,
      ...binding,
      ticketId: null,
      ticketStatus: 'creating',
      creationMode: mode,
      incidentStartedDate: startedDate,
      ticketSubject: subject,
      lastError: null,
      createdAt:
        typeof previous?.createdAt === 'number' ? previous.createdAt : now,
      updatedAt: now,
      recoveryNotifiedAt: null,
    },
    { merge: true },
  );

  try {
    const created = await createOdooTicket(key, binding, evaluation);
    const state: CameraTicketStateDoc = {
      schemaVersion: 1,
      ...binding,
      ticketId: created.ticketId,
      ticketStatus: 'created',
      creationMode: mode,
      incidentStartedDate: startedDate,
      ticketSubject: created.subject,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      recoveryNotifiedAt: null,
    };
    await ref.set(state, { merge: true });
    return state;
  } catch (reason) {
    const message =
      reason instanceof Error
        ? reason.message
        : 'Error desconocido al crear ticket.';
    await ref.set(
      {
        ticketStatus: 'error',
        lastError: message,
        updatedAt: now,
      },
      { merge: true },
    );
    throw reason;
  }
}

export async function reconcileAutomaticCameraTickets(
  db: Firestore,
  key: string,
  evaluations: readonly TicketHealthEvaluation[],
  screens: readonly ScreenDoc[],
  now: number,
): Promise<{ created: number; recovered: number; errors: number }> {
  const bindings = buildCameraPointBindings(screens);
  let created = 0;
  let recovered = 0;
  let errors = 0;

  for (const evaluation of evaluations) {
    const binding = bindings.get(evaluation.locationId);
    if (!binding) continue;
    const ref = db
      .collection(CAMERA_TICKET_STATE_COLLECTION)
      .doc(binding.measurementPointId);
    const snap = await ref.get();
    const state = snap.data() as Partial<CameraTicketStateDoc> | undefined;

    if (evaluation.currentStatus === 'normal') {
      if (
        state?.ticketStatus === 'created' &&
        typeof state.ticketId === 'number'
      ) {
        try {
          await postRecoveryComment(
            key,
            state.ticketId,
            binding,
            evaluation.latestDate,
          );
          await ref.set(
            {
              ...binding,
              ticketStatus: 'recovery_notified',
              recoveryNotifiedAt: now,
              updatedAt: now,
              lastError: null,
            },
            { merge: true },
          );
          recovered += 1;
        } catch (reason) {
          errors += 1;
          await ref.set(
            {
              lastError:
                reason instanceof Error
                  ? reason.message
                  : 'No fue posible comentar la recuperación.',
              updatedAt: now,
            },
            { merge: true },
          );
        }
      }
      continue;
    }

    if (evaluation.currentStatus !== 'no_ots') continue;
    if (state?.ticketStatus === 'created') continue;

    try {
      await createTicketForEvaluation(
        db,
        key,
        binding,
        evaluation,
        'automatic',
        now,
      );
      created += 1;
    } catch {
      errors += 1;
    }
  }

  return { created, recovered, errors };
}

export async function createManualCameraTicket(
  db: Firestore,
  key: string,
  evaluation: TicketHealthEvaluation,
  screens: readonly ScreenDoc[],
  now: number,
): Promise<CameraTicketStateDoc> {
  if (
    evaluation.currentStatus !== 'no_measurement' &&
    evaluation.currentStatus !== 'partial_measurement'
  ) {
    throw new Error(
      'Este estado no admite creación manual. Sin OTS se envía automáticamente.',
    );
  }
  const binding = buildCameraPointBindings(screens).get(evaluation.locationId);
  if (!binding) {
    throw new Error(
      'La cámara no tiene un Punto SIGNAM válido asociado al Location ID vigente.',
    );
  }
  return createTicketForEvaluation(
    db,
    key,
    binding,
    evaluation,
    'manual',
    now,
  );
}
