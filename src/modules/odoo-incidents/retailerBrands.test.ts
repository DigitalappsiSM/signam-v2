import { describe, expect, it } from 'vitest';
import {
  ALL_RETAILERS_COLOR,
  RETAILER_BRANDS,
  retailerColor,
} from './retailerBrands';

describe('identidad de retailers', () => {
  it('cubre «Todos» y los cuatro equipos de Odoo', () => {
    expect(RETAILER_BRANDS.map((brand) => brand.value)).toEqual([
      '',
      'Liverpool',
      'Chedraui',
      'La Comer',
      'Farmacias San Pablo',
    ]);
  });
  it('usa el azul de in-Store Media sin retailer o con uno desconocido', () => {
    expect(retailerColor('')).toBe(ALL_RETAILERS_COLOR);
    expect(retailerColor('Otro')).toBe(ALL_RETAILERS_COLOR);
    expect(retailerColor('Liverpool')).toBe('#e10098');
  });
});
