import { collection, doc, getDocs, runTransaction } from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import type {
  CampaignSupportOverride,
  SupportOverrideDecision,
  SupportOverrideHistoryEntry,
} from '@/modules/campaigns/supportOverride';

/**
 * Persistencia de la confirmación de soportes/tiendas Calendario ↔ Ekon.
 *
 * Colección SEPARADA (`campaignSupportOverrides/{campaignId}`), igual que el
 * vínculo Ekon y el seguimiento: la importación del calendario nunca la toca y
 * esta nunca modifica la campaña importada. Cada decisión se agrega al
 * historial (append-only) dentro de una transacción.
 */

const COLLECTION = 'campaignSupportOverrides';

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Firestore no admite `undefined`: copia solo los campos definidos. */
function cleanSupports(
  supports: readonly CampaignSupport[],
): CampaignSupport[] {
  return supports.map((s) => {
    const out: CampaignSupport = {
      support: s.support,
      owner: s.owner,
      stores: s.stores.map((st) => ({
        numero: st.numero,
        nombre: st.nombre ?? '',
      })),
    };
    if (s.scope) out.scope = s.scope;
    if (s.scopeSource) out.scopeSource = s.scopeSource;
    return out;
  });
}

export async function listSupportOverrides(): Promise<
  CampaignSupportOverride[]
> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  return snapshot.docs.map((d) => ({
    ...(d.data() as Omit<CampaignSupportOverride, 'id'>),
    id: d.id,
  }));
}

export interface SaveSupportOverrideInput {
  campaignId: string;
  campaignName: string;
  decision: SupportOverrideDecision;
  supports: readonly CampaignSupport[];
  reason: string;
  ekonNumber: number | null;
  calendarFingerprint: string;
  ekonFingerprint: string;
}

/** Guarda (o reemplaza) la decisión vigente y la agrega al historial. */
export async function saveSupportOverride(
  input: SaveSupportOverrideInput,
  actor: string,
): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error('El motivo es obligatorio.');
  const supports =
    input.decision === 'ekon' ? cleanSupports(input.supports) : [];
  if (input.decision === 'ekon' && supports.length === 0) {
    throw new Error('Ekon no aporta soportes para confirmar.');
  }
  const ref = doc(db(), COLLECTION, input.campaignId);
  await runTransaction(db(), async (tx) => {
    const current = await tx.get(ref);
    const prev = current.exists()
      ? (current.data() as Omit<CampaignSupportOverride, 'id'>)
      : null;
    const now = Date.now();
    const entry: SupportOverrideHistoryEntry = {
      at: now,
      by: actor,
      decision: input.decision,
      reason,
      ekonNumber: input.ekonNumber,
      calendarFingerprint: input.calendarFingerprint,
      ekonFingerprint: input.ekonFingerprint,
      supports,
    };
    const next: Omit<CampaignSupportOverride, 'id'> = {
      campaignId: input.campaignId,
      campaignName: input.campaignName,
      decision: input.decision,
      supports,
      reason,
      ekonNumber: input.ekonNumber,
      calendarFingerprint: input.calendarFingerprint,
      ekonFingerprint: input.ekonFingerprint,
      createdAt: prev?.createdAt ?? now,
      createdBy: prev?.createdBy ?? actor,
      updatedAt: now,
      updatedBy: actor,
      history: [...(prev?.history ?? []), entry],
    };
    tx.set(ref, next);
  });
}
