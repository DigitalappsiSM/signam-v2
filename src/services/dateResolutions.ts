import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { getFirebase } from './firebase';
import { campaignKeyId } from '@/modules/campaigns/ekon';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import type { DateOrder } from '@/modules/liverpool-import/dateAmbiguity';

/**
 * Memoria de **resoluciones de fechas ambiguas** confirmadas por el usuario al
 * importar. Clave = la cadena cruda ambigua (p. ej. `10/05/2026`); valor = el
 * orden elegido y la fecha ISO resultante. Al reimportar, una fecha ya resuelta
 * se aplica automáticamente (no se vuelve a preguntar ni se pierde).
 *
 * Documento id = `campaignKeyId(raw)` (base64url determinístico, sin caracteres
 * inválidos para Firestore).
 */

const COLLECTION = 'dateResolutions';

export interface DateResolution {
  /** Cadena cruda ambigua tal como vino del calendario. */
  raw: string;
  /** Orden confirmado por el usuario. */
  order: DateOrder;
  /** Fecha resuelta en ISO `AAAA-MM-DD`. */
  iso: string;
}

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee todas las resoluciones guardadas como mapa `raw → resolución`. */
export async function listDateResolutions(): Promise<
  Map<string, DateResolution>
> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  const map = new Map<string, DateResolution>();
  for (const d of snapshot.docs) {
    const data = d.data() as DateResolution;
    if (data.raw) map.set(data.raw, data);
  }
  return map;
}

/** Guarda (o actualiza) las resoluciones confirmadas por el usuario. */
export async function saveDateResolutions(
  resolutions: readonly DateResolution[],
  actor: Actor,
): Promise<void> {
  if (resolutions.length === 0) return;
  const database = db();
  const now = Date.now();
  const batch = writeBatch(database);
  for (const r of resolutions) {
    const ref = doc(database, COLLECTION, campaignKeyId(r.raw));
    batch.set(ref, { ...r, updatedAt: now, updatedBy: actor.email });
  }
  await batch.commit();
}
