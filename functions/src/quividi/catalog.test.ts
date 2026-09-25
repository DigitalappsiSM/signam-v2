import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { ScreenDoc } from './effectiveScope';
import type { TopologyLocation } from './measurement';
import { syncCatalogLocationBindings, topologyLocationName } from './catalog';

function topology(id: number, name: string): TopologyLocation {
  return {
    id,
    name,
    active: true,
    box_id: id * 10,
    site_id: 1,
    last_seen: '2026-09-18T21:00:00',
  };
}

function screen(
  id: string,
  metadata: {
    quividiLocationId?: number | null;
    quividiCameraName?: string;
    quividiLocationId2?: number | null;
    quividiCameraName2?: string;
    measurementPointCode?: string;
    measurementPointId?: string;
    measurementPointCode2?: string;
    measurementPointId2?: string;
  },
): ScreenDoc {
  return {
    id,
    original: { 'Numero de Tienda': '7', 'Nombre de tienda': 'Toreo' },
    metadata: {
      active: true,
      calendarSupport: 'VIDEO WALL CRIUS',
      ...((metadata.quividiLocationId || metadata.quividiCameraName) &&
        metadata.measurementPointCode === undefined && {
          measurementPointCode: 'P1',
          measurementPointId: 'LIV-007-CRIUS-P1',
        }),
      ...((metadata.quividiLocationId2 || metadata.quividiCameraName2) &&
        metadata.measurementPointCode2 === undefined && {
          measurementPointCode2: 'P2',
          measurementPointId2: 'LIV-007-CRIUS-P2',
        }),
      ...metadata,
    },
  };
}

function fakeDb(): {
  db: Firestore;
  batchUpdates: Array<Record<string, unknown>>;
} {
  const batchUpdates: Array<Record<string, unknown>> = [];
  const db = {
    collection: (name: string) => ({
      doc: (docId: string) => ({ id: docId, __collection: name }),
    }),
    batch: () => ({
      update: (ref: { id: string }, data: Record<string, unknown>) => {
        batchUpdates.push({ id: ref.id, ...data });
      },
      commit: async () => {},
    }),
  };
  return { db: db as unknown as Firestore, batchUpdates };
}

