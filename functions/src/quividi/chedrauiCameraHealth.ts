import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  canRefreshQuividiHealth,
  canUseQuividiOperations,
  roleFromClaims,
} from './access';
import {
  CHEDRAUI_NETWORK_ID,
  fetchQuividiLocations,
  type QuividiLocation,
} from './exportClient';

const secrets = [
  defineSecret('QUIVIDI_API_USERNAME'),
  defineSecret('QUIVIDI_API_TOKEN'),
];
const collectionName = 'quividiChedrauiHealthSnapshots';
const timeZone = 'America/Mexico_City';
const civilDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone,
  dateStyle: 'short',
});

interface CatalogPlayer {
  boxId: string;
  name: string;
  camera1?: { locationId: number } | null;
  camera2?: { locationId: number } | null;
}

export function linkChedrauiCameraObservations(
  players: readonly CatalogPlayer[],
  locations: readonly QuividiLocation[],
) {
  const inventory = new Map(
    locations.map(({ id, last_seen }) => [id, last_seen]),
  );
  return players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es-MX'))
    .flatMap((player) =>
      [player.camera1, player.camera2].flatMap((camera, index) => {
        if (!camera) return [];
        const lastSeen = inventory.get(camera.locationId);
        return [
          {
            boxId: player.boxId,
            player: player.name,
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
}

async function captureChedrauiHealth() {
  const db = getFirestore();
  const players = (await db.collection('grassfishPlayers').get()).docs.map(
    (doc) => doc.data() as CatalogPlayer,
  );
  const observedAt = Date.now();
  const locations = players.some(({ camera1, camera2 }) => camera1 || camera2)
    ? await fetchQuividiLocations(CHEDRAUI_NETWORK_ID)
    : [];
  const date = civilDate.format(observedAt);
  const snapshot: Snapshot = {
    observedAt,
    date,
    cameras: linkChedrauiCameraObservations(players, locations),
  };
  const ref = db.collection(collectionName).doc(date);
  await db.runTransaction(async (transaction) => {
    const previous = await transaction.get(ref);
    if ((previous.get('observedAt') ?? 0) < observedAt) {
      transaction.set(ref, snapshot);
    }
  });
}

export const chedrauiCameraHealthOverview = onCall(
  { secrets },
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
    if (request.data?.refresh === true) {
      if (!canRefresh)
        throw new HttpsError(
          'permission-denied',
          'Tu rol no permite actualizar Quividi.',
        );
      try {
        await captureChedrauiHealth();
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

    const history = await getFirestore()
      .collection(collectionName)
      .orderBy('date', 'desc')
      .limit(30)
      .get();
    return {
      canRefresh,
      history: history.docs.map((doc) => doc.data() as Snapshot),
    };
  },
);

export const chedrauiCameraHealthDaily = onSchedule(
  {
    schedule: '15 8 * * *',
    timeZone,
    secrets,
    retryCount: 3,
    minBackoffSeconds: 300,
  },
  async () => captureChedrauiHealth(),
);
