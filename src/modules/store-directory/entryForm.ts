import {
  canonicalState,
  canonicalZone,
  isInsideMexico,
  isValidStoreNumber,
  normalizePostalCode,
  normalizeStoreNumber,
  stateForPostalCode,
  type StoreDirectoryEntry,
} from '@/domain/stores';

/** Valores del formulario tal como los escribe el usuario. */
export interface EntryFormValues {
  storeNumber: string;
  name: string;
  status: 'active' | 'inactive';
  street: string;
  neighborhood: string;
  municipality: string;
  state: string;
  zone: string;
  postalCode: string;
  lat: string;
  lng: string;
}

export function formValuesFrom(
  entry: StoreDirectoryEntry | null,
): EntryFormValues {
  return {
    storeNumber: entry?.storeNumber ?? '',
    name: entry?.name ?? '',
    status: entry?.status ?? 'active',
    street: entry?.street ?? '',
    neighborhood: entry?.neighborhood ?? '',
    municipality: entry?.municipality ?? '',
    state: entry?.state ?? '',
    zone: entry?.zone ?? '',
    postalCode: entry?.postalCode ?? '',
    lat: entry?.lat?.toString() ?? '',
    lng: entry?.lng?.toString() ?? '',
  };
}

export type EntryFormResult =
  | { ok: true; entry: StoreDirectoryEntry; warnings: string[] }
  | { ok: false; errors: string[] };

function coordinate(value: string): number | null | 'invalid' {
  const t = value.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

/**
 * Valida y arma la ficha. Coordenadas que cambian respecto a la guardada se
 * marcan como captura manual, para que una importación posterior no las pise.
 */
export function entryFromForm(
  values: EntryFormValues,
  previous: StoreDirectoryEntry | null,
  takenNumbers: ReadonlySet<string>,
): EntryFormResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const storeNumber = normalizeStoreNumber(values.storeNumber);
  if (storeNumber === '') errors.push('Captura el número de tienda.');
  else if (!isValidStoreNumber(storeNumber))
    errors.push('El número de tienda no puede contener «/».');
  else if (!previous && takenNumbers.has(storeNumber))
    errors.push(`La tienda ${storeNumber} ya existe en el directorio.`);

  const state = values.state ? canonicalState(values.state) : null;
  const zone = values.zone ? canonicalZone(values.zone) : null;

  let postalCode: string | null = null;
  if (values.postalCode.trim() !== '') {
    postalCode = normalizePostalCode(values.postalCode);
    if (!postalCode)
      errors.push('El código postal debe tener 5 dígitos válidos.');
    else if (state && stateForPostalCode(postalCode) !== state)
      warnings.push(
        `El CP ${postalCode} corresponde a ${stateForPostalCode(postalCode)}, no a ${state}.`,
      );
  }

  const lat = coordinate(values.lat);
  const lng = coordinate(values.lng);
  if (lat === 'invalid' || lng === 'invalid') {
    errors.push(
      'Latitud y longitud deben ser números (ej. 19.4326 y -99.1332).',
    );
  } else if ((lat === null) !== (lng === null)) {
    errors.push('Captura latitud y longitud juntas, o deja ambas vacías.');
  } else if (lat !== null && lng !== null && !isInsideMexico(lat, lng)) {
    errors.push('Las coordenadas quedan fuera de México. ¿Están invertidas?');
  }

  if (errors.length > 0) return { ok: false, errors };

  const la = lat as number | null;
  const ln = lng as number | null;
  const sameCoords =
    previous !== null && previous.lat === la && previous.lng === ln;
  return {
    ok: true,
    warnings,
    entry: {
      storeNumber,
      name: values.name.trim(),
      status: values.status,
      street: values.street.trim(),
      neighborhood: values.neighborhood.trim(),
      municipality: values.municipality.trim(),
      state: state ?? (postalCode ? stateForPostalCode(postalCode) : null),
      zone,
      postalCode,
      lat: la,
      lng: ln,
      coordinateSource:
        la === null ? null : sameCoords ? previous.coordinateSource : 'manual',
    },
  };
}
