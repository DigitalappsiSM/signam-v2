/**
 * Identidad visual de cada retailer en el análisis de incidencias. Los colores
 * se tomaron de los logotipos entregados por el negocio (Chedraui naranja,
 * La Comer verde, San Pablo azul); «Todos» usa el azul de in-Store Media.
 */
export interface RetailerBrand {
  /** Valor del filtro ('' = todos). */
  value: string;
  label: string;
  color: string;
}

export const ALL_RETAILERS_COLOR = '#1d4ed8';

export const RETAILER_BRANDS: RetailerBrand[] = [
  { value: '', label: 'Todos', color: ALL_RETAILERS_COLOR },
  { value: 'Liverpool', label: 'Liverpool', color: '#e10098' },
  { value: 'Chedraui', label: 'Chedraui', color: '#f57c00' },
  { value: 'La Comer', label: 'La Comer', color: '#81c01b' },
  {
    value: 'Farmacias San Pablo',
    label: 'Farmacias San Pablo',
    color: '#2971be',
  },
];

export const retailerColor = (value: string) =>
  RETAILER_BRANDS.find((brand) => brand.value === value)?.color ??
  ALL_RETAILERS_COLOR;
