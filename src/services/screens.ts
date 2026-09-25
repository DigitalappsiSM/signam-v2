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

function stablePointChangeError(
  previous: string | null | undefined,
  next: string | null,
  label: string,
): void {
  if (previous && previous !== next) {
    throw new Error(
      `${label} ya tiene identidad ${previous}. No puede cambiarse silenciosamente; requiere una reasignación explícita.`,
    );
  }
}

function pointIds(screen: AdmiraScreen): string[] {
  return [
    screen.metadata.measurementPointId ?? null,
    screen.metadata.measurementPointId2 ?? null,
  ].filter((value): value is string => Boolean(value));
}

async function assertUniquePointIds(
  candidates: readonly string[],
  excludeScreenId?: string,
): Promise<void> {
  if (candidates.length !== new Set(candidates).size) {
    throw new Error(
      'Las dos cámaras de una misma pantalla no pueden compartir el mismo Punto SIGNAM.',
    );
  }
  if (candidates.length === 0) return;
  const existing = await listScreens();
  const owners = new Map<string, string>();
  for (const screen of existing) {
    if (screen.id === excludeScreenId) continue;
    for (const id of pointIds(screen)) owners.set(id, screen.id);
  }
  const duplicate = candidates.find((id) => owners.has(id));
  if (duplicate) {
    throw new Error(
      `El Punto SIGNAM ${duplicate} ya está asignado a otra pantalla.`,
    );
  }
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
  const point1 = buildMeasurementPointId(
    original['Numero de Tienda'] ?? '',
    calendarSupport,
    measurementPointCode,
  );
  const point2 = buildMeasurementPointId(
    original['Numero de Tienda'] ?? '',
    calendarSupport,
    measurementPointCode2,
  );
  await assertUniquePointIds(
    [point1, point2].filter((value): value is string => Boolean(value)),
  );
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
      measurementPointId: point1,
      measurementPointCode2: measurementPointCode2.trim(),
      measurementPointId2: point2,
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
  const nextCalendarSupport =
    calendarSupport === undefined
      ? screen.metadata.calendarSupport
      : calendarSupport.trim();
  const nextOriginal = sanitizeOriginal(original);
  const code1 =
    measurementPointCode === undefined
      ? (screen.metadata.measurementPointCode ?? '')
      : measurementPointCode.trim();
  const code2 =
    measurementPointCode2 === undefined
      ? (screen.metadata.measurementPointCode2 ?? '')
      : measurementPointCode2.trim();
  const point1 = buildMeasurementPointId(
    nextOriginal['Numero de Tienda'],
    nextCalendarSupport,
    code1,
  );
  const point2 = buildMeasurementPointId(
    nextOriginal['Numero de Tienda'],
    nextCalendarSupport,
    code2,
  );
  stablePointChangeError(
    screen.metadata.measurementPointId,
    point1,
    'La cámara 1',
  );
  stablePointChangeError(
    screen.metadata.measurementPointId2,
    point2,
    'La cámara 2',
  );
  await assertUniquePointIds(
    [point1, point2].filter((value): value is string => Boolean(value)),
    screen.id,
  );

  await updateDoc(doc(db(), COLLECTION, screen.id), {
    original: nextOriginal,
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
      measurementPointCode: code1,
      measurementPointId: point1,
      measurementPointCode2: code2,
      measurementPointId2: point2,
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
  const existing = await listScreens();
  const pointOwners = new Set(existing.flatMap((screen) => pointIds(screen)));
  const prepared = rows.map((row) => {
    const point1 = buildMeasurementPointId(
      row.original['Numero de Tienda'],
      row.calendarSupport,
      row.measurementPointCode,
    );
    const point2 = buildMeasurementPointId(
      row.original['Numero de Tienda'],
      row.calendarSupport,
      row.measurementPointCode2,
    );
    const ids = [point1, point2].filter(
      (value): value is string => Boolean(value),
    );
    if (ids.length !== new Set(ids).size) {
      throw new Error(
        `Fila ${row.sourceRow}: Cámara 1 y Cámara 2 comparten el mismo Punto SIGNAM.`,
      );
    }
    for (const id of ids) {
      if (pointOwners.has(id)) {
        throw new Error(
          `Fila ${row.sourceRow}: el Punto SIGNAM ${id} ya existe en el catálogo.`,
        );
      }
      pointOwners.add(id);
    }
    return { row, point1, point2 };
  });

  for (let i = 0; i < prepared.length; i += BATCH_LIMIT) {
    const chunk = prepared.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(database);
    for (const { row, point1, point2 } of chunk) {
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
          measurementPointId: point1,
          measurementPointCode2: row.measurementPointCode2.trim(),
          measurementPointId2: point2,
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

  const pointOwners = new Map<string, string>();
  for (const screen of existing) {
    for (const id of pointIds(screen)) pointOwners.set(id, screen.id);
  }
  const preparedMatches = matches.map(({ screen, row }) => {
    for (const id of pointIds(screen)) pointOwners.delete(id);
    const patch = masterMetadataPatch(row, fields);
    const support = fields.calendarSupport
      ? row.calendarSupport.trim()
      : screen.metadata.calendarSupport;
    const code1 = fields.measurementPointCode
      ? row.measurementPointCode.trim()
      : (screen.metadata.measurementPointCode ?? '');
    const code2 = fields.measurementPointCode2
      ? row.measurementPointCode2.trim()
      : (screen.metadata.measurementPointCode2 ?? '');
    const point1 = buildMeasurementPointId(
      screen.original['Numero de Tienda'],
      support,
      code1,
    );
    const point2 = buildMeasurementPointId(
      screen.original['Numero de Tienda'],
      support,
      code2,
    );
    stablePointChangeError(
      screen.metadata.measurementPointId,
      point1,
      'La cámara 1',
    );
    stablePointChangeError(
      screen.metadata.measurementPointId2,
      point2,
      'La cámara 2',
    );
    const ids = [point1, point2].filter(
      (value): value is string => Boolean(value),
    );
    if (ids.length !== new Set(ids).size) {
      throw new Error(
        `Fila ${row.sourceRow}: ambas cámaras comparten Punto SIGNAM.`,
      );
    }
    for (const id of ids) {
      const owner = pointOwners.get(id);
      if (owner && owner !== screen.id) {
        throw new Error(
          `Fila ${row.sourceRow}: el Punto SIGNAM ${id} ya pertenece a otra pantalla.`,
        );
      }
      pointOwners.set(id, screen.id);
    }
    return {
      screen,
      patch: {
        ...patch,
        measurementPointCode: code1,
        measurementPointId: point1,
        measurementPointCode2: code2,
        measurementPointId2: point2,
      },
    };
  });

  const now = Date.now();
  for (let i = 0; i < preparedMatches.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const { screen, patch } of preparedMatches.slice(i, i + BATCH_LIMIT)) {
      if (Object.keys(patch).length === 0) continue;
      batch.update(doc(database, COLLECTION, screen.id), {
        metadata: bumpMetadata(screen.metadata, actor, now, patch),
      });
    }
    await batch.commit();
  }

  return { updated: matches.length, unmatched, ambiguous };
}
