import { describe, expect, it } from 'vitest';
import {
  combineCameraAverageSeconds,
  combineCameraValues,
  detectCameraPairGaps,
  isSingleScreenPair,
  isZoneSplitPair,
  publishedFactor,
  publishedValue,
  type CameraPairGapInput,
} from './cameraCombination';

describe('isZoneSplitPair', () => {
  it('reconoce el Mupi de Insurgentes sin importar prefijo, mayúsculas o acentos', () => {
    expect(
      isZoneSplitPair({
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'MUPI DIGITAL',
      }),
    ).toBe(true);
    expect(
      isZoneSplitPair({ storeName: 'insurgentes', support: 'MUPI DIGITAL' }),
    ).toBe(true);
    expect(
      isZoneSplitPair({
        storeName: 'INSURGENTES',
        support: 'MEGA MUPI DIGITAL',
      }),
    ).toBe(true);
  });

  it('en Insurgentes sólo el Mupi es zona partida (octubre 2026)', () => {
    expect(
      isZoneSplitPair({
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'APARADOR INSURGENTES',
      }),
    ).toBe(false);
    expect(
      isZoneSplitPair({
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'BANNER DIGITAL',
      }),
    ).toBe(true);
  });

  it('reconoce cualquier soporte BANNER DIGITAL, sin importar la tienda', () => {
    expect(
      isZoneSplitPair({ storeName: 'MITIKAH', support: 'BANNER DIGITAL' }),
    ).toBe(true);
    expect(
      isZoneSplitPair({ storeName: 'TOREO', support: 'banner digital' }),
    ).toBe(true);
  });

  it('no marca un soporte ni tienda distintos', () => {
    expect(
      isZoneSplitPair({ storeName: 'SANTA FE', support: 'MUPI DIGITAL' }),
    ).toBe(false);
    expect(
      isZoneSplitPair({ storeName: 'COAPA', support: 'MUPI DIGITAL' }),
    ).toBe(false);
  });
});

describe('combineCameraAverageSeconds', () => {
  it('sin watchers devuelve 0', () => {
    expect(combineCameraAverageSeconds([], false)).toBe(0);
    expect(
      combineCameraAverageSeconds([{ watchers: 0, tenths: 90 }], false),
    ).toBe(0);
  });

  it('fuera de zona partida usa sólo la cámara con más watchers', () => {
    expect(
      combineCameraAverageSeconds(
        [
          { watchers: 30, tenths: 400 },
          { watchers: 50, tenths: 500 },
        ],
        false,
      ),
    ).toBeCloseTo(1);
  });

  it('en zona partida pondera todas las cámaras', () => {
    expect(
      combineCameraAverageSeconds(
        [
          { watchers: 30, tenths: 400 },
          { watchers: 50, tenths: 500 },
        ],
        true,
      ),
    ).toBeCloseTo(900 / 80 / 10);
  });
});

describe('combineCameraValues', () => {
  it('sin lecturas, devuelve 0', () => {
    expect(combineCameraValues([], false)).toBe(0);
    expect(combineCameraValues([], true)).toBe(0);
  });

  it('una sola lectura: la devuelve tal cual, sea zona partida o no', () => {
    expect(combineCameraValues([500], false)).toBe(500);
    expect(combineCameraValues([500], true)).toBe(500);
  });

  it('zona partida: siempre suma, aunque la brecha sea pequeña', () => {
    expect(combineCameraValues([100, 150], true)).toBe(250);
  });

  it('fuera de zona partida usa siempre la lectura más alta, sin promediar', () => {
    expect(combineCameraValues([1000, 1900], false)).toBe(1900);
    // Caso real reportado: Coapa, 2 cámaras del mismo circuito con 28,068 vs
    // 7,929 OTS.
    expect(combineCameraValues([28_068, 7_929], false)).toBe(28_068);
    expect(combineCameraValues([100, 150, 200], false)).toBe(200);
  });
});

function camera(over: Partial<CameraPairGapInput> = {}): CameraPairGapInput {
  return {
    locationId: 1,
    locationName: 'CAM-1',
    storeNumber: '12',
    storeName: 'COAPA',
    support: 'MUPI DIGITAL',
    ots: 1000,
    monitored: true,
    ...over,
  };
}