describe('syncCatalogLocationBindings', () => {
  it('rellena el Location ID de la cámara principal cuando el alias coincide con una sola location', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [screen('s1', { quividiCameraName: 'ALIAS UNICO' })],
      [topology(25, 'ALIAS UNICO')],
    );

    expect(result.updated).toBe(1);
    expect(result.screens[0]?.metadata?.quividiLocationId).toBe(25);
    expect(batchUpdates).toEqual([
      {
        id: 's1',
        'metadata.quividiLocationId': 25,
        'metadata.quividiCameraName': 'ALIAS UNICO',
      },
    ]);
  });

  it('rellena el Location ID de la segunda cámara importada solo con alias (maestro)', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [
        screen('s1', {
          quividiLocationId: 201,
          quividiCameraName: 'TOREO-1',
          quividiCameraName2: 'TOREO-2',
        }),
      ],
      [topology(201, 'TOREO-1'), topology(202, 'TOREO-2')],
    );

    expect(result.updated).toBe(1);
    expect(result.screens[0]?.metadata?.quividiLocationId2).toBe(202);
    expect(result.screens[0]?.metadata?.quividiCameraName2).toBe('TOREO-2');
    expect(batchUpdates).toEqual([
      {
        id: 's1',
        'metadata.quividiLocationId2': 202,
        'metadata.quividiCameraName2': 'TOREO-2',
      },
    ]);
  });

  it('sincroniza el alias de ambas cámaras cuando cambiaron en Quividi', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [
        screen('s1', {
          quividiLocationId: 201,
          quividiCameraName: 'ALIAS VIEJO 1',
          quividiLocationId2: 202,
          quividiCameraName2: 'ALIAS VIEJO 2',
        }),
      ],
      [topology(201, 'ALIAS NUEVO 1'), topology(202, 'ALIAS NUEVO 2')],
    );

    expect(result.screens[0]?.metadata?.quividiCameraName).toBe(
      'ALIAS NUEVO 1',
    );
    expect(result.screens[0]?.metadata?.quividiCameraName2).toBe(
      'ALIAS NUEVO 2',
    );
    expect(batchUpdates).toEqual([
      {
        id: 's1',
        'metadata.quividiLocationId': 201,
        'metadata.quividiCameraName': 'ALIAS NUEVO 1',
        'metadata.quividiLocationId2': 202,
        'metadata.quividiCameraName2': 'ALIAS NUEVO 2',
      },
    ]);
  });

  it('no toca la segunda cámara si su alias no coincide con ninguna location', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [
        screen('s1', {
          quividiLocationId: 201,
          quividiCameraName: 'TOREO-1',
          quividiCameraName2: 'ALIAS INEXISTENTE',
        }),
      ],
      [topology(201, 'TOREO-1')],
    );

    expect(result.updated).toBe(0);
    expect(result.screens[0]?.metadata?.quividiLocationId2).toBeUndefined();
    expect(batchUpdates).toEqual([]);
  });

  it('no adivina cuando el alias de la segunda cámara coincide con más de una location', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [screen('s1', { quividiCameraName2: 'ALIAS DUPLICADO' })],
      [topology(1, 'ALIAS DUPLICADO'), topology(2, 'ALIAS DUPLICADO')],
    );

    expect(result.updated).toBe(0);
    expect(batchUpdates).toEqual([]);
  });

  it('migra puntos SIGNAM legacy de forma determinística por Location ID', async () => {
    const { db, batchUpdates } = fakeDb();
    const legacy = screen('s1', {
      quividiLocationId: 202,
      quividiCameraName: 'TOREO-2',
      quividiLocationId2: 201,
      quividiCameraName2: 'TOREO-1',
      measurementPointCode: '',
      measurementPointId: '',
      measurementPointCode2: '',
      measurementPointId2: '',
    });

    const result = await syncCatalogLocationBindings(
      db,
      [legacy],
      [topology(201, 'TOREO-1'), topology(202, 'TOREO-2')],
    );

    expect(result.updated).toBe(1);
    expect(result.screens[0]?.metadata?.measurementPointCode2).toBe('P1');
    expect(result.screens[0]?.metadata?.measurementPointId2).toBe(
      'LIV-007-CRIUS-P1',
    );
    expect(result.screens[0]?.metadata?.measurementPointCode).toBe('P2');
    expect(result.screens[0]?.metadata?.measurementPointId).toBe(
      'LIV-007-CRIUS-P2',
    );
    expect(batchUpdates).toEqual([
      {
        id: 's1',
        'metadata.measurementPointCode2': 'P1',
        'metadata.measurementPointId2': 'LIV-007-CRIUS-P1',
        'metadata.measurementPointCode': 'P2',
        'metadata.measurementPointId': 'LIV-007-CRIUS-P2',
      },
    ]);
  });

  it('respeta puntos existentes y asigna el siguiente P disponible', async () => {
    const { db } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [
        screen('s1', {
          quividiLocationId: 201,
          quividiCameraName: 'TOREO-1',
          measurementPointCode: 'P3',
          measurementPointId: 'LIV-007-CRIUS-P3',
          quividiLocationId2: 202,
          quividiCameraName2: 'TOREO-2',
          measurementPointCode2: '',
          measurementPointId2: '',
        }),
      ],
      [topology(201, 'TOREO-1'), topology(202, 'TOREO-2')],
    );

    expect(result.screens[0]?.metadata?.measurementPointCode).toBe('P3');
    expect(result.screens[0]?.metadata?.measurementPointCode2).toBe('P1');
  });

  it('agrupa 7 y 007 como la misma tienda antes de numerar puntos', async () => {
    const { db } = fakeDb();
    const first = screen('s1', {
      quividiLocationId: 201,
      quividiCameraName: 'TOREO-1',
      measurementPointCode: '',
      measurementPointId: '',
    });
    const second = screen('s2', {
      quividiLocationId: 202,
      quividiCameraName: 'TOREO-2',
      measurementPointCode: '',
      measurementPointId: '',
    });
    second.original = {
      'Numero de Tienda': '007',
      'Nombre de tienda': 'Toreo',
    };

    const result = await syncCatalogLocationBindings(
      db,
      [first, second],
      [topology(201, 'TOREO-1'), topology(202, 'TOREO-2')],
    );

    expect(result.screens[0]?.metadata?.measurementPointId).toBe(
      'LIV-007-CRIUS-P1',
    );
    expect(result.screens[1]?.metadata?.measurementPointId).toBe(
      'LIV-007-CRIUS-P2',
    );
  });

  it('no adivina puntos si un Location ID está duplicado en tienda+soporte', async () => {
    const { db, batchUpdates } = fakeDb();
    const first = screen('s1', {
      quividiLocationId: 201,
      quividiCameraName: 'TOREO-1',
      measurementPointCode: '',
      measurementPointId: '',
    });
    const second = screen('s2', {
      quividiLocationId: 201,
      quividiCameraName: 'TOREO-1',
      measurementPointCode: '',
      measurementPointId: '',
    });

    const result = await syncCatalogLocationBindings(
      db,
      [first, second],
      [topology(201, 'TOREO-1')],
    );

    expect(result.updated).toBe(0);
    expect(result.screens[0]?.metadata?.measurementPointId).toBe('');
    expect(result.screens[1]?.metadata?.measurementPointId).toBe('');
    expect(batchUpdates).toEqual([]);
  });

  it('no genera actualizaciones cuando ambos slots ya están al día', async () => {
    const { db, batchUpdates } = fakeDb();
    const result = await syncCatalogLocationBindings(
      db,
      [
        screen('s1', {
          quividiLocationId: 201,
          quividiCameraName: 'TOREO-1',
          quividiLocationId2: 202,
          quividiCameraName2: 'TOREO-2',
        }),
      ],
      [topology(201, 'TOREO-1'), topology(202, 'TOREO-2')],
    );

    expect(result.updated).toBe(0);
    expect(batchUpdates).toEqual([]);
  });
});

describe('topologyLocationName', () => {
  it('usa label como fallback cuando falta name', () => {
    expect(
      topologyLocationName({
        id: 1,
        label: 'FALLBACK',
        active: true,
        box_id: 1,
        site_id: 1,
        last_seen: null,
      }),
    ).toBe('FALLBACK');
  });
});
