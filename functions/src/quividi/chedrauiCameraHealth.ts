import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  CHEDRAUI_CAMERA_TICKET_STATE,
  reconcileChedrauiCameraTickets,
  recoverChedrauiMeasurementTickets,
  resolveChedrauiTeam,
  syncChedrauiCameraTicket,
  type ChedrauiCameraTicketState,
} from './chedrauiCameraTickets';
import { summarizeChedrauiMeasurement } from './chedrauiCameraMeasurement';
import { lastCompleteMexicoDate } from './measurement';
import {
  canManageQuividiTickets,
  canRefreshQuividiHealth,
  canUseQuividiOperations,
  roleFromClaims,
} from './access';
import {
  CHEDRAUI_NETWORK_ID,
  fetchQuividiExport,
  fetchQuividiLocations,
  type QuividiLocation,
} from './exportClient';

const secrets = [
  defineSecret('QUIVIDI_API_USERNAME'),
  defineSecret('QUIVIDI_API_TOKEN'),
];
const odooApiKey = defineSecret('ODOO_API_KEY');
const collectionName = 'quividiChedrauiHealthSnapshots';
const timeZone = 'America/Mexico_City';
const civilDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone,
  dateStyle: 'short',
});

interface CatalogPlayer {
  boxId: string;
  name: string;
  storeKey?: string | null;
  camera1?: { locationId: number } | null;
  camera2?: { locationId: number } | null;
}

export function linkChedrauiCameraObservations(
  players: readonly CatalogPlayer[],
  locations: readonly QuividiLocation[],
) {
  const inventory = new Map(
    locations.map((location) => [location.id, location]),
  );
  return players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es-MX'))
    .flatMap((player) =>
      [player.camera1, player.camera2].flatMap((camera, index) => {
        if (!camera) return [];
        const location = inventory.get(camera.locationId);
        const lastSeen = location?.last_seen;
        return [
          {
            boxId: player.boxId,
            player: player.name,
            storeKey: player.storeKey ?? null,
            locationName: location?.name || location?.label || null,
            camera: index + 1,
            locationId: camera.locationId,
            inNetwork: inventory.has(camera.locationId),
            lastSeen:
              typeof lastSeen === 'string' && lastSeen.trim() ? lastSeen : null,
          },
        ];
      }),
    );
}

interface Snapshot {
  date: string;
  observedAt: number;
  cameras: ReturnType<typeof linkChedrauiCameraObservations>;
  measurementDate?: string;
  measurement?: ReturnType<typeof summarizeChedrauiMeasurement>;
}

async function readChedrauiCameras(db: ReturnType<typeof getFirestore>) {
  const players = (await db.collection('grassfishPlayers').get()).docs.map(
    (doc) => doc.data() as CatalogPlayer,
  );
  const observedAt = Date.now();
  const locations = players.some(({ camera1, camera2 }) => camera1 || camera2)
    ? await fetchQuividiLocations(CHEDRAUI_NETWORK_ID)
    : [];
  return {
    observedAt,
    cameras: linkChedrauiCameraObservations(players, locations),
  };
}

async function captureChedrauiHealth(
  retryMeasurement: boolean,
): Promise<string | null> {
  const db = getFirestore();
  const { observedAt, cameras } = await readChedrauiCameras(db);
  const date = civilDate.format(observedAt);
  const measurementDate = lastCompleteMexicoDate(observedAt);
  const ref = db.collection(collectionName).doc(date);
  const snapshot: Snapshot = { observedAt, date, cameras };
  const locations = [
    ...new Set(
      cameras
        .filter((camera) => camera.inNetwork)
        .map((camera) => camera.locationId),
    ),
  ].sort((a, b) => a - b);

  // Save communication before requesting the slower hourly audience export.
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(ref);
    if ((previous.get('observedAt') ?? 0) < observedAt)
      transaction.set(ref, snapshot, { merge: true });
  });

  try {
    const previous = (await ref.get()).data() as Snapshot | undefined;
    const cached =
      previous?.measurementDate === measurementDate
        ? previous.measurement
        : undefined;
    const locationsChanged =
      !cached ||
      Object.keys(cached).length !== locations.length ||
      locations.some((id) => !cached[id]);
    if (!locationsChanged && retryMeasurement) {
      await recoverChedrauiMeasurementTickets(
        db,
        locations.filter((id) => cached[id]?.status === 'normal'),
        measurementDate,
        observedAt,
      );
      return null;
    }

    const data = [];
    // Bound the query length even when the Grassfish catalog is fully populated.
    for (let offset = 0; offset < locations.length; offset += 100) {
      const payload = await fetchQuividiExport(
        {
          locations: locations.slice(offset, offset + 100).join(','),
          start: measurementDate + 'T00:00:00',
          end: measurementDate + 'T23:59:59',
          data_type: 'ots',
          time_resolution: '1h',
        },
        'daily',
        undefined,
        undefined,
        true,
        CHEDRAUI_NETWORK_ID,
      );
      if (payload.state !== 'finished' || !payload.data)
        throw new Error('Exportación horaria de Chedraui no disponible.');
      data.push(...payload.data);
    }
    const measurement = summarizeChedrauiMeasurement(
      data,
      locations,
      measurementDate,
    );
    const saved = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.get('observedAt') !== observedAt) return false;
      transaction.update(ref, { measurementDate, measurement });
      return true;
    });
    if (saved) {
      await recoverChedrauiMeasurementTickets(
        db,
        locations.filter((id) => measurement[id]?.status === 'normal'),
        measurementDate,
        observedAt,
      );
    }
  } catch (error) {
    console.warn('Chedraui 3365: exportación horaria no disponible.', error);
    if (retryMeasurement) throw error;
    return 'Quividi actualizó la comunicación. La cobertura y los OTS horarios no se pudieron actualizar.';
  }
  return null;
}

