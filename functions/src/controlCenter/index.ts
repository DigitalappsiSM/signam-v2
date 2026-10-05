import { defineSecret } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { getFirestore } from 'firebase-admin/firestore';
import {
  CAMERA_TICKET_STATE_COLLECTION,
  buildCameraPointBindings,
  odooCall,
  type CameraTicketStateDoc,
} from '../quividi/odooTickets';
import type { ScreenDoc } from '../quividi/effectiveScope';
import { buildCameraHealthOverview } from '../quividi/healthOverview';
import { roleFromClaims } from '../quividi/access';
import {
  CAMERA_HEALTH_ALERT_COLLECTION,
  CAMERA_HEALTH_ALERT_STATE_COLLECTION,
} from '../quividi';
import { text, type Row } from '../odoo/analysis';
import {
  OPEN_TICKET_LOOKBACK_DAYS,
  odooDateDaysAgo,
  toTicket,
  type ControlCenterCamera,
  type ControlCenterSnapshot,
  type ControlCenterTicket,
} from './snapshot';

/**
 * Centro de Control del panel: una sola lectura agregada, de solo consulta,
 * para los cuatro roles (incluido `commercial`, por decisión de negocio).
 *
 * Devuelve los tickets **abiertos** de Liverpool en Odoo Helpdesk y el estado
 * vigente de cada cámara Quividi, en una proyección mínima (sin descripciones
 * ni solicitantes). No crea tickets, no escribe en Firestore y no amplía el
 * acceso de las funciones existentes de Odoo o Quividi, que conservan sus
 * propias reglas. Cada fuente falla por separado: si Odoo no responde, el
 * panel sigue mostrando cámaras, y viceversa.
 */

const ODOO_API_KEY = defineSecret('ODOO_API_KEY');
const LIVERPOOL_TEAM = 'Liverpool';
const MAX_TICKETS = 3000;
/** Caché por instancia: el panel se abre seguido y Odoo limita solicitudes. */
const CACHE_MS = 5 * 60_000;

let cache: { at: number; value: ControlCenterSnapshot } | null = null;

/** Solo para pruebas. */
export function resetControlCenterCache(): void {
  cache = null;
}

async function openLiverpoolTickets(
  key: string,
  now: Date,
): Promise<ControlCenterTicket[]> {
  // El Centro de Control solo representa incidencias vigentes. Mantener
  // active_test=true evita que Odoo reincorpore tickets archivados.
  const read = { context: { active_test: true } };
  const teams = await odooCall<Row[]>(key, 'helpdesk.team', 'search_read', {
    ...read,
    domain: [['name', '=', LIVERPOOL_TEAM]],
    fields: ['id', 'name'],
    limit: 5,
  });
  if (!teams.length) throw new Error('Sin equipo Liverpool en Odoo');
  const rows: Row[] = [];
  for (let offset = 0; offset < MAX_TICKETS; offset += 250) {
    const page = await odooCall<Row[]>(key, 'helpdesk.ticket', 'search_read', {
      ...read,
      domain: [
        ['team_id', 'in', teams.map((t) => t.id)],
        ['active', '=', true],
        ['create_date', '>=', odooDateDaysAgo(now, OPEN_TICKET_LOOKBACK_DAYS)],
      ],
      fields: [
        'id',
        'name',
        'team_id',
        'partner_id',
        'user_id',
        'stage_id',
        'tag_ids',
        'description',
        'create_date',
        'active',
      ],
      offset,
      limit: 250,
      order: 'id desc',
    });
    rows.push(...page);
    if (page.length < 250) break;
  }
  const tagIds = [
    ...new Set(
      rows.flatMap((r) =>
        Array.isArray(r.tag_ids) ? (r.tag_ids as number[]) : [],
      ),
    ),
  ];
  const tags = tagIds.length
    ? await odooCall<Row[]>(key, 'helpdesk.tag', 'search_read', {
        ...read,
        domain: [['id', 'in', tagIds]],
        fields: ['id', 'name'],
      })
    : [];
  const tagMap = new Map(tags.map((t) => [Number(t.id), text(t.name)]));
  return rows
    .map((r) =>
      toTicket(
        r,
        (Array.isArray(r.tag_ids) ? (r.tag_ids as number[]) : [])
          .map((id) => tagMap.get(id) ?? '')
          .filter(Boolean),
      ),
    )
    .filter((t): t is ControlCenterTicket => t !== null);
}

