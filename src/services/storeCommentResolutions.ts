import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { getFirebase } from './firebase';
import { campaignKeyId } from '@/modules/campaigns/ekon';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import type { AmbiguousStoreComment } from '@/modules/liverpool-import/campaignParse';
import {
  isStoreCommentResolutionComplete,
  storeCommentResolutionKey,
  type StoreCommentResolution,
} from '@/modules/liverpool-import/storeCommentResolution';

/**
 * Memoria de alcances confirmados para comentarios sin número de tienda.
 * Clave lógica = soporte + comentario normalizados, para sobrevivir a cambios
 * de fila/celda en futuras versiones del calendario.
 */
const COLLECTION = 'storeCommentResolutions';

interface StoredResolution {
  key: string;
  support: string;
  comment: string;
  resolution: StoreCommentResolution;
  updatedAt: number;
  updatedBy: string;
}

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

export async function listStoreCommentResolutions(): Promise<
  Map<string, StoreCommentResolution>
> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  const resolutions = new Map<string, StoreCommentResolution>();
  for (const item of snapshot.docs) {
    const data = item.data() as Partial<StoredResolution>;
    if (
      typeof data.key === 'string' &&
      isStoreCommentResolutionComplete(data.resolution)
    ) {
      resolutions.set(data.key, data.resolution!);
    }
  }
  return resolutions;
}

export async function saveStoreCommentResolutions(
  entries: readonly {
    issue: AmbiguousStoreComment;
    resolution: StoreCommentResolution;
  }[],
  actor: Actor,
): Promise<void> {
  const complete = entries.filter((entry) =>
    isStoreCommentResolutionComplete(entry.resolution),
  );
  if (complete.length === 0) return;

  const database = db();
  const batch = writeBatch(database);
  const now = Date.now();
  for (const { issue, resolution } of complete) {
    const key = storeCommentResolutionKey(issue);
    batch.set(doc(database, COLLECTION, campaignKeyId(key)), {
      key,
      support: issue.support,
      comment: issue.comment,
      resolution,
      updatedAt: now,
      updatedBy: actor.email,
    } satisfies StoredResolution);
  }
  await batch.commit();
}
