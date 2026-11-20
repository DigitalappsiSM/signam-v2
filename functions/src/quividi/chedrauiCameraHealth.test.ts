import { describe, expect, it } from 'vitest';
import { linkChedrauiCameraObservations } from './chedrauiCameraHealth';

describe('Salud de cámaras Chedraui OUT', () => {
  it('conserva cada cámara vinculada y distingue una ubicación ausente de una sin señal', () => {
    const observations = linkChedrauiCameraObservations(
      [
        {
          boxId: 'BOX-A',
          name: 'Tienda A',
          camera1: { locationId: 1 },
          camera2: { locationId: 2 },
        },
        { boxId: 'BOX-B', name: 'Tienda B', camera1: { locationId: 3 } },
        { boxId: 'BOX-C', name: 'Tienda C' },
      ],
      [{ id: 1, last_seen: '2026-11-20T14:00:00Z' }, { id: 2 }, { id: 4 }],
    );

    expect(observations).toMatchObject([
      {
        boxId: 'BOX-A',
        camera: 1,
        locationId: 1,
        inNetwork: true,
        lastSeen: '2026-11-20T14:00:00Z',
      },
      {
        boxId: 'BOX-A',
        camera: 2,
        locationId: 2,
        inNetwork: true,
        lastSeen: null,
      },
      {
        boxId: 'BOX-B',
        camera: 1,
        locationId: 3,
        inNetwork: false,
        lastSeen: null,
      },
    ]);
  });
});