describe('detectCameraPairGaps', () => {
  it('reporta un par con brecha mayor al umbral', () => {
    const gaps = detectCameraPairGaps([
      camera({ locationId: 1, locationName: 'COAPA DERECHO', ots: 7_929 }),
      camera({ locationId: 2, locationName: 'COAPA IZQUIERDO', ots: 28_068 }),
    ]);

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      storeNumber: '12',
      storeName: 'COAPA',
      support: 'MUPI DIGITAL',
      gap: 20_139,
    });
    // Ordenadas de mayor a menor OTS.
    expect(gaps[0]?.cameras.map((c) => c.locationName)).toEqual([
      'COAPA IZQUIERDO',
      'COAPA DERECHO',
    ]);
  });

  it('no reporta nada si la brecha está dentro del umbral', () => {
    const gaps = detectCameraPairGaps([
      camera({ locationId: 1, ots: 1000 }),
      camera({ locationId: 2, ots: 1800 }),
    ]);

    expect(gaps).toEqual([]);
  });

  it('ignora pares de zona partida (Mupi de Insurgentes, Banner Digital): su brecha es esperada', () => {
    const gaps = detectCameraPairGaps([
      camera({
        locationId: 1,
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'MEGA MUPI DIGITAL',
        ots: 1_000,
      }),
      camera({
        locationId: 2,
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'MEGA MUPI DIGITAL',
        ots: 50_000,
      }),
      camera({
        locationId: 3,
        storeName: 'MITIKAH',
        support: 'BANNER DIGITAL',
        ots: 1_000,
      }),
      camera({
        locationId: 4,
        storeName: 'MITIKAH',
        support: 'BANNER DIGITAL',
        ots: 50_000,
      }),
    ]);

    expect(gaps).toEqual([]);
  });

  it('ignora cámaras no monitoreadas y pares con una sola cámara', () => {
    const gaps = detectCameraPairGaps([
      camera({ locationId: 1, ots: 1_000, monitored: false }),
      camera({ locationId: 2, ots: 50_000 }),
    ]);

    expect(gaps).toEqual([]);
  });

  it('ordena varios pares con brecha de mayor a menor', () => {
    const gaps = detectCameraPairGaps([
      camera({ locationId: 1, storeNumber: '1', ots: 1_000 }),
      camera({ locationId: 2, storeNumber: '1', ots: 3_000 }),
      camera({ locationId: 3, storeNumber: '2', ots: 1_000 }),
      camera({ locationId: 4, storeNumber: '2', ots: 20_000 }),
    ]);

    expect(gaps.map((g) => g.storeNumber)).toEqual(['2', '1']);
  });
});

describe('publishedValue', () => {
  it('duplica cuando el circuito tiene exactamente 1 cámara configurada', () => {
    expect(publishedValue(1000, 1)).toBe(2000);
  });

  it('no duplica un circuito sin cámara', () => {
    expect(publishedValue(0, 0)).toBe(0);
  });

  it('duplica la lectura más alta de un circuito de 2 cámaras', () => {
    expect(publishedValue(1000, 2)).toBe(2000);
    expect(publishedValue(1000, 2, false)).toBe(2000);
  });

  it('no duplica la zona partida de 2 cámaras: ya suma las dos audiencias', () => {
    expect(publishedValue(1000, 2, true)).toBe(1000);
  });

  it('no duplica un circuito de 3+ cámaras', () => {
    expect(publishedValue(1000, 3)).toBe(1000);
  });
});

describe('Mupi de Polanco · pantalla única', () => {
  it('reconoce sólo el Mupi de Polanco', () => {
    expect(
      isSingleScreenPair({
        storeName: 'LIVERPOOL POLANCO',
        support: 'MEGA MUPI DIGITAL',
      }),
    ).toBe(true);
    expect(
      isSingleScreenPair({
        storeName: 'LIVERPOOL POLANCO',
        support: 'BANNER DIGITAL',
      }),
    ).toBe(false);
    expect(
      isSingleScreenPair({ storeName: 'COAPA', support: 'MEGA MUPI DIGITAL' }),
    ).toBe(false);
  });

  it('publica su lectura tal cual, sin duplicar, con 1 o 2 cámaras', () => {
    expect(publishedValue(1000, 1, false, true)).toBe(1000);
    expect(publishedValue(1000, 2, false, true)).toBe(1000);
    expect(publishedFactor(1, false, true)).toBe(1);
    expect(publishedFactor(1, false)).toBe(2);
    expect(publishedFactor(2, true)).toBe(1);
  });
});
