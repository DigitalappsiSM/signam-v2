import type { Firestore } from 'firebase-admin/firestore';
import type { ScreenDoc } from './effectiveScope';
import type { TopologyLocation } from './measurement';

export function topologyLocationName(location: TopologyLocation): string {
  return (location.name ?? location.label ?? '').trim();
}

interface SlotBindingFields {
  locationIdField: 'quividiLocationId' | 'quividiLocationId2';
  cameraNameField: 'quividiCameraName' | 'quividiCameraName2';
}

const SLOT_1: SlotBindingFields = {
  locationIdField: 'quividiLocationId',
  cameraNameField: 'quividiCameraName',
};
const SLOT_2: SlotBindingFields = {
  locationIdField: 'quividiLocationId2',
  cameraNameField: 'quividiCameraName2',
};

/**
 * Resuelve un único slot de cámara (principal o segunda) contra la topología.
 * Devuelve `null` si no hay nada que sincronizar (sin location resoluble o ya
 * al día).
 */
function resolveSlotBinding(
  screen: ScreenDoc,
  fields: SlotBindingFields,
  byId: ReadonlyMap<number, TopologyLocation>,
  byName: ReadonlyMap<string, TopologyLocation[]>,
): { locationId: number; cameraName: string } | null {
  const rawId = screen.metadata?.[fields.locationIdField];
  const currentId =
    typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0
      ? rawId
      : null;
  const currentName = screen.metadata?.[fields.cameraNameField]?.trim() ?? '';

  let location: TopologyLocation | undefined;
  if (currentId !== null) {
    location = byId.get(currentId);
  } else if (currentName) {
    const candidates = byName.get(currentName) ?? [];
    if (candidates.length === 1) location = candidates[0];
  }

  if (!location) return null;
  const canonicalName = topologyLocationName(location) || currentName;
  const changed = currentId !== location.id || currentName !== canonicalName;
  if (!changed) return null;

  return { locationId: location.id, cameraName: canonicalName };
}

/**
 * Migra de forma conservadora el catálogo existente al ID estable de Quividi.
 *
 * - Si ya existe Location ID y la topología lo conoce, sincroniza el alias.
 * - Si falta el ID, solo lo rellena cuando el alias coincide con UNA location.
 * - Nunca adivina ante alias duplicados o inexistentes.
 * - Ambos slots (cámara principal y segunda cámara) se resuelven de forma
 *   independiente, para que un alias importado por maestro también termine
 *   anclado a un Location ID estable.
 */
export async function syncCatalogLocationBindings(
  db: Firestore,
  screens: readonly ScreenDoc[],
  topology: readonly TopologyLocation[],
): Promise<{ screens: ScreenDoc[]; updated: number }> {
  const byId = new Map(topology.map((location) => [location.id, location]));
  const byName = new Map<string, TopologyLocation[]>();
  for (const location of topology) {
    const name = topologyLocationName(location);
    if (!name) continue;
    const group = byName.get(name) ?? [];
    group.push(location);
    byName.set(name, group);
  }

  const updates: Array<{
    id: string;
    fields: Record<string, number | string>;
  }> = [];

  const migrated = screens.map((screen) => {
    const slot1 = resolveSlotBinding(screen, SLOT_1, byId, byName);
    const slot2 = resolveSlotBinding(screen, SLOT_2, byId, byName);
    if (!slot1 && !slot2) return screen;

    const fields: Record<string, number | string> = {};
    if (slot1) {
      fields[`metadata.${SLOT_1.locationIdField}`] = slot1.locationId;
      fields[`metadata.${SLOT_1.cameraNameField}`] = slot1.cameraName;
    }
    if (slot2) {
      fields[`metadata.${SLOT_2.locationIdField}`] = slot2.locationId;
      fields[`metadata.${SLOT_2.cameraNameField}`] = slot2.cameraName;
    }

    if (screen.id) {
      updates.push({ id: screen.id, fields });
    }

    return {
      ...screen,
      metadata: {
        ...screen.metadata,
        ...(slot1 && {
          quividiLocationId: slot1.locationId,
          quividiCameraName: slot1.cameraName,
        }),
        ...(slot2 && {
          quividiLocationId2: slot2.locationId,
          quividiCameraName2: slot2.cameraName,
        }),
      },
    };
  });

  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + 400)) {
      batch.update(db.collection('screens').doc(update.id), update.fields);
    }
    await batch.commit();
  }

  return { screens: migrated, updated: updates.length };
}
