import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  orderBy,
  query,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import {
  ADMIRA_CATALOG_HEADERS,
  buildMeasurementPointId,
  type AdmiraScreen,
  type AdmiraScreenOriginal,
} from '@/domain';
import {
  bumpMetadata,
  newScreenMetadata,
  sanitizeOriginal,
  type Actor,
} from '@/modules/admira-catalog/screenFactory';
import type { MasterRow } from '@/modules/admira-catalog/masterImport';

/**
 * Acceso a la colección `screens` (catálogo Admira) en Cloud Firestore.
 *
 * Los campos originales del maestro se guardan bajo `original` y los metadatos
 * de SIGNAM bajo `metadata`, sin mezclarse (ver dominio `AdmiraScreen`).
 */

const COLLECTION = 'screens';

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee todas las pantallas del catálogo, ordenadas por fecha de creación. */
export async function listScreens(): Promise<AdmiraScreen[]> {
  const q = query(collection(db(), COLLECTION), orderBy('metadata.createdAt'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<AdmiraScreen, 'id'>),
  }));
}

/** Crea una pantalla nueva a partir de campos originales parciales. */
export async function createScreen(
  original: Partial<AdmiraScreenOriginal>,
  actor: Actor,
  calendarSupport = '',
  quividiCameraName = '',
  quividiLocationId: number | null = null,
  quividiCameraName2 = '',
  quividiLocationId2: number | null = null,
  measurementPointCode = '',
  measurementPointCode2 = '',
): Promise<string> {
  const point1 = buildMeasurementPointId({
    storeNumber: original['Numero de Tienda'] ?? '',
    support: calendarSupport,
    pointCode: measurementPointCode,
  });
  const point2 = buildMeasurementPointId({
    storeNumber: original['Numero de Tienda'] ?? '',
    support: calendarSupport,
    pointCode: measurementPointCode2,
  });
  if ((quividiLocationId || quividiCameraName.trim()) && !point1) {
    throw new Error('La cámara 1 necesita un Punto SIGNAM válido.');
  }
  if ((quividiLocationId2 || quividiCameraName2.trim()) && !point2) {
    throw new Error('La cámara 2 necesita un Punto SIGNAM válido.');
  }
  if (point1 && point2 && point1 === point2) {
    throw new Error('Las dos cámaras no pueden compartir el mismo Punto SIGNAM.');
  }
  const existing = await listScreens();
  assertUniqueMeasurementPoints(existing, [point1, point2]);

  const now = Date.now();
  const ref = doc(collection(db(), COLLECTION));
  await setDoc(ref, {
    original: sanitizeOriginal(original),
    metadata: {
      ...newScreenMetadata(actor, now),
      calendarSupport: calendarSupport.trim(),
      quividiLocationId,
      quividiCameraName: quividiCameraName.trim(),
      quividiLocationId2,
      quividiCameraName2: quividiCameraName2.trim(),
      measurementPointCode: measurementPointCode.trim(),
      measurementPointId: point1 ?? '',
      measurementPointCode2: measurementPointCode2.trim(),
      measurementPointId2: point2 ?? '',
    },
  });
  return ref.id;
}

/** Actualiza los campos originales (y el mapeo) de una pantalla existente. */
export async function updateScreen(
  screen: AdmiraScreen,
  original: Partial<AdmiraScreenOriginal>,
  actor: Actor,
  calendarSupport?: string,
  quividiCameraName?: string,
  quividiLocationId?: number | null,
  quividiCameraName2?: string,
  quividiLocationId2?: number | null,
  measurementPointCode?: string,
  measurementPointCode2?: string,
): Promise<void> {
  const nextSupport = calendarSupport ?? screen.metadata.calendarSupport;
  const nextPointCode =
    measurementPointCode ?? screen.metadata.measurementPointCode ?? '';
  const nextPointCode2 =
    measurementPointCode2 ?? screen.metadata.measurementPointCode2 ?? '';
  const point1 = buildMeasurementPointId({
    storeNumber: original['Numero de Tienda'] ?? screen.original['Numero de Tienda'],
    support: nextSupport,
    pointCode: nextPointCode,
  });
  const point2 = buildMeasurementPointId({
    storeNumber: original['Numero de Tienda'] ?? screen.original['Numero de Tienda'],
    support: nextSupport,
    pointCode: nextPointCode2,
  });
  const nextLocation1 = quividiLocationId ?? screen.metadata.quividiLocationId ?? null;
  const nextLocation2 = quividiLocationId2 ?? screen.metadata.quividiLocationId2 ?? null;
  const nextName1 = quividiCameraName ?? screen.metadata.quividiCameraName ?? '';
  const nextName2 = quividiCameraName2 ?? screen.metadata.quividiCameraName2 ?? '';
  if ((nextLocation1 || nextName1.trim()) && !point1) {
    throw new Error('La cámara 1 necesita un Punto SIGNAM válido.');
  }
  if ((nextLocation2 || nextName2.trim()) && !point2) {
    throw new Error('La cámara 2 necesita un Punto SIGNAM válido.');
  }
  if (point1 && point2 && point1 === point2) {
    throw new Error('Las dos cámaras no pueden compartir el mismo Punto SIGNAM.');
  }
  const existing = (await listScreens()).filter((item) => item.id !== screen.id);
  assertUniqueMeasurementPoints(existing, [point1, point2]);

  await updateDoc(doc(db(), COLLECTION, screen.id), {
    original: sanitizeOriginal(original),
    metadata: bumpMetadata(screen.metadata, actor, Date.now(), {
      ...(calendarSupport === undefined
        ? {}
        : { calendarSupport: calendarSupport.trim() }),
      ...(quividiCameraName === undefined
        ? {}
        : { quividiCameraName: quividiCameraName.trim() }),
      ...(quividiLocationId === undefined ? {} : { quividiLocationId }),
      ...(quividiCameraName2 === undefined
        ? {}
        : { quividiCameraName2: quividiCameraName2.trim() }),
      ...(quividiLocationId2 === undefined ? {} : { quividiLocationId2 }),
      measurementPointCode: nextPointCode.trim(),
      measurementPointId: point1 ?? '',
      measurementPointCode2: nextPointCode2.trim(),
      measurementPointId2: point2 ?? '',
    }),
  });
}

