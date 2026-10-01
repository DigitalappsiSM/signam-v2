import { describe, expect, it } from 'vitest';
import type { StoreDirectoryEntry } from '@/domain/stores';
import {
  EMPTY_DIRECTORY_FILTERS,
  filterDirectory,
  locationLabel,
  mapsUrl,
  summarizeDirectory,
} from './directoryView';

const entry = (over: Partial<StoreDirectoryEntry>): StoreDirectoryEntry => ({
  storeNumber: '901',
  name: 'L PRUEBA NORTE',
  status: 'active',
  street: 'AV. UNO',
  neighborhood: 'CENTRO',
  municipality: 'MONTERREY',
  state: 'Nuevo León',
  zone: 'Noreste',
  postalCode: '64000',
  lat: 25.67,
  lng: -100.3,
  coordinateSource: 'ekon',
  ...over,
});

const ENTRIES = [
  entry({}),
  entry({
    storeNumber: '902',
    name: 'L PRUEBA QUERÉTARO',
    state: 'Querétaro',
    zone: 'Centro',
    municipality: 'QUERÉTARO',
    postalCode: '76000',
    lat: null,
    lng: null,
    coordinateSource: null,
  }),
  entry({
    storeNumber: '903',
    name: 'L CERRADA',
    status: 'inactive',
    postalCode: null,
    lat: null,
    lng: null,
    coordinateSource: null,
  }),
];

describe('filtros del directorio', () => {
  it('busca sin acentos por nombre, municipio, número o CP', () => {
    const f = (search: string) =>
      filterDirectory(ENTRIES, { ...EMPTY_DIRECTORY_FILTERS, search }).map(
        (e) => e.storeNumber,
      );
    expect(f('queretaro')).toEqual(['902']);
    expect(f('64000')).toEqual(['901']);
    expect(f('903')).toEqual(['903']);
  });

  it('filtra por estatus, estado, zona y ubicación', () => {
    const f = (over: Partial<typeof EMPTY_DIRECTORY_FILTERS>) =>
      filterDirectory(ENTRIES, { ...EMPTY_DIRECTORY_FILTERS, ...over }).map(
        (e) => e.storeNumber,
      );
    expect(f({ status: 'inactive' })).toEqual(['903']);
    expect(f({ state: 'Querétaro' })).toEqual(['902']);
    expect(f({ zone: 'Noreste' })).toEqual(['901', '903']);
    expect(f({ location: 'gps' })).toEqual(['901']);
    expect(f({ location: 'no-gps' })).toEqual(['902', '903']);
    expect(f({ location: 'no-postal' })).toEqual(['903']);
  });
});

describe('resumen', () => {
  it('cuenta faltantes solo entre tiendas activas', () => {
    expect(summarizeDirectory(ENTRIES)).toEqual({
      total: 3,
      active: 2,
      withGps: 1,
      withoutGps: 1,
      withoutPostalCode: 0,
      states: 2,
    });
  });

  it('etiqueta la fuente y arma el enlace de verificación', () => {
    expect(locationLabel(ENTRIES[0]!)).toBe('GPS Ekon');
    expect(locationLabel(entry({ coordinateSource: 'manual' }))).toBe(
      'GPS manual',
    );
    expect(locationLabel(ENTRIES[1]!)).toBe('Sin coordenadas');
    expect(mapsUrl(ENTRIES[0]!)).toBe(
      'https://www.google.com/maps/search/?api=1&query=25.67,-100.3',
    );
    expect(mapsUrl(ENTRIES[1]!)).toBeNull();
  });
});
