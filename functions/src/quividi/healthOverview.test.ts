import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { CameraHealthAlertStateDoc } from './cameraAlerts';
import { buildCameraHealthOverview } from './healthOverview';

/**
 * Cubre únicamente `cameraPairGaps`, el cálculo nuevo de este módulo. El
 * resto de `buildCameraHealthOverview` (estados, tickets, recuperaciones) no
 * tenía pruebas colocadas antes de esta regla; ampliar esa cobertura queda
 * fuera de alcance aquí.
 */

function stateDoc(
  id: string,
  over: Partial<CameraHealthAlertStateDoc> = {},
): { id: string; data: Partial<CameraHealthAlertStateDoc> } {
  return {
    id,
    data: {
      schemaVersion: 1,
      source: 'quividi',
      locationId: Number(id),
      locationName: `CAM-${id}`,
      storeNumber: '12',
      storeName: 'COAPA',
      support: 'MUPI DIGITAL',
      currentStatus: 'normal',
      severity: 'none',
      latestDate: '2026-09-30',
      activeAlertId: null,
      startedDate: null,
      monitored: true,
      coreOts: 0,
      ...over,
    },
  };
}

function fakeDb(
  stateDocs: Array<{ id: string; data: Partial<CameraHealthAlertStateDoc> }>,
): Firestore {
  const emptyQuery = {
    where: () => emptyQuery,
    limit: () => emptyQuery,
    get: async () => ({ docs: [] as unknown[] }),
  };
  return {
    collection: (name: string) => {
      if (name === 'states') {
        return {
          get: async () => ({
            docs: stateDocs.map((doc) => ({
              id: doc.id,
              data: () => doc.data,
            })),
          }),
        };
      }
      return emptyQuery;
    },
    getAll: async () => [],
  } as unknown as Firestore;
}

describe('buildCameraHealthOverview · cameraPairGaps', () => {
  it('reporta un par con brecha mayor al umbral', async () => {
    const overview = await buildCameraHealthOverview(
      fakeDb([
        stateDoc('1', { locationName: 'COAPA DERECHO', coreOts: 7_929 }),
        stateDoc('2', { locationName: 'COAPA IZQUIERDO', coreOts: 28_068 }),
      ]),
      'states',
      'alerts',
    );

    expect(overview.cameraPairGaps).toEqual([
      expect.objectContaining({
        storeNumber: '12',
        storeName: 'COAPA',
        support: 'MUPI DIGITAL',
        gap: 20_139,
      }),
    ]);
  });

  it('no reporta nada si la brecha está dentro del umbral', async () => {
    const overview = await buildCameraHealthOverview(
      fakeDb([
        stateDoc('1', { coreOts: 1_000 }),
        stateDoc('2', { coreOts: 1_800 }),
      ]),
      'states',
      'alerts',
    );

    expect(overview.cameraPairGaps).toEqual([]);
  });

  it('ignora Insurgentes y Banner Digital: su brecha es esperada', async () => {
    const overview = await buildCameraHealthOverview(
      fakeDb([
        stateDoc('1', {
          storeName: 'LIVERPOOL INSURGENTES',
          coreOts: 1_000,
        }),
        stateDoc('2', {
          storeName: 'LIVERPOOL INSURGENTES',
          coreOts: 50_000,
        }),
        stateDoc('3', { support: 'BANNER DIGITAL', coreOts: 1_000 }),
        stateDoc('4', { support: 'BANNER DIGITAL', coreOts: 50_000 }),
      ]),
      'states',
      'alerts',
    );

    expect(overview.cameraPairGaps).toEqual([]);
  });

  it('ignora cámaras fuera de alcance (monitored: false)', async () => {
    const overview = await buildCameraHealthOverview(
      fakeDb([
        stateDoc('1', { coreOts: 1_000, monitored: false }),
        stateDoc('2', { coreOts: 50_000 }),
      ]),
      'states',
      'alerts',
    );

    expect(overview.cameraPairGaps).toEqual([]);
  });
});