/** Inactiva una pantalla registrando el motivo (no la elimina). */
export async function deactivateScreen(
  screen: AdmiraScreen,
  reason: string,
  actor: Actor,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTION, screen.id), {
    metadata: bumpMetadata(screen.metadata, actor, Date.now(), {
      active: false,
      deactivationReason: reason.trim(),
    }),
  });
}

/**
 * Elimina físicamente una pantalla. Es permanente y NO conserva historial: la
 * acción preferida es inactivar. Úsese solo para limpiar registros de prueba o
 * cargados por error, nunca con pantallas ya referenciadas por exportaciones.
 */
export async function deleteScreen(id: string): Promise<void> {
  await deleteDoc(doc(db(), COLLECTION, id));
}

function assertUniqueMeasurementPoints(
  screens: readonly AdmiraScreen[],
  ids: readonly (string | null)[],
): void {
  const requested = ids.filter((id): id is string => Boolean(id));
  if (new Set(requested).size !== requested.length) {
    throw new Error('Los Puntos SIGNAM de una pantalla deben ser distintos.');
  }
  const existing = new Set(
    screens.flatMap((screen) =>
      [screen.metadata.measurementPointId, screen.metadata.measurementPointId2].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  );
  const duplicate = requested.find((id) => existing.has(id));
  if (duplicate) {
    throw new Error(`El Punto SIGNAM ${duplicate} ya existe en el catálogo.`);
  }
}

const BATCH_LIMIT = 400;

/**
 * Importa en lote las pantallas detectadas en un maestro, conservando la
 * procedencia (archivo, hoja y fila de origen). Devuelve cuántas se crearon.
 */
export async function importMasterScreens(
  rows: readonly MasterRow[],
  source: { fileName: string; sheet: string },
  actor: Actor,
): Promise<number> {
  const database = db();
  const now = Date.now();
  let created = 0;

  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const chunk = rows.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(database);
    for (const row of chunk) {
      const ref = doc(collection(database, COLLECTION));
      batch.set(ref, {
        original: sanitizeOriginal(row.original),
        metadata: {
          ...newScreenMetadata(actor, now),
          source: source.fileName,
          sourceSheet: source.sheet,
          sourceRow: row.sourceRow,
          calendarSupport: row.calendarSupport.trim(),
          quividiCameraName: row.quividiCameraName.trim(),
          quividiCameraName2: row.quividiCameraName2.trim(),
          measurementPointCode: row.measurementPointCode.trim(),
          measurementPointId:
            buildMeasurementPointId({
              storeNumber: row.original['Numero de Tienda'],
              support: row.calendarSupport,
              pointCode: row.measurementPointCode,
            }) ?? '',
          measurementPointCode2: row.measurementPointCode2.trim(),
          measurementPointId2:
            buildMeasurementPointId({
              storeNumber: row.original['Numero de Tienda'],
              support: row.calendarSupport,
              pointCode: row.measurementPointCode2,
            }) ?? '',
        },
      });
      created += 1;
    }
    await batch.commit();
  }

  return created;
}

/** Cuenta las pantallas actualmente en el catálogo. */
export async function countScreens(): Promise<number> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.size;
}

