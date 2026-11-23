import type { Firestore } from 'firebase-admin/firestore';
import { odooCall } from './odooTickets';

export const CHEDRAUI_CAMERA_TICKET_SUBJECT = '[Camaras] Soporte: Mupi Digital';
const OUTAGE_MS = 4 * 60 * 60 * 1000;
const CLAIM_MS = 10 * 60 * 1000;
export const CHEDRAUI_CAMERA_TICKET_STATE = 'quividiChedrauiCameraTicketState';

export interface ChedrauiCameraObservation {
  boxId: string;
  player: string;
  storeKey?: string | null;
  camera: number;
  locationId: number;
  inNetwork: boolean;
  lastSeen: string | null;
}

export interface ChedrauiCameraTicketState {
  observedAt: number;
  lastSeen: number;
  signalObservedAt: number;
  incidentLastSeen: number | null;
  claimUntil: number;
  ticketId: number | null;
  recoveredTicketId?: number | null;
  manualDate?: string | null;
  lastSeenRaw?: string | null;
  teamId?: number;
}

export function chedrauiLastSeenMs(
  value: string | null,
  observedAt: number,
): number | null {
  const text = value?.trim();
  if (!text || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text)) return null;
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = text.replace(' ', 'T');
  // Quividi can omit the offset. Use the most recent plausible time in UTC or
  // Mexico City so an ambiguous timestamp cannot open a ticket early.
  const earliest = Date.parse(hasOffset ? normalized : normalized + 'Z');
  if (!Number.isFinite(earliest) || earliest > observedAt) return null;
  return hasOffset ? earliest : Date.parse(normalized + '-06:00');
}

export async function resolveChedrauiTeam(key: string): Promise<number> {
  const teams = await odooCall<Array<{ id: number; name: string }>>(
    key,
    'helpdesk.team',
    'search_read',
    {
      domain: [['name', '=', 'Chedraui']],
      fields: ['id', 'name'],
      limit: 2,
    },
  );
  if (
    teams.length !== 1 ||
    teams[0]?.name !== 'Chedraui' ||
    !isPositiveId(teams[0].id)
  ) {
    throw new Error('No se encontró un equipo único Chedraui en Odoo.');
  }
  return teams[0].id;
}

function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export async function findOrCreateChedrauiCameraTicket(
  key: string,
  teamId: number,
  camera: ChedrauiCameraObservation,
  incidentLastSeen: number,
  manualDate?: string,
): Promise<number> {
  const marker = `SIGNAM-CHOUT-3365-${camera.locationId}-${incidentLastSeen}`;
  const existing = await odooCall<Array<{ id: number }>>(
    key,
    'helpdesk.ticket',
    'search_read',
    {
      domain: [
        ['team_id', '=', teamId],
        ['description', 'ilike', marker],
      ],
      fields: ['id'],
      limit: 2,
    },
  );
  if (existing.length) {
    if (existing.length !== 1 || !isPositiveId(existing[0]?.id)) {
      throw new Error(
        'Odoo devolvió más de un folio para la incidencia o un folio inválido.',
      );
    }
    return existing[0].id;
  }

  const description = [
    'Incidencia de SIGNAM · Chedraui OUT',
    `Tienda: ${camera.player}`,
    ...(camera.storeKey ? [`Clave tienda: ${camera.storeKey}`] : []),
    `Box-ID Grassfish: ${camera.boxId}`,
    `Cámara: ${camera.camera}`,
    `Quividi: red 3365 · Location ID ${camera.locationId}`,
    `Última comunicación reportada: ${camera.lastSeen}`,
    manualDate
      ? `Motivo: incidencia de medición Quividi del ${manualDate}, reportada desde Salud de cámaras.`
      : 'Motivo: cuatro horas o más sin comunicación con Quividi.',
    `Referencia de incidencia: ${marker}`,
  ]
    .join('\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const created = await odooCall<number[]>(key, 'helpdesk.ticket', 'create', {
    vals_list: [
      {
        name: CHEDRAUI_CAMERA_TICKET_SUBJECT,
        team_id: teamId,
        description: '<pre>' + description + '</pre>',
      },
    ],
  });
  if (
    !Array.isArray(created) ||
    created.length !== 1 ||
    !isPositiveId(created[0])
  ) {
    throw new Error('Odoo no devolvió un folio válido para la incidencia.');
  }
  return created[0];
}

