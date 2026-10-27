/**
 * Identidad visual de cada retailer en el análisis de incidencias. Solo
 * Liverpool tiene logotipo autorizado en el repositorio; los demás muestran un
 * monograma en su color de marca hasta contar con su logo oficial.
 *
 * Los colores son aproximados a cada marca; ajustarlos aquí con el manual de
 * identidad del cliente. «Todos» usa el azul de in-Store Media.
 */
export interface RetailerBrand {
  /** Valor del filtro ('' = todos). */
  value: string;
  label: string;
  color: string;
  monogram?: string;
}

export const ALL_RETAILERS_COLOR = '#1d4ed8';

export const RETAILER_BRANDS: RetailerBrand[] = [
  { value: '', label: 'Todos', color: ALL_RETAILERS_COLOR },
  { value: 'Liverpool', label: 'Liverpool', color: '#e10098' },
  { value: 'Chedraui', label: 'Chedraui', color: '#0055a5', monogram: 'CH' },
  { value: 'La Comer', label: 'La Comer', color: '#e8701a', monogram: 'LC' },
  {
    value: 'Farmacias San Pablo',
    label: 'Farmacias San Pablo',
    color: '#0a8a4a',
    monogram: 'SP',
  },
];

export const retailerColor = (value: string) =>
  RETAILER_BRANDS.find((brand) => brand.value === value)?.color ??
  ALL_RETAILERS_COLOR;
