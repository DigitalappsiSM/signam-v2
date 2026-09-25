import type { Firestore } from 'firebase-admin/firestore';
import type { ScreenDoc } from './effectiveScope';
import type { TopologyLocation } from './measurement';
import {
  buildBackendMeasurementPointId,
  measurementSupportCode,
  normalizedStoreCode,
  validMeasurementPointCode,
} from './measurementPoint';

export function topologyLocationName(location: TopologyLocation): string {
  return (location.name ?? location.label ?? '').trim();
}

interface SlotBindingFields {
  locationIdField: 'quividiLocationId' | 'quividiLocationId2';
  cameraNameField: 'quividiCameraName' | 'quividiCameraName2';
  pointCodeField: 'measurementPointCode' | 'measurementPointCode2';
  pointIdField: 'measurementPointId' | 'measurementPointId2';
}

const SLOT_1: SlotBindingFields = {
  locationIdField: 'quividiLocationId',
  cameraNameField: 'quividiCameraName',
  pointCodeField: 'measurementPointCode',
  pointIdField: 'measurementPointId',
};
const SLOT_2: SlotBindingFields = {
  locationIdField: 'quividiLocationId2',
  cameraNameField: 'quividiCameraName2',
  pointCodeField: 'measurementPointCode2',
  pointIdField: 'measurementPointId2',
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

  const pending = new Map<string, Record<string, number | string>>();
  const queue = (
    screenId: string | undefined,
    fields: Record<string, number | string>,
  ) => {
    if (!screenId || Object.keys(fields).length === 0) return;
    pending.set(screenId, { ...(pending.get(screenId) ?? {}), ...fields });
  };

  const withLocations = screens.map((screen) => {
    const slot1 = resolveSlotBinding(screen, SLOT_1, byId, byName);
    const slot2 = resolveSlotBinding(screen, SLOT_2, byId, byName);
    const fields: Record<string, number | string> = {};

    if (slot1) {
      fields[`metadata.${SLOT_1.locationIdField}`] = slot1.locationId;
      fields[`metadata.${SLOT_1.cameraNameField}`] = slot1.cameraName;
    }
    if (slot2) {
      fields[`metadata.${SLOT_2.locationIdField}`] = slot2.locationId;
      fields[`metadata.${SLOT_2.cameraNameField}`] = slot2.cameraName;
    }
    queue(screen.id, fields);

    if (!slot1 && !slot2) return screen;
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

  type SlotRef = {
    screenIndex: number;
    screenId: string | undefined;
    slot: SlotBindingFields;
    locationId: number;
    storeNumber: string;
    support: string;
    existingCode: string;
    existingId: string;
  };

  const groups = new Map<string, SlotRef[]>();
  for (let screenIndex = 0; screenIndex < withLocations.length; screenIndex += 1) {
    const screen = withLocations[screenIndex]!;
    const storeNumber = screen.original?.['Numero de Tienda']?.trim() ?? '';
    const support = screen.metadata?.calendarSupport?.trim() ?? '';
    if (!storeNumber || !support) continue;

    for (const slot of [SLOT_1, SLOT_2] as const) {
      const rawLocation = screen.metadata?.[slot.locationIdField];
      if (
        typeof rawLocation !== 'number' ||
        !Number.isInteger(rawLocation) ||
        rawLocation <= 0
      ) {
        continue;
      }

      const existingCode =
        screen.metadata?.[slot.pointCodeField]?.trim() ?? '';
      const existingId = screen.metadata?.[slot.pointIdField]?.trim() ?? '';
      const storeCode = normalizedStoreCode(storeNumber);
      const supportCode = measurementSupportCode(support);
      if (!storeCode || !supportCode) continue;

      const key = storeCode + '|' + supportCode;
      const group = groups.get(key) ?? [];
      group.push({
        screenIndex,
        screenId: screen.id,
        slot,
        locationId: rawLocation,
        storeNumber,
        support,
        existingCode,
        existingId,
      });
      groups.set(key, group);
    }
  }

  const resultScreens = [...withLocations];

  for (const group of groups.values()) {
    const locationIds = group.map((item) => item.locationId);
    if (new Set(locationIds).size !== locationIds.length) {
      // Un mismo Location ID repetido dentro de tienda+soporte es ambiguo.
      // No se asignan puntos automáticamente hasta corregir el catálogo.
      continue;
    }

    const existingCodes = group
      .map((item) => item.existingCode)
      .filter(Boolean);
    if (
      existingCodes.some((code) => !validMeasurementPointCode(code)) ||
      new Set(existingCodes).size !== existingCodes.length
    ) {
      // Nunca autocorregimos nomenclaturas inválidas ni duplicadas.
      continue;
    }

    const used = new Set(existingCodes);
    let nextNumber = 1;
    const nextCode = (): string => {
      while (used.has('P' + nextNumber)) nextNumber += 1;
      const code = 'P' + nextNumber;
      used.add(code);
      nextNumber += 1;
      return code;
    };

    const ordered = [...group].sort(
      (a, b) =>
        a.locationId - b.locationId ||
        (a.screenId ?? '').localeCompare(b.screenId ?? '') ||
        a.slot.locationIdField.localeCompare(b.slot.locationIdField),
    );

    for (const item of ordered) {
      const pointCode = item.existingCode || nextCode();
      const pointId = buildBackendMeasurementPointId({
        storeNumber: item.storeNumber,
        support: item.support,
        pointCode,
      });
      if (!pointId) continue;

      if (item.existingCode && item.existingId === pointId) continue;

      const screen = resultScreens[item.screenIndex]!;
      const metadata = {
        ...screen.metadata,
        [item.slot.pointCodeField]: pointCode,
        [item.slot.pointIdField]: pointId,
      };
      resultScreens[item.screenIndex] = { ...screen, metadata };

      queue(item.screenId, {
        [`metadata.${item.slot.pointCodeField}`]: pointCode,
        [`metadata.${item.slot.pointIdField}`]: pointId,
      });
    }
  }

  const updates = Array.from(pending, ([id, fields]) => ({ id, fields }));
  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + 400)) {
      batch.update(db.collection('screens').doc(update.id), update.fields);
    }
    await batch.commit();
  }

  return { screens: resultScreens, updated: updates.length };
}
