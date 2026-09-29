import {
  collection,
  deleteField,
  doc,
  getDocs,
  runTransaction,
  writeBatch,
} from 'firebase/firestore';
import { getFirebase } from './firebase';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  campaignKey,
  campaignIdentity,
  campaignSignature,
  type CampaignDiff,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';
import {
  findManualDuplicates,
  manualCampaignId,
  scoreManualMatch,
} from '@/modules/campaigns/manualCampaign';
import {
  manualEditBlocker,
  manualEditChanges,
  manualEditComment,
} from '@/modules/campaigns/manualCampaignEdit';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import {
  initialTracking,
  type TrackingActor,
} from '@/modules/operational-tracking/trackingFactory';
import { isValidDownloadUrl } from '@/modules/operational-tracking/downloadLink';
import {
  campaignCorrectionError,
  correctionChanges,
  correctionComment,
  type CampaignCorrectionEvent,
  type CampaignCorrectionValues,
  type CampaignManualOverrides,
} from '@/modules/campaigns/campaignCorrection';
import type {
  ImportDateCorrection,
  ImportDateCorrections,
} from '@/modules/liverpool-import/importDateCorrection';

/**
 * Persistencia de campañas del calendario en Cloud Firestore.
 *
 * Solo se escriben los cambios aceptados por el usuario (altas, modificaciones y
 * bajas). Si no hay cambios, no se reescribe nada.
 */

const COLLECTION = 'campaigns';
const BATCH_LIMIT = 400;

function db() {
  const fb = getFirebase();
  if (!fb) throw new Error('Firebase no está configurado.');
  return fb.db;
}

/** Lee las campañas guardadas. Por defecto omite las bajas lógicas. */
export async function listCampaigns(options?: {
  includeInactive?: boolean;
}): Promise<StoredCampaign[]> {
  const snapshot = await getDocs(collection(db(), COLLECTION));
  const campaigns = snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<StoredCampaign, 'id'>),
  }));
  return options?.includeInactive
    ? campaigns
    : campaigns.filter((campaign) => campaign.active !== false);
}

export interface CorrectCampaignParams {
  campaignId: string;
  values: CampaignCorrectionValues;
  reason: string;
  actor: Actor;
}

/**
 * Corrige campos escalares y registra el evento en la subcolección append-only
 * dentro de la misma transacción. Las correcciones quedan como overrides para
 * que una reimportación no restaure silenciosamente el dato erróneo.
 */
export async function correctCampaign({
  campaignId,
  values,
  reason,
  actor,
}: CorrectCampaignParams): Promise<{
  campaign: StoredCampaign;
  event: CampaignCorrectionEvent;
}> {
  const database = db();
  const campaignRef = doc(database, COLLECTION, campaignId);
  const correctionRef = doc(
    collection(database, COLLECTION, campaignId, 'corrections'),
  );

  return runTransaction(database, async (tx) => {
    const snapshot = await tx.get(campaignRef);
    if (!snapshot.exists()) throw new Error('La campaña ya no existe.');
    const current: StoredCampaign = {
      id: campaignId,
      ...(snapshot.data() as Omit<StoredCampaign, 'id'>),
    };
    const validation = campaignCorrectionError(current, values, reason);
    if (validation) throw new Error(validation);

    const now = Date.now();
    const changes = correctionChanges(current, values);
    const next = { ...current, ...values };
    const manualOverrides: CampaignManualOverrides = {
      ...(current.manualOverrides ?? {}),
    };
    for (const change of changes) {
      manualOverrides[change.field] = {
        value: change.after,
        reason: reason.trim(),
        correctedAt: now,
        correctedByUid: actor.uid,
        correctedByEmail: actor.email,
      };
    }
    const event: CampaignCorrectionEvent = {
      id: correctionRef.id,
      campaignId,
      campaignName: current.name,
      changes,
      reason: reason.trim(),
      comment: correctionComment(changes, reason, actor.email, now),
      actorUid: actor.uid,
      actorEmail: actor.email,
      at: now,
    };
    const { id: _campaignId, ...campaignData } = next;
    void _campaignId;
    tx.set(
      campaignRef,
      {
        ...campaignData,
        signature: campaignSignature(next),
        manualOverrides,
        updatedAt: now,
        updatedBy: actor.email,
      },
      { merge: true },
    );
    const { id: _eventId, ...eventData } = event;
    void _eventId;
    tx.set(correctionRef, eventData);

    return {
      campaign: {
        ...next,
        signature: campaignSignature(next),
        manualOverrides,
        updatedAt: now,
        updatedBy: actor.email,
      },
      event,
    };
  });
}

