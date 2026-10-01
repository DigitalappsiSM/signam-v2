import { describe, expect, it } from 'vitest';
import type { StoreDirectoryEntry } from '@/domain/stores';
import { entryFromForm, formValuesFrom } from './entryForm';

const STORED: StoreDirectoryEntry = {
  storeNumber: '902',
  name: 'L PRUEBA CDMX',
  status: 'active',
  street: 'CALLE DOS',
  neighborhood: 'DEL VALLE',
  municipality: 'BENITO JUÁREZ',
  state: 'Ciudad de México',
  zone: 'Metropolitana',
  postalCode: '03100',
  lat: 19.37,
  lng: -99.17,
  coordinateSource: 'ekon',
};

describe('formulario de tienda', () => {
  it('sin cambios conserva la fuente de coordenadas', () => {
    const r = entryFromForm(formValuesFrom(STORED), STORED, new Set(['902']));
    expect(r).toMatchObject({ ok: true, entry: STORED, warnings: [] });
  });

  it('mover las coordenadas las marca como captura manual', () => {
    const r = entryFromForm(
      { ...formValuesFrom(STORED), lat: '19.38' },
      STORED,
      new Set(),
    );
    expect(r.ok && r.entry.coordinateSource).toBe('manual');
  });

  it('borrar las coordenadas deja la tienda sin fuente', () => {
    const r = entryFromForm(
      { ...formValuesFrom(STORED), lat: '', lng: '' },
      STORED,
      new Set(),
    );
    expect(r.ok && r.entry).toMatchObject({
      lat: null,
      lng: null,
      coordinateSource: null,
    });
  });

  it('corrige el CP de 4 dígitos y advierte si no es del estado', () => {
    const ok = entryFromForm(
      { ...formValuesFrom(STORED), postalCode: '3100' },
      STORED,
      new Set(),
    );
    expect(ok.ok && ok.entry.postalCode).toBe('03100');
    const warn = entryFromForm(
      { ...formValuesFrom(STORED), postalCode: '64000' },
      STORED,
      new Set(),
    );
    expect(warn.ok && warn.warnings[0]).toContain('Nuevo León');
  });

  it('deduce el estado del CP cuando no se captura', () => {
    const r = entryFromForm(
      { ...formValuesFrom(STORED), state: '' },
      STORED,
      new Set(),
    );
    expect(r.ok && r.entry.state).toBe('Ciudad de México');
  });

  it('rechaza datos inválidos con mensajes claros', () => {
    const r = entryFromForm(
      {
        ...formValuesFrom(null),
        storeNumber: '902',
        postalCode: '12',
        lat: '-99.1',
        lng: '19.4',
      },
      null,
      new Set(['902']),
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors).toEqual([
      'La tienda 902 ya existe en el directorio.',
      'El código postal debe tener 5 dígitos válidos.',
      'Las coordenadas quedan fuera de México. ¿Están invertidas?',
    ]);
  });

  it('exige latitud y longitud juntas', () => {
    const r = entryFromForm(
      { ...formValuesFrom(STORED), lng: '' },
      STORED,
      new Set(),
    );
    expect(!r.ok && r.errors).toEqual([
      'Captura latitud y longitud juntas, o deja ambas vacías.',
    ]);
  });
});
