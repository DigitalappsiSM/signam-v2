import type { Firestore } from 'firebase-admin/firestore';
import { odooCall } from './odooTickets';

export const CHEDRAUI_CAMERA_TICKET_SUBJECT = '[Camaras] Soporte: Mupi Digital';
const OUTAGE_MS = 4 * 60 * 60 * 1000;
const CLAIM_MS = 10 * 60 * 1000;
const STATE_COLLECTION = 'quividiChedrauiCameraTicketState';

interface Observation {
  boxId: string;
  player: string;
  camera: number;
  locationId: number;
  inNetwork: boolean;
  lastSeen: string | null;
}

interface TicketState {
  observedAt: number;
  lastSeen: number;
  signalObservedAt: number;
  incidentLastSeen: number | null;
  claimUntil: number;
  ticketId: number | null;
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
  camera: Observation,
  incidentLastSeen: number,
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
    'Incidencia automática de SIGNAM · Chedraui OUT',
    `Tienda: ${camera.player}`,
    `Box-ID Grassfish: ${camera.boxId}`,
    `Cámara: ${camera.camera}`,
    `Quividi: red 3365 · Location ID ${camera.locationId}`,
    `Última comunicación reportada: ${camera.lastSeen}`,
    'Motivo: cuatro horas o más sin comunicación con Quividi.',
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

export async function reconcileChedrauiCameraTickets(
  db: Firestore,
  key: string,
  observations: readonly Observation[],
  observedAt: number,
): Promise<void> {
  const unique = new Map<number, Observation>();
  const duplicates = new Set<number>();
  for (const camera of observations) {
    if (unique.has(camera.locationId)) duplicates.add(camera.locationId);
    unique.set(camera.locationId, camera);
  }
  const work = [...unique.values()].flatMap((camera) => {
    const seen = chedrauiLastSeenMs(camera.lastSeen, observedAt);
    return camera.inNetwork &&
      !duplicates.has(camera.locationId) &&
      seen !== null
      ? [{ camera, seen }]
      : [];
  });

  let teamId: number | undefined;
  const errors: number[] = [];
  for (const { camera, seen } of work) {
    const ref = db.collection(STATE_COLLECTION).doc(String(camera.locationId));
    const claimUntil = observedAt + CLAIM_MS;
    const incidentLastSeen = await db.runTransaction(async (transaction) => {
      const state = (await transaction.get(ref)).data() as
        TicketState | undefined;
      if (state && (state.observedAt >= observedAt || state.lastSeen > seen))
        return null;
      const signalObservedAt =
        state?.lastSeen === seen ? state.signalObservedAt : observedAt;
      const signal = { observedAt, lastSeen: seen, signalObservedAt };
      const overdue =
        observedAt - Math.min(seen, signalObservedAt) >= OUTAGE_MS;
      if (!overdue) {
        transaction.set(ref, {
          ...signal,
          incidentLastSeen: null,
          claimUntil: 0,
          ticketId: null,
        } satisfies TicketState);
        return null;
      }
      if (state?.ticketId || (state?.claimUntil ?? 0) > observedAt) {
        transaction.update(ref, signal);
        return null;
      }
      const incident = state?.incidentLastSeen ?? seen;
      transaction.set(ref, {
        ...signal,
        incidentLastSeen: incident,
        claimUntil,
        ticketId: null,
      } satisfies TicketState);
      return incident;
    });
    if (incidentLastSeen === null) continue;
    try {
      teamId ??= await resolveChedrauiTeam(key);
      const ticketId = await findOrCreateChedrauiCameraTicket(
        key,
        teamId,
        camera,
        incidentLastSeen,
      );
      await db.runTransaction(async (transaction) => {
        const state = (await transaction.get(ref)).data() as
          TicketState | undefined;
        if (
          state?.incidentLastSeen === incidentLastSeen &&
          state.claimUntil === claimUntil
        ) {
          transaction.update(ref, { ticketId, claimUntil: 0 });
        }
      });
    } catch (error) {
      // Keep the claim for retries after an ambiguous response, then look for
      // the same reference in Odoo before trying to create another ticket.
      console.error('Error al sincronizar ticket de cámara Chedraui', {
        locationId: camera.locationId,
        error,
      });
      errors.push(camera.locationId);
    }
  }
  if (errors.length)
    throw new Error(
      'Falló la sincronización Odoo para Location ID: ' + errors.join(', '),
    );
}
