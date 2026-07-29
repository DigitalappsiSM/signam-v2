import { describe, it, expect } from 'vitest';
import {
  buildAdmiraCampaignName,
  dedupeArticulos,
  joinArticulos,
} from './campaignName';

describe('dedupeArticulos', () => {
  it('conserva el orden de aparición', () => {
    expect(dedupeArticulos(['B', 'A', 'C'])).toEqual(['B', 'A', 'C']);
  });

  it('elimina duplicados exactos conservando la primera aparición', () => {
    expect(dedupeArticulos(['A', 'B', 'A', 'C', 'B'])).toEqual(['A', 'B', 'C']);
  });

  it('ignora valores vacíos y recorta espacios', () => {
    expect(dedupeArticulos(['  A  ', '', '   ', 'A'])).toEqual(['A']);
  });

  it('distingue mayúsculas/minúsculas (texto literal)', () => {
    expect(dedupeArticulos(['Nike', 'nike'])).toEqual(['Nike', 'nike']);
  });
});

describe('joinArticulos', () => {
  it('concatena con " + "', () => {
    expect(joinArticulos(['ARTICULO 1', 'ARTICULO 2'])).toBe(
      'ARTICULO 1 + ARTICULO 2',
    );
  });

  it('deduplica antes de concatenar', () => {
    expect(joinArticulos(['VW 914x908', 'VW 914x908'])).toBe('VW 914x908');
  });
});

describe('buildAdmiraCampaignName', () => {
  it('usa el formato "<Campaña>_ <ARTICULOS>" con un solo artículo', () => {
    expect(buildAdmiraCampaignName('Nike Verano', ['VW 914x908'])).toBe(
      'Nike Verano_ VW 914x908',
    );
  });

  it('concatena varios artículos distintos con " + "', () => {
    expect(
      buildAdmiraCampaignName('Nike Verano', ['ARTICULO 1', 'ARTICULO 2']),
    ).toBe('Nike Verano_ ARTICULO 1 + ARTICULO 2');
  });

  it('elimina artículos duplicados manteniendo el orden', () => {
    expect(
      buildAdmiraCampaignName('Nike Verano', ['VW 900x900', 'VW 900x900']),
    ).toBe('Nike Verano_ VW 900x900');
  });

  it('recorta el nombre de la campaña', () => {
    expect(buildAdmiraCampaignName('  Nike Verano  ', ['X'])).toBe(
      'Nike Verano_ X',
    );
  });
});