/** Manual and scheduled requests share the same claim and Odoo reference. */
export async function syncChedrauiCameraTicket(
  db: Firestore,
  key: string,
  camera: ChedrauiCameraObservation,
  observedAt: number,
  getTeam: () => Promise<number>,
  manualDate?: string,
): Promise<number | null> {
  const parsedSeen = chedrauiLastSeenMs(camera.lastSeen, observedAt);
  if (!camera.inNetwork || (parsedSeen === null && !manualDate)) return null;

  const ref = db
    .collection(CHEDRAUI_CAMERA_TICKET_STATE)
    .doc(String(camera.locationId));
  const claimUntil = observedAt + CLAIM_MS;
  const result = await db.runTransaction(async (transaction) => {
    const state = (await transaction.get(ref)).data() as
      ChedrauiCameraTicketState | undefined;
    const seen = parsedSeen ?? state?.lastSeen ?? 0;
    if (
      state &&
      (state.observedAt >= observedAt || state.lastSeen > seen) &&
      !manualDate
    )
      return null;

    const signalObservedAt =
      state?.lastSeen === seen ? state.signalObservedAt : observedAt;
    const signal = {
      observedAt,
      lastSeen: seen,
      signalObservedAt,
      lastSeenRaw: camera.lastSeen,
    };
    const overdue =
      parsedSeen !== null &&
      observedAt - Math.min(seen, signalObservedAt) >= OUTAGE_MS;

    if (state?.ticketId && (manualDate || state.manualDate || overdue)) {
      if (!manualDate) transaction.update(ref, signal);
      return { ticketId: state.ticketId };
    }
    if ((state?.claimUntil ?? 0) > observedAt) return null;

    if (!overdue && !manualDate && !state?.manualDate) {
      transaction.set(ref, {
        ...signal,
        incidentLastSeen: null,
        claimUntil: 0,
        ticketId: null,
        recoveredTicketId: state?.ticketId ?? state?.recoveredTicketId ?? null,
        manualDate: null,
        ...(state?.teamId ? { teamId: state.teamId } : {}),
      } satisfies ChedrauiCameraTicketState);
      return null;
    }

    const incident = state?.incidentLastSeen ?? (overdue ? seen : observedAt);
    const requestedDate = state?.manualDate ?? manualDate;
    transaction.set(ref, {
      ...signal,
      observedAt: Math.max(state?.observedAt ?? 0, observedAt),
      lastSeen: Math.max(state?.lastSeen ?? 0, seen),
      incidentLastSeen: incident,
      claimUntil,
      ticketId: null,
      recoveredTicketId: state?.recoveredTicketId ?? null,
      manualDate: requestedDate ?? null,
      ...(state?.teamId ? { teamId: state.teamId } : {}),
    } satisfies ChedrauiCameraTicketState);
    return { incident, requestedDate };
  });

  if (!result) return null;
  if ('ticketId' in result) return result.ticketId ?? null;
  // Keep the claim for retries after an ambiguous Odoo response.
  const teamId = await getTeam();
  const ticketId = await findOrCreateChedrauiCameraTicket(
    key,
    teamId,
    camera,
    result.incident,
    result.requestedDate,
  );
  await db.runTransaction(async (transaction) => {
    const state = (await transaction.get(ref)).data() as
      ChedrauiCameraTicketState | undefined;
    if (
      state?.incidentLastSeen === result.incident &&
      state?.claimUntil === claimUntil
    ) {
      transaction.update(ref, { ticketId, teamId, claimUntil: 0 });
    }
  });
  return ticketId;
}

/** A manual measurement incident recovers on a later normal day with recent communication. */
export async function recoverChedrauiMeasurementTickets(
  db: Firestore,
  normalLocationIds: number[],
  measurementDate: string,
  observedAt: number,
) {
  await Promise.all(
    normalLocationIds.map(async (id) => {
      const ref = db.collection(CHEDRAUI_CAMERA_TICKET_STATE).doc(String(id));
      await db.runTransaction(async (transaction) => {
        const state = (await transaction.get(ref)).data() as
          ChedrauiCameraTicketState | undefined;
        if (
          state?.manualDate &&
          state.manualDate < measurementDate &&
          state.signalObservedAt > 0 &&
          state.lastSeen > 0 &&
          observedAt - Math.min(state.lastSeen, state.signalObservedAt) <
            OUTAGE_MS &&
          state.ticketId
        ) {
          transaction.update(ref, {
            recoveredTicketId: state.ticketId,
            ticketId: null,
            incidentLastSeen: null,
            manualDate: null,
          });
        }
      });
    }),
  );
}

export async function reconcileChedrauiCameraTickets(
  db: Firestore,
  key: string,
  observations: readonly ChedrauiCameraObservation[],
  observedAt: number,
): Promise<void> {
  const unique = new Map<number, ChedrauiCameraObservation>();
  const duplicates = new Set<number>();
  for (const camera of observations) {
    if (unique.has(camera.locationId)) duplicates.add(camera.locationId);
    unique.set(camera.locationId, camera);
  }
  let teamId: number | undefined;
  const errors: number[] = [];
  for (const camera of unique.values()) {
    if (duplicates.has(camera.locationId)) continue;
    try {
      await syncChedrauiCameraTicket(db, key, camera, observedAt, async () => {
        teamId ??= await resolveChedrauiTeam(key);
        return teamId;
      });
    } catch (error) {
      console.error('Error al sincronizar ticket de cámara Chedraui', {
        locationId: camera.locationId,
        error,
      });
      errors.push(camera.locationId);
    }
  }
  if (errors.length) {
    throw new Error(
      'Falló la sincronización Odoo para Location ID: ' + errors.join(', '),
    );
  }
}
