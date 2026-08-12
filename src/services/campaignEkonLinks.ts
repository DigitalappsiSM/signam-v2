import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { campaignKeyId } from '@/modules/campaigns/ekon';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';

/**
 * Persistencia de la asociación entre una campaña Liverpool y su número de
 * campaña Ekon.
 *
 * La asociación vive en una colección SEPARADA de las campañas importadas, para
 * que sobreviva a actualizaciones, borrados temporales y reimportaciones. La
 * importación del calendario nunca la toca y esta nunca modifica la campaña
 * importada.
 *
 * - `campaignEkonLinks/{campaignId}`: una asociación por instancia estable de
 *   campaña. Los documentos legacy basados en `nameKey` se migran copiando el
 *   número actual a cada flight existente.
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
  /** ID del documento. En el esquema actual coincide con `campaignId`. */
  id: string;
  /** Identidad canónica de `campaigns/{campaignId}`; ausente en documentos legacy. */
  campaignId?: string;
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
  campaignId: string;
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
  const {
    campaignId,
    campaignNameKey,
    campaignName,
    ekonCampaignNumber,
    actor,
  } = input;
  const linkId = campaignId;
  const linkRef = doc(database, LINKS, linkId);

  await runTransaction(database, async (tx) => {
    const linkSnap = await tx.get(linkRef);

    const now = Date.now();
    const existing = linkSnap.exists()
      ? (linkSnap.data() as Omit<CampaignEkonLink, 'id'>)
      : null;

    tx.set(linkRef, {
      campaignId,
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
  campaignId: string;
  actor: Actor;
}

/**
 * Elimina la asociación Ekon de una campaña. Si la campaña no tenía asociación,
 * no hace nada. Como el número puede estar en otras campañas, desvincular una NO
 * afecta a las demás. Nunca modifica ni elimina la campaña importada.
 */
export async function unlinkEkon(input: UnlinkEkonInput): Promise<void> {
  const database = db();
  await deleteDoc(doc(database, LINKS, input.campaignId));
}

/**
 * Migra las asociaciones legacy (`document id = campaignKeyId(nameKey)`) al id
 * estable de cada campaña. Si hay varios flights con el mismo nombre, todos
 * reciben inicialmente el número actual; después pueden editarse por separado.
 * La operación es idempotente y elimina el documento legacy solo cuando pudo
 * copiarlo al menos a una campaña.
 */
export async function migrateLegacyEkonLinks(
  campaigns: readonly StoredCampaign[],
  links: readonly CampaignEkonLink[],
): Promise<number> {
  const database = db();
  const currentIds = new Set(
    links.filter((link) => link.campaignId).map((link) => link.campaignId!),
  );
  const legacy = links.filter((link) => !link.campaignId);
  type Migration = {
    legacy: CampaignEkonLink;
    campaigns: StoredCampaign[];
  };
  const migrations: Migration[] = legacy
    .map((link) => ({
      legacy: link,
      campaigns: campaigns.filter(
        (campaign) => campaign.nameKey === link.campaignNameKey,
      ),
    }))
    .filter((migration) => migration.campaigns.length > 0);

  let writes = 0;
  const ops: Array<
    | { kind: 'copy'; link: CampaignEkonLink; campaign: StoredCampaign }
    | { kind: 'delete'; id: string }
  > = [];
  for (const migration of migrations) {
    for (const campaign of migration.campaigns) {
      if (currentIds.has(campaign.id)) continue;
      ops.push({ kind: 'copy', link: migration.legacy, campaign });
      currentIds.add(campaign.id);
      writes += 1;
    }
    ops.push({ kind: 'delete', id: migration.legacy.id });
  }

  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(database);
    for (const op of ops.slice(i, i + 400)) {
      if (op.kind === 'delete') {
        batch.delete(doc(database, LINKS, op.id));
        continue;
      }
      batch.set(doc(database, LINKS, op.campaign.id), {
        campaignId: op.campaign.id,
        campaignNameKey: op.campaign.nameKey,
        campaignName: op.campaign.name,
        ekonCampaignNumber: op.link.ekonCampaignNumber,
        createdAt: op.link.createdAt,
        createdBy: op.link.createdBy,
        updatedAt: op.link.updatedAt,
        updatedBy: op.link.updatedBy,
      });
    }
    await batch.commit();
  }
  return writes;
}

/** Devuelve la asociación exacta de una instancia; fallback solo para legacy. */
export function ekonNumberForCampaign(
  campaign: StoredCampaign,
  links: readonly CampaignEkonLink[],
): number | null {
  const exact = links.find((link) => link.campaignId === campaign.id);
  if (exact) return exact.ekonCampaignNumber;
  const legacyId = campaignKeyId(campaign.nameKey);
  const legacy = links.find(
    (link) =>
      !link.campaignId &&
      (link.id === legacyId || link.campaignNameKey === campaign.nameKey),
  );
  return legacy?.ekonCampaignNumber ?? null;
}
