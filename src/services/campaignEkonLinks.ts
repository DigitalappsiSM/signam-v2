import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { campaignKeyId } from '@/modules/campaigns/ekon';

/**
 * Persistencia de la asociación uno-a-uno entre una campaña Liverpool y su
 * número de campaña Ekon.
 *
 * La asociación vive en colecciones SEPARADAS de las campañas importadas, para
 * que sobreviva a actualizaciones, borrados temporales y reimportaciones. La
 * importación del calendario nunca toca estas colecciones y estas nunca
 * modifican la campaña importada.
 *
 * - `campaignEkonLinks/{campaignKeyId}`: la asociación y sus metadatos. El ID se
 *   deriva determinísticamente del `nameKey` normalizado (ver `campaignKeyId`).
 * - `ekonCampaignNumbers/{ekonNumber}`: reserva del número Ekon, que garantiza
 *   que un número pertenezca como máximo a una campaña.
 *
 * Relación estrictamente 1–1:
 * - una campaña tiene como máximo un número Ekon (documento único por campaña);
 * - un número Ekon pertenece como máximo a una campaña (reserva única).
 *
 * Guardar, reemplazar y desvincular se ejecutan dentro de una transacción de
 * Firestore que verifica ambos lados de la relación y evita conflictos
 * concurrentes.
 */

const LINKS = 'campaignEkonLinks';
const NUMBERS = 'ekonCampaignNumbers';

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

/** Error de dominio de la asociación (número ya usado por otra campaña, etc.). */
export class EkonLinkError extends Error {
  constructor(
    message: string,
    readonly code: 'ekon-taken',
  ) {
    super(message);
    this.name = 'EkonLinkError';
  }
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
 * - verifica que el número no esté reservado por OTRA campaña (unicidad
 *   Ekon → campaña); si lo está, lanza `EkonLinkError('ekon-taken')`;
 * - si la campaña ya tenía otro número, libera la reserva anterior y crea la
 *   nueva en la misma transacción (reemplazo sin sobrescritura silenciosa: la
 *   confirmación se solicita en la UI antes de llamar aquí);
 * - conserva `createdAt`/`createdBy` originales si la asociación ya existía.
 */
export async function saveEkonLink(input: SaveEkonLinkInput): Promise<void> {
  const database = db();
  const { campaignNameKey, campaignName, ekonCampaignNumber, actor } = input;
  const linkId = campaignKeyId(campaignNameKey);
  const linkRef = doc(database, LINKS, linkId);
  const numberRef = doc(database, NUMBERS, String(ekonCampaignNumber));

  await runTransaction(database, async (tx) => {
    // Todas las lecturas antes de cualquier escritura.
    const numberSnap = await tx.get(numberRef);
    const linkSnap = await tx.get(linkRef);

    if (numberSnap.exists()) {
      const owner = numberSnap.data().campaignNameKey as string | undefined;
      if (owner && owner !== campaignNameKey) {
        throw new EkonLinkError(
          `El número Ekon ${ekonCampaignNumber} ya está asignado a otra campaña.`,
          'ekon-taken',
        );
      }
    }

    const now = Date.now();
    const existing = linkSnap.exists()
      ? (linkSnap.data() as Omit<CampaignEkonLink, 'id'>)
      : null;

    // Reemplazo: si la campaña tenía otro número, libera la reserva anterior.
    if (existing && existing.ekonCampaignNumber !== ekonCampaignNumber) {
      tx.delete(doc(database, NUMBERS, String(existing.ekonCampaignNumber)));
    }

    tx.set(numberRef, {
      campaignNameKey,
      ekonCampaignNumber,
      updatedAt: now,
      updatedBy: actor.email,
    });

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
 * Elimina la asociación de una campaña y libera su reserva de número Ekon, de
 * forma atómica. Si la campaña no tenía asociación, no hace nada.
 * Nunca modifica ni elimina la campaña importada.
 */
export async function unlinkEkon(input: UnlinkEkonInput): Promise<void> {
  const database = db();
  const linkId = campaignKeyId(input.campaignNameKey);
  const linkRef = doc(database, LINKS, linkId);

  await runTransaction(database, async (tx) => {
    const linkSnap = await tx.get(linkRef);
    if (!linkSnap.exists()) return;

    const data = linkSnap.data() as Omit<CampaignEkonLink, 'id'>;
    const numberRef = doc(database, NUMBERS, String(data.ekonCampaignNumber));
    const numberSnap = await tx.get(numberRef);

    // Solo libera la reserva si sigue perteneciendo a esta campaña.
    if (
      numberSnap.exists() &&
      numberSnap.data().campaignNameKey === input.campaignNameKey
    ) {
      tx.delete(numberRef);
    }
    tx.delete(linkRef);
  });
}