/** Historial inmutable de correcciones de una campaña, más reciente primero. */
export async function listCampaignCorrections(
  campaignId: string,
): Promise<CampaignCorrectionEvent[]> {
  const snapshot = await getDocs(
    collection(db(), COLLECTION, campaignId, 'corrections'),
  );
  return snapshot.docs
    .map((item) => ({
      id: item.id,
      ...(item.data() as Omit<CampaignCorrectionEvent, 'id'>),
    }))
    .sort((a, b) => b.at - a.at);
}

function campaignDoc(
  campaign: ParsedCampaign,
  actor: Actor,
  now: number,
  manualOverrides?: CampaignManualOverrides,
) {
  const base = {
    ...campaign,
    // `nameKey` = nombre normalizado (llave estable de Ekon y del CSV). La
    // separación de "flights" homónimos ocurre en Seguimiento vía la identidad
    // por todos los datos (`campaignIdentity`), no aquí.
    nameKey: campaignKey(campaign.name),
    signature: campaignSignature(campaign),
    active: true,
    deactivatedAt: null,
    deactivatedBy: null,
    updatedAt: now,
    updatedBy: actor.email,
  };
  return manualOverrides && Object.keys(manualOverrides).length > 0
    ? { ...base, manualOverrides }
    : base;
}

/**
 * Traduce las correcciones de fecha capturadas durante la importación en los
 * `manualOverrides` y el evento auditable de cada alta afectada. Reutiliza las
 * mismas funciones de dominio que `correctCampaign` para que una corrección de
 * importación quede idéntica a una hecha desde Campañas.
 */
interface CorrectionWrite {
  manualOverrides: CampaignManualOverrides;
  event: CampaignCorrectionEvent;
  eventRef: ReturnType<typeof doc>;
}

function buildImportCorrectionWrite(
  database: ReturnType<typeof db>,
  campaignId: string,
  campaign: ParsedCampaign,
  correction: ImportDateCorrection,
  actor: Actor,
  now: number,
): CorrectionWrite | null {
  const before: ParsedCampaign = {
    ...campaign,
    fechaInicio: correction.before.fechaInicio,
    fechaFin: correction.before.fechaFin,
  };
  const values: CampaignCorrectionValues = {
    fechaInicio: correction.fechaInicio,
    fechaFin: correction.fechaFin,
  };
  const changes = correctionChanges(before, values);
  if (changes.length === 0) return null;
  const reason = correction.reason.trim();
  const manualOverrides: CampaignManualOverrides = {};
  for (const change of changes) {
    manualOverrides[change.field] = {
      value: change.after,
      reason,
      correctedAt: now,
      correctedByUid: actor.uid,
      correctedByEmail: actor.email,
    };
  }
  const eventRef = doc(
    collection(database, COLLECTION, campaignId, 'corrections'),
  );
  const event: CampaignCorrectionEvent = {
    id: eventRef.id,
    campaignId,
    campaignName: campaign.name,
    changes,
    reason,
    comment: correctionComment(changes, reason, actor.email, now),
    actorUid: actor.uid,
    actorEmail: actor.email,
    at: now,
  };
  return { manualOverrides, event, eventRef };
}

export interface ApplyResult {
  added: number;
  modified: number;
  removed: number;
  /** IDs canónicos asignados a las altas de esta importación. */
  addedCampaignIds: Record<string, string>;
}

/**
 * Aplica los cambios de un diff previamente confirmado: altas, modificaciones y
 * bajas. Devuelve los conteos aplicados.
 */