async function cameraStates(): Promise<{
  cameras: ControlCenterCamera[];
  latestDate: string | null;
}> {
  const db = getFirestore();
  // Mismo enriquecimiento que `quividi-cameraHealthOverview`: el ticket de
  // cámara se guarda por punto de medición, que se resuelve desde `screens`.
  const [overview, screensSnap, ticketSnap] = await Promise.all([
    buildCameraHealthOverview(
      db,
      CAMERA_HEALTH_ALERT_STATE_COLLECTION,
      CAMERA_HEALTH_ALERT_COLLECTION,
    ),
    db.collection('screens').get(),
    db.collection(CAMERA_TICKET_STATE_COLLECTION).get(),
  ]);
  const bindings = buildCameraPointBindings(
    screensSnap.docs.map((d) => ({ id: d.id, ...(d.data() as ScreenDoc) })),
  );
  const tickets = new Map(
    ticketSnap.docs.map((d) => [
      d.id,
      d.data() as Partial<CameraTicketStateDoc>,
    ]),
  );
  const ticketFor = (locationId: number): number | null => {
    const binding = bindings.get(locationId);
    const ticket = binding
      ? tickets.get(binding.measurementPointId)
      : undefined;
    return typeof ticket?.ticketId === 'number' &&
      (ticket.ticketStatus === 'created' || ticket.ticketStatus === 'creating')
      ? ticket.ticketId
      : null;
  };
  return {
    latestDate: overview.latestDate,
    cameras: overview.cameras
      .filter((c) => c.monitored)
      .map((c) => ({
        locationId: c.locationId,
        storeNumber: c.storeNumber.trim().replace(/^0+(?=\d)/, ''),
        storeName: c.storeName,
        support: c.support,
        status: c.currentStatus,
        severity: c.severity,
        latestDate: c.latestDate,
        consecutiveDays: c.consecutiveDays,
        coreOts: c.coreOts,
        ticketId: ticketFor(c.locationId),
      })),
  };
}

export const overview = onCall(
  { secrets: [ODOO_API_KEY], timeoutSeconds: 120, memory: '512MiB' },
  async (request): Promise<ControlCenterSnapshot> => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    // Los cuatro roles leen el Centro de Control. Un token sin claim cae en
    // `viewer` (nunca en un rol mayor), igual que el resto de Functions.
    roleFromClaims(request.auth.token);

    const now = new Date();
    if (cache && now.getTime() - cache.at < CACHE_MS) return cache.value;

    const warnings: string[] = [];
    const key = ODOO_API_KEY.value();
    const [tickets, cameras] = await Promise.all([
      key
        ? openLiverpoolTickets(key, now).catch((error: unknown) => {
            logger.warn('Centro de Control: Odoo no respondió', {
              reason:
                error instanceof Error && 'reason' in error
                  ? String((error as { reason: unknown }).reason)
                  : 'odoo-connection',
            });
            warnings.push(
              'No se pudieron leer los tickets de Odoo. Se muestran las demás capas.',
            );
            return null;
          })
        : Promise.resolve(null).then(() => {
            warnings.push('La conexión con Odoo no está configurada.');
            return null;
          }),
      cameraStates().catch(() => {
        logger.warn('Centro de Control: falló la salud de cámaras');
        warnings.push('No se pudo leer la salud de cámaras Quividi.');
        return null;
      }),
    ]);

    const value: ControlCenterSnapshot = {
      generatedAt: now.toISOString(),
      tickets,
      cameras: cameras?.cameras ?? null,
      camerasLatestDate: cameras?.latestDate ?? null,
      warnings,
    };
    // Solo se cachea una lectura completa: un fallo se reintenta en la siguiente.
    if (tickets && cameras) cache = { at: now.getTime(), value };
    return value;
  },
);
