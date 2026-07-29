import { describe, it, expect } from 'vitest';
import { filterScreens, uniqueValues, EMPTY_FILTERS } from './screenFilter';
import { emptyOriginal, newScreenMetadata } from './screenFactory';
import type { AdmiraScreen } from '@/domain';

function screen(
  id: string,
  original: Partial<AdmiraScreen['original']>,
  active = true,
): AdmiraScreen {
  const meta = newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0);
  return {
    id,
    original: { ...emptyOriginal(), ...original },
    metadata: { ...meta, active },
  };
}

const screens: AdmiraScreen[] = [
  screen('1', {
    'Numero de Tienda': '78',
    'Nombre de tienda': 'L GUADALAJARA GALERIAS',
    Modelo: 'CRIUS',
    RESOLUCION: '914 x 908',
  }),
  screen(
    '2',
    {
      'Numero de Tienda': '10',
      'Nombre de tienda': 'L PERISUR',
      Modelo: 'CUADRADA',
      RESOLUCION: '900 X 900',
    },
    false,
  ),
  screen('3', {
    'Numero de Tienda': '78',
    'Nombre de tienda': 'L GUADALAJARA GALERIAS',
    Modelo: 'CUADRADA',
    RESOLUCION: '900 X 900',
  }),
];

describe('filterScreens', () => {
  it('sin filtros devuelve todas', () => {
    expect(filterScreens(screens, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('filtra por estado activo/inactivo', () => {
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, status: 'active' }),
    ).toHaveLength(2);
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, status: 'inactive' }),
    ).toEqual([expect.objectContaining({ id: '2' })]);
  });

  it('filtra por tienda, modelo y resolución exactos', () => {
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, store: '78' }),
    ).toHaveLength(2);
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, model: 'CRIUS' }),
    ).toEqual([expect.objectContaining({ id: '1' })]);
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, resolution: '900 X 900' }),
    ).toHaveLength(2);
  });

  it('busca texto sin distinguir acentos ni mayúsculas', () => {
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, search: 'guadalajara' }),
    ).toHaveLength(2);
    expect(
      filterScreens(screens, { ...EMPTY_FILTERS, search: 'PERISUR' }),
    ).toEqual([expect.objectContaining({ id: '2' })]);
  });

  it('combina búsqueda con estado', () => {
    expect(
      filterScreens(screens, {
        ...EMPTY_FILTERS,
        search: 'galerias',
        status: 'active',
      }),
    ).toHaveLength(2);
  });
});

describe('uniqueValues', () => {
  it('devuelve valores únicos ordenados', () => {
    expect(uniqueValues(screens, 'Modelo')).toEqual(['CRIUS', 'CUADRADA']);
    expect(uniqueValues(screens, 'Numero de Tienda')).toEqual(['10', '78']);
  });
});