export async function applyCampaignChanges(
  diff: CampaignDiff,
  actor: Actor,
  importCorrections?: ImportDateCorrections,
): Promise<ApplyResult> {
  const database = db();
  const now = Date.now();

  type Op =
    | {
        kind: 'set';
        id: string;
        campaign: ParsedCampaign;
        createdAt?: number;
        /** Campaña manual que el calendario de Liverpool adopta con este alta. */
        adopts?: StoredCampaign;
      }
    | { kind: 'deactivate'; campaign: StoredCampaign };

  const ops: Op[] = [
    ...diff.added.map((campaign) => ({
      kind: 'set' as const,
      id: doc(collection(database, COLLECTION)).id,
      campaign,
      createdAt: now,
    })),
    ...diff.modified.map((m) => ({
      kind: 'set' as const,
      id: m.stored.id,
      campaign: m.campaign,
      adopts: m.adoptsManual ? m.stored : undefined,
    })),
    ...diff.removed.map((campaign) => ({
      kind: 'deactivate' as const,
      campaign,
    })),
  ];

  // Correcciones de fecha capturadas durante la importación: solo aplican a
  // altas (las modificaciones de campañas existentes se corrigen desde
  // Campañas). Cada una escribe `manualOverrides` en el alta y un evento en su
  // bitácora `corrections`, en el mismo lote atómico que la creación.
  const correctionWrites = new Map<string, CorrectionWrite>();
  if (importCorrections && importCorrections.size > 0) {
    for (const op of ops) {
      if (op.kind !== 'set' || op.createdAt == null) continue;
      const correction = importCorrections.get(op.campaign.row);
      if (!correction) continue;
      const write = buildImportCorrectionWrite(
        database,
        op.id,
        op.campaign,
        correction,
        actor,
        now,
      );
      if (write) correctionWrites.set(op.id, write);
    }
  }

  for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
    const batch = writeBatch(database);
    for (const op of ops.slice(i, i + BATCH_LIMIT)) {
      if (op.kind === 'deactivate') {
        batch.set(
          doc(database, COLLECTION, op.campaign.id),
          {
            active: false,
            deactivatedAt: now,
            deactivatedBy: actor.email,
            updatedAt: now,
            updatedBy: actor.email,
          },
          { merge: true },
        );
        continue;
      }
      const ref = doc(database, COLLECTION, op.id);
      const correction = correctionWrites.get(op.id);
      const data = campaignDoc(
        op.campaign,
        actor,
        now,
        correction?.manualOverrides,
      );
      // Adoptar una manual conserva su `id` (y con él seguimiento y Ekon); solo
      // cambia el origen y deja el historial de cómo fue capturada a mano.
      const adoption = op.adopts
        ? {
            origin: 'liverpool' as const,
            adoptedFromManualAt: now,
            adoptedFromManualBy: actor.email,
            manualSnapshot: {
              name: op.adopts.name,
              tipo: op.adopts.tipo,
              fechaInicio: op.adopts.fechaInicio,
              fechaFin: op.adopts.fechaFin,
              supports: op.adopts.supports,
              ...(op.adopts.manualOverrides
                ? { manualOverrides: op.adopts.manualOverrides }
                : {}),
            },
            // El calendario es la fuente de verdad: las correcciones hechas a la
            // versión manual dejan de prevalecer en futuras importaciones.
            manualOverrides: deleteField(),
          }
        : {};
      batch.set(
        ref,
        op.createdAt
          ? { ...data, ...adoption, createdAt: op.createdAt }
          : { ...data, ...adoption },
        { merge: true },
      );
      if (correction) {
        const { id: _eventId, ...eventData } = correction.event;
        void _eventId;
        batch.set(correction.eventRef, eventData);
      }
    }
    await batch.commit();
  }

  return {
    added: diff.added.length,
    modified: diff.modified.length,
    removed: diff.removed.length,
    addedCampaignIds: Object.fromEntries(
      ops
        .filter(
          (op): op is Extract<Op, { kind: 'set' }> =>
            op.kind === 'set' && op.createdAt != null,
        )
        .map((op) => [campaignIdentity(op.campaign), op.id]),
    ),
  };
}

/**
 * Crea una campaña **manual** (sampling, proveedor, etc.) y, en el mismo lote
 * atómico, su seguimiento operativo. Regla de negocio: toda campaña manual tiene
 * seguimiento desde el primer momento; sampling y proveedor se operan con la
 * clasificación Proveedor (marca, testigos y aprobaciones completos).
 *
 * No toca `campaignEkonLinks` ni ninguna otra colección. Devuelve el `id`
 * persistente, que se conserva si Liverpool sube después la campaña.
 */