async function readChedrauiHistory(
  db: ReturnType<typeof getFirestore>,
  count: number,
) {
  const history = await db
    .collection(collectionName)
    .orderBy('date', 'desc')
    .limit(count)
    .get();
  return history.docs.map((doc) => doc.data() as Snapshot);
}

export const chedrauiCameraHealthOverview = onCall(
  { secrets, timeoutSeconds: 540 },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    const role = roleFromClaims(request.auth.token);
    if (!canUseQuividiOperations(role)) {
      throw new HttpsError(
        'permission-denied',
        'Tu rol no permite consultar la salud de cámaras.',
      );
    }
    const canRefresh = canRefreshQuividiHealth(role);
    let measurementWarning: string | null = null;
    if (request.data?.refresh === true) {
      if (!canRefresh)
        throw new HttpsError(
          'permission-denied',
          'Tu rol no permite actualizar Quividi.',
        );
      try {
        measurementWarning = await captureChedrauiHealth(false);
      } catch (error) {
        console.warn(
          'Chedraui 3365: no se pudo guardar la lectura de Quividi.',
          error,
        );
        throw new HttpsError(
          'unavailable',
          'No se pudo actualizar la red 3365 de Quividi.',
        );
      }
    }

    const db = getFirestore();
    const history = await readChedrauiHistory(db, 30);
    const ids = [
      ...new Set(history[0]?.cameras.map(({ locationId }) => locationId)),
    ];
    const states = ids.length
      ? await db.getAll(
          ...ids.map((id) =>
            db.collection(CHEDRAUI_CAMERA_TICKET_STATE).doc(String(id)),
          ),
        )
      : [];
    const tickets = Object.fromEntries(
      states.flatMap((doc) => {
        const state = doc.data() as ChedrauiCameraTicketState | undefined;
        if (!state) return [];
        return [
          [
            doc.id,
            {
              ticketId: state.ticketId,
              teamId: state.teamId ?? null,
              lastSeen: state.lastSeenRaw ?? null,
              observedAt: state.observedAt,
              recoveredTicketId: state.recoveredTicketId ?? null,
              creating: state.claimUntil > Date.now(),
            },
          ],
        ];
      }),
    );
    return {
      canRefresh,
      canCreateTicket: canManageQuividiTickets(role),
      currentMeasurementDate: lastCompleteMexicoDate(Date.now()),
      measurementWarning: measurementWarning ?? null,
      history,
      tickets,
    };
  },
);

export const chedrauiCameraHealthCreateTicket = onCall(
  { secrets: [...secrets, odooApiKey] },
  async (request) => {
    if (!request.auth)
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    if (!canManageQuividiTickets(roleFromClaims(request.auth.token)))
      throw new HttpsError(
        'permission-denied',
        'Tu rol no permite crear tickets de cámaras.',
      );
    const id: unknown = request.data?.locationId;
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      throw new HttpsError('invalid-argument', 'Location ID inválido.');

    const db = getFirestore();
    const [snapshot] = await readChedrauiHistory(db, 1);
    const measurementDate = lastCompleteMexicoDate(Date.now());
    const status = snapshot?.measurement?.[id]?.status;
    if (
      snapshot?.measurementDate !== measurementDate ||
      !status ||
      status === 'normal'
    )
      throw new HttpsError(
        'failed-precondition',
        'La cámara requiere una incidencia de medición en el último día completo.',
      );

    const { observedAt, cameras } = await readChedrauiCameras(db);
    const matches = cameras.filter(({ locationId }) => locationId === id);
    const camera = matches[0];
    if (matches.length !== 1 || !camera?.inNetwork)
      throw new HttpsError(
        'failed-precondition',
        'La cámara debe estar vinculada una sola vez a la red Chedraui.',
      );
    try {
      const key = odooApiKey.value();
      const ticketId = await syncChedrauiCameraTicket(
        db,
        key,
        camera,
        observedAt,
        () => resolveChedrauiTeam(key),
        measurementDate,
      );
      if (ticketId === null)
        throw new HttpsError(
          'aborted',
          'El ticket se está sincronizando. Actualiza la vista en unos minutos.',
        );
      return { ticketId };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('No se pudo crear el ticket de cámara Chedraui', {
        locationId: id,
        error,
      });
      throw new HttpsError(
        'unavailable',
        'No se pudo sincronizar el ticket con Odoo. Puedes reintentar.',
      );
    }
  },
);

export const chedrauiCameraHealthDaily = onSchedule(
  {
    schedule: '15 8 * * *',
    timeZone,
    secrets,
    timeoutSeconds: 540,
    retryCount: 3,
    minBackoffSeconds: 300,
  },
  async () => {
    await captureChedrauiHealth(true);
  },
);

export const chedrauiCameraTickets = onSchedule(
  {
    schedule: '*/15 * * * *',
    timeZone,
    secrets: [...secrets, odooApiKey],
    timeoutSeconds: 540,
  },
  async () => {
    const db = getFirestore();
    const { observedAt, cameras } = await readChedrauiCameras(db);
    await reconcileChedrauiCameraTickets(
      db,
      odooApiKey.value(),
      cameras,
      observedAt,
    );
  },
);
