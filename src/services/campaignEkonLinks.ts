import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { campaignKeyId } from '@/modules/campaigns/ekon';

/**
 * Persistencia de la asociación entre una campaña Liverpool y su número de
 * campaña Ekon.
 *
 * La asociación vive en una colección SEPARADA de las campañas importadas, para
 * que sobreviva a actualizaciones, borrados temporales y reimportaciones. La
 * importación del calendario nunca la toca y esta nunca modifica la campaña
 * importada.
 *
 * - `campaignEkonLinks/{campaignKeyId}`: la asociación y sus metadatos. El ID se
 *   deriva determinísticamente del `nameKey` normalizado (ver `campaignKeyId`).
 *
 * Relación muchos-a-uno:
 * - una campaña tiene como máximo un número Ekon (documento único por campaña);
 * - un mismo número Ekon PUEDE pertenecer a varias campañas. No se reserva ni se
 *   bloquea la unicidad del número: cuando ya está en otra campaña, la UI avisa
 *   y pide confirmación (ver `otherCampaignsWithEkonNumber`) antes de guardar.
 */

const LINKS = 'campaignEkonLinks';

/** Documento de asociación campaña ↔ Ekon. */
export interface CampaignEkonLink {
  /** ID del documento (`campaignKeyId(nameKey)`). */
  id: string;
  campaignNameKey: string;
  campaignName: string;
  ekonCampaignNumber: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee todas las asociaciones campaña ↔ Ekon guardadas. */
export async function listEkonLinks(): Promise<CampaignEkonLink[]> {
  const snapshot = await getDocs(collection(db(), LINKS));
  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<CampaignEkonLink, 'id'>),
  }));
}

export interface SaveEkonLinkInput {
  campaignNameKey: string;
  campaignName: string;
  ekonCampaignNumber: number;
  actor: Actor;
}

/**
 * Crea o reemplaza la asociación de una campaña con un número Ekon, de forma
 * atómica:
 * - un mismo número puede repetirse en varias campañas: NO se verifica unicidad
 *   ni se bloquea el guardado; la advertencia y la confirmación se resuelven en
 *   la UI antes de llamar aquí (ver `otherCampaignsWithEkonNumber`);
 * - conserva `createdAt`/`createdBy` originales si la asociación ya existía.
 *
 * Se usa una transacción solo para leer el documento previo de ESTA campaña y
 * preservar sus metadatos de creación al reescribirlo.
 */
export async function saveEkonLink(input: SaveEkonLinkInput): Promise<void> {
  const database = db();
  const { campaignNameKey, campaignName, ekonCampaignNumber, actor } = input;
  const linkId = campaignKeyId(campaignNameKey);
  const linkRef = doc(database, LINKS, linkId);

  await runTransaction(database, async (tx) => {
    const linkSnap = await tx.get(linkRef);

    const now = Date.now();
    const existing = linkSnap.exists()
      ? (linkSnap.data() as Omit<CampaignEkonLink, 'id'>)
      : null;

    tx.set(linkRef, {
      campaignNameKey,
      campaignName,
      ekonCampaignNumber,
      createdAt: existing?.createdAt ?? now,
      createdBy: existing?.createdBy ?? actor.email,
      updatedAt: now,
      updatedBy: actor.email,
    });
  });
}

export interface UnlinkEkonInput {
  campaignNameKey: string;
  actor: Actor;
}

/**
 * Elimina la asociación Ekon de una campaña. Si la campaña no tenía asociación,
 * no hace nada. Como el número puede estar en otras campañas, desvincular una NO
 * afecta a las demás. Nunca modifica ni elimina la campaña importada.
 */
export async function unlinkEkon(input: UnlinkEkonInput): Promise<void> {
  const database = db();
  const linkId = campaignKeyId(input.campaignNameKey);
  await deleteDoc(doc(database, LINKS, linkId));
}
