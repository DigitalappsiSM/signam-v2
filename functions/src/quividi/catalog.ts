import type { Firestore } from 'firebase-admin/firestore';
import type { ScreenDoc } from './effectiveScope';
import type { TopologyLocation } from './measurement';

export function topologyLocationName(location: TopologyLocation): string {
  return (location.name ?? location.label ?? '').trim();
}

/**
 * Migra de forma conservadora el catálogo existente al ID estable de Quividi.
 *
 * - Si ya existe Location ID y la topología lo conoce, sincroniza el alias.
 * - Si falta el ID, solo lo rellena cuando el alias coincide con UNA location.
 * - Nunca adivina ante alias duplicados o inexistentes.
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
    locationId: number;
    cameraName: string;
  }> = [];

  const migrated = screens.map((screen) => {
    const rawId = screen.metadata?.quividiLocationId;
    const currentId =
      typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0
        ? rawId
        : null;
    const currentName = screen.metadata?.quividiCameraName?.trim() ?? '';

    let location: TopologyLocation | undefined;
    if (currentId !== null) {
      location = byId.get(currentId);
    } else if (currentName) {
      const candidates = byName.get(currentName) ?? [];
      if (candidates.length === 1) location = candidates[0];
    }

    if (!location) return screen;
    const canonicalName = topologyLocationName(location) || currentName;
    const changed =
      currentId !== location.id || currentName !== canonicalName;
    if (!changed) return screen;

    if (screen.id) {
      updates.push({
        id: screen.id,
        locationId: location.id,
        cameraName: canonicalName,
      });
    }

    return {
      ...screen,
      metadata: {
        ...screen.metadata,
        quividiLocationId: location.id,
        quividiCameraName: canonicalName,
      },
    };
  });

  for (let offset = 0; offset < updates.length; offset += 400) {
    const batch = db.batch();
    for (const update of updates.slice(offset, offset + 400)) {
      batch.update(db.collection('screens').doc(update.id), {
        'metadata.quividiLocationId': update.locationId,
        'metadata.quividiCameraName': update.cameraName,
      });
    }
    await batch.commit();
  }

  return { screens: migrated, updated: updates.length };
}