/**
 * Elimina TODAS las pantallas del catálogo (borrado permanente). Se usa para la
 * opción "Reemplazar todo" al reimportar el maestro. Devuelve cuántas borró.
 */
export async function deleteAllScreens(): Promise<number> {
  const database = db();
  const snapshot = await getDocs(collection(database, COLLECTION));
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const d of docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
    await batch.commit();
  }
  return docs.length;
}

/** Reactiva una pantalla previamente inactivada. */
export async function reactivateScreen(
  screen: AdmiraScreen,
  actor: Actor,
): Promise<void> {
  await updateDoc(doc(db(), COLLECTION, screen.id), {
    metadata: bumpMetadata(screen.metadata, actor, Date.now(), {
      active: true,
      deactivationReason: null,
    }),
  });
}

function masterRowKey(original: AdmiraScreenOriginal): string {
  return JSON.stringify(
    ADMIRA_CATALOG_HEADERS.map((header) =>
      (original[header] ?? '').trim().toLocaleLowerCase('es-MX'),
    ),
  );
}

export interface MasterMetadataUpdateResult {
  updated: number;
  unmatched: number;
  ambiguous: number;
}

export interface MasterMetadataUpdateFields {
  calendarSupport: boolean;
  quividiCameraName: boolean;
  quividiCameraName2: boolean;
  measurementPointCode: boolean;
  measurementPointCode2: boolean;
}

export function masterMetadataPatch(
  row: MasterRow,
  fields: MasterMetadataUpdateFields,
): {
  calendarSupport?: string;
  quividiCameraName?: string;
  quividiCameraName2?: string;
  measurementPointCode?: string;
  measurementPointCode2?: string;
} {
  return {
    ...(fields.calendarSupport
      ? { calendarSupport: row.calendarSupport.trim() }
      : {}),
    ...(fields.quividiCameraName
      ? { quividiCameraName: row.quividiCameraName.trim() }
      : {}),
    ...(fields.quividiCameraName2
      ? { quividiCameraName2: row.quividiCameraName2.trim() }
      : {}),
    ...(fields.measurementPointCode
      ? { measurementPointCode: row.measurementPointCode.trim() }
      : {}),
    ...(fields.measurementPointCode2
      ? { measurementPointCode2: row.measurementPointCode2.trim() }
      : {}),
  };
}

/**
 * Actualiza únicamente metadatos SIGNAM (normalización Liverpool + cámara
 * Quividi) a partir de un maestro, sin duplicar ni borrar pantallas.
 */
export async function updateScreenMetadataFromMaster(
  rows: readonly MasterRow[],
  actor: Actor,
  fields: MasterMetadataUpdateFields = {
    calendarSupport: true,
    quividiCameraName: true,
    quividiCameraName2: true,
    measurementPointCode: true,
    measurementPointCode2: true,
  },
): Promise<MasterMetadataUpdateResult> {
  const database = db();
  const existing = await listScreens();
  const byKey = new Map<string, AdmiraScreen[]>();
  for (const screen of existing) {
    const key = masterRowKey(screen.original);
    const group = byKey.get(key) ?? [];
    group.push(screen);
    byKey.set(key, group);
  }

  const matches: Array<{ screen: AdmiraScreen; row: MasterRow }> = [];
  let unmatched = 0;
  let ambiguous = 0;
  for (const row of rows) {
    const candidates = byKey.get(masterRowKey(row.original)) ?? [];
    if (candidates.length === 1) {
      matches.push({ screen: candidates[0]!, row });
    } else if (candidates.length === 0) {
      unmatched += 1;
    } else {
      ambiguous += 1;
    }
  }

  const now = Date.now();
  for (let i = 0; i < matches.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const { screen, row } of matches.slice(i, i + BATCH_LIMIT)) {
      const patch = masterMetadataPatch(row, fields);
      if (Object.keys(patch).length === 0) continue;
      const support =
        patch.calendarSupport ?? screen.metadata.calendarSupport ?? '';
      const code1 =
        patch.measurementPointCode ?? screen.metadata.measurementPointCode ?? '';
      const code2 =
        patch.measurementPointCode2 ?? screen.metadata.measurementPointCode2 ?? '';
      const point1 = buildMeasurementPointId({
        storeNumber: row.original['Numero de Tienda'],
        support,
        pointCode: code1,
      });
      const point2 = buildMeasurementPointId({
        storeNumber: row.original['Numero de Tienda'],
        support,
        pointCode: code2,
      });
      batch.update(doc(database, COLLECTION, screen.id), {
        metadata: bumpMetadata(screen.metadata, actor, now, {
          ...patch,
          measurementPointId: point1 ?? '',
          measurementPointId2: point2 ?? '',
        }),
      });
    }
    await batch.commit();
  }

  return { updated: matches.length, unmatched, ambiguous };
}