export async function createManualCampaign(
  campaign: ParsedCampaign,
  actor: Actor,
): Promise<string> {
  const database = db();
  const now = Date.now();
  // Verificación fresca (el modal trabaja con una foto que pudo quedar vieja):
  // otra persona o una importación pudo crear la misma campaña entretanto.
  const duplicates = findManualDuplicates(
    campaign,
    await listCampaigns(),
  ).blocking;
  if (duplicates.length > 0) {
    throw new Error(
      `Ya existe la campaña "${duplicates[0]!.campaign.name}" con las mismas fechas. Actualiza la pantalla: puede que Liverpool ya la haya subido.`,
    );
  }
  // Id determinístico (nombre + fechas): dos altas simultáneas de la misma
  // campaña colisionan en el mismo documento y la transacción rechaza la segunda.
  // Si ese documento existe pero ya fue editado a otra cosa, el id ya no es un
  // cerrojo válido y se usa uno nuevo.
  const lockRef = doc(database, COLLECTION, manualCampaignId(campaign));
  const classification =
    classifyFromTipo(campaign.tipo) === 'institutional'
      ? 'institutional'
      : 'provider';
  const trackingActor: TrackingActor = { uid: actor.uid, email: actor.email };

  return runTransaction(database, async (tx) => {
    let ref = lockRef;
    const existing = await tx.get(lockRef);
    if (existing.exists()) {
      const current = existing.data() as ParsedCampaign;
      if (scoreManualMatch(campaign, current)?.level === 'strong') {
        throw new Error(
          'Esta campaña manual ya existe (mismo nombre y fechas). Actualiza la pantalla.',
        );
      }
      ref = doc(collection(database, COLLECTION));
    }
    const tracking = initialTracking(
      {
        campaignId: ref.id,
        campaignNameKey: campaignKey(campaign.name),
        campaignName: campaign.name,
        classification,
        classificationSource: 'manual-campaign',
        linkValid: isValidDownloadUrl(campaign.link),
      },
      trackingActor,
      now,
    );
    const { id: _trackingId, ...trackingData } = tracking;
    void _trackingId;
    tx.set(ref, {
      ...campaignDoc(campaign, actor, now),
      origin: 'manual',
      createdAt: now,
      createdBy: actor.email,
    });
    tx.set(doc(database, 'campaignOperationalTracking', ref.id), trackingData);
    return ref.id;
  });
}

export interface UpdateManualCampaignParams {
  campaignId: string;
  /** Campaña completa ya editada (misma forma que la del alta). */
  campaign: ParsedCampaign;
  reason: string;
  actor: Actor;
}

/**
 * Edita una campaña **manual** (nombre, tipo, vigencia, link, soportes y
 * tiendas). En una sola transacción: valida que siga siendo manual y activa,
 * guarda los cambios, sincroniza el nombre mostrado en su seguimiento y agrega el
 * evento al historial append-only (`corrections`). No revalida testigos ni
 * aprobaciones. Conserva el `campaignId`, y con él seguimiento y Ekon.
 */
export async function updateManualCampaign({
  campaignId,
  campaign,
  reason,
  actor,
}: UpdateManualCampaignParams): Promise<{ changes: string[] }> {
  if (reason.trim() === '')
    throw new Error('El motivo de la edición es obligatorio.');
  const database = db();
  const campaignRef = doc(database, COLLECTION, campaignId);
  const trackingRef = doc(database, 'campaignOperationalTracking', campaignId);
  const eventRef = doc(
    collection(database, COLLECTION, campaignId, 'corrections'),
  );

  // Verificación fresca: otra campaña con el mismo nombre y fechas.
  const others = (await listCampaigns()).filter((c) => c.id !== campaignId);
  const clash = findManualDuplicates(campaign, others).blocking[0];
  if (clash) {
    throw new Error(
      `Ya existe la campaña "${clash.campaign.name}" con las mismas fechas.`,
    );
  }

  return runTransaction(database, async (tx) => {
    const snapshot = await tx.get(campaignRef);
    if (!snapshot.exists()) throw new Error('La campaña ya no existe.');
    const current: StoredCampaign = {
      id: campaignId,
      ...(snapshot.data() as Omit<StoredCampaign, 'id'>),
    };
    const blocker = manualEditBlocker(current);
    if (blocker) throw new Error(blocker);

    const changes = manualEditChanges(current, campaign);
    if (changes.length === 0) throw new Error('No hay cambios que guardar.');

    // Firestore exige TODAS las lecturas de la transacción antes de la primera
    // escritura: el seguimiento se lee aquí, no después de `tx.set`.
    const trackingSnap = await tx.get(trackingRef);

    const now = Date.now();
    tx.set(
      campaignRef,
      {
        name: campaign.name,
        nameKey: campaignKey(campaign.name),
        tipo: campaign.tipo,
        vendidoPor: campaign.vendidoPor,
        fechaInicio: campaign.fechaInicio,
        fechaFin: campaign.fechaFin,
        mes: campaign.mes,
        link: campaign.link,
        supports: campaign.supports,
        signature: campaignSignature(campaign),
        updatedAt: now,
        updatedBy: actor.email,
      },
      { merge: true },
    );
    // El seguimiento conserva `campaignNameKey` (inmutable por reglas); solo se
    // sincroniza el nombre visible.
    if (trackingSnap.exists() && current.name !== campaign.name) {
      tx.update(trackingRef, { campaignName: campaign.name, updatedAt: now });
    }
    tx.set(eventRef, {
      campaignId,
      campaignName: campaign.name,
      changes: [],
      reason: reason.trim(),
      comment: manualEditComment(changes, reason, actor.email, now),
      actorUid: actor.uid,
      actorEmail: actor.email,
      at: now,
    });
    return { changes };
  });
}
