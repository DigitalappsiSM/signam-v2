import { describe, expect, it } from 'vitest';
import type { AdmiraScreen } from '@/domain/models';
import {
  buildStoreOptions,
  filterStoreOptions,
  normalizeStoreNumber,
  resolveStoreOption,
} from './storeOptions';

function screen(
  storeNumber: string,
  storeName: string,
  calendarSupport: string,
  camera: { id?: number | null; id2?: number | null } = { id: 1 },
): AdmiraScreen {
  return {
    id: `${storeNumber}-${calendarSupport}-${storeName}`,
    original: {
      'Numero de Tienda': storeNumber,
      'Nombre de tienda': storeName,
    } as AdmiraScreen['original'],
    metadata: {
      calendarSupport,
      quividiLocationId: camera.id ?? null,
      quividiLocationId2: camera.id2 ?? null,
    } as AdmiraScreen['metadata'],
  };
}

const SCREENS = [
  screen('5', 'LIVERPOOL INSURGENTES', 'BANNER DIGITAL'),
  screen('5', 'LIVERPOOL INSURGENTES', 'MEGA MUPI DIGITAL'),
  screen('199', 'LIVERPOOL POLANCO', 'MUPI DIGITAL'),
  screen('78', 'LIVERPOOL GALERÍAS GUADALAJARA', 'MUPI DIGITAL', {
    id: null,
    id2: 9,
  }),
  screen('42', 'LIVERPOOL SIN CÁMARA', 'MUPI DIGITAL', { id: null }),
  screen('7', 'LIVERPOOL VIDEO WALL', 'VIDEO WALL CRIUS'),
];

describe('normalizeStoreNumber', () => {
  it('rellena a 3 dígitos como el backend', () => {
    expect(normalizeStoreNumber('5')).toBe('005');
    expect(normalizeStoreNumber(' 0199 ')).toBe('199');
    expect(normalizeStoreNumber('Polanco')).toBeNull();
  });
});

describe('buildStoreOptions', () => {
  it('MUPI DIGITAL incluye el MEGA MUPI DIGITAL del catálogo y conserva su nombre literal', () => {
    const insurgentes = buildStoreOptions(SCREENS, 'MUPI DIGITAL').find(
      (option) => option.storeNumber === '005',
    );
    expect(insurgentes?.support).toBe('MEGA MUPI DIGITAL');
  });

  it('sólo tiendas del soporte con alguna cámara Quividi, una por número', () => {
    expect(buildStoreOptions(SCREENS, 'MUPI DIGITAL')).toEqual([
      {
        storeNumber: '078',
        storeName: 'LIVERPOOL GALERÍAS GUADALAJARA',
        support: 'MUPI DIGITAL',
        label: 'LIVERPOOL GALERÍAS GUADALAJARA (078)',
      },
      {
        storeNumber: '005',
        storeName: 'LIVERPOOL INSURGENTES',
        support: 'MEGA MUPI DIGITAL',
        label: 'LIVERPOOL INSURGENTES (005)',
      },
      {
        storeNumber: '199',
        storeName: 'LIVERPOOL POLANCO',
        support: 'MUPI DIGITAL',
        label: 'LIVERPOOL POLANCO (199)',
      },
    ]);
    expect(
      buildStoreOptions(SCREENS, 'BANNER DIGITAL').map((o) => o.storeNumber),
    ).toEqual(['005']);
  });
});

describe('filterStoreOptions', () => {
  const options = buildStoreOptions(SCREENS, 'MUPI DIGITAL');

  it('busca por nombre sin acentos ni mayúsculas, palabras en cualquier orden', () => {
    expect(
      filterStoreOptions(options, 'guadalajara galerias').map(
        (o) => o.storeNumber,
      ),
    ).toEqual(['078']);
    expect(
      filterStoreOptions(options, 'pola').map((o) => o.storeNumber),
    ).toEqual(['199']);
  });

  it('busca por número aunque se teclee sin ceros', () => {
    expect(filterStoreOptions(options, '5').map((o) => o.storeNumber)).toEqual([
      '005',
    ]);
  });
});

describe('resolveStoreOption', () => {
  const options = buildStoreOptions(SCREENS, 'MUPI DIGITAL');

  it('resuelve número exacto, etiqueta o coincidencia única', () => {
    expect(resolveStoreOption(options, '199')?.storeNumber).toBe('199');
    expect(
      resolveStoreOption(options, 'LIVERPOOL INSURGENTES (005)')?.storeNumber,
    ).toBe('005');
    expect(resolveStoreOption(options, 'polanco')?.storeNumber).toBe('199');
  });

  it('devuelve null si es ambiguo o no existe', () => {
    expect(resolveStoreOption(options, 'liverpool')).toBeNull();
    expect(resolveStoreOption(options, 'monterrey')).toBeNull();
    expect(resolveStoreOption(options, '')).toBeNull();
  });
});
