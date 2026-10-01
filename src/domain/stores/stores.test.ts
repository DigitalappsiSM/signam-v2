import { describe, expect, it } from 'vitest';
import {
  buildDirectory,
  canonicalState,
  catalogCoverage,
  diffDirectory,
  isInsideMexico,
  mergeEntry,
  normalizePostalCode,
  normalizeStoreNumber,
  readDirectorySheets,
  stateForPostalCode,
  type DirectorySheet,
  type StoreDirectoryEntry,
} from '.';

// Fixtures sintéticos con la misma forma que el directorio de Liverpool y la
// hoja «Centros» del archivo Ekon. Tiendas y direcciones inventadas.
const DIRECTORY_SHEET: DirectorySheet = {
  name: 'Hoja1',
  rows: [
    [
      'Tienda: Nombre Sucursal',
      'Estatus de tienda',
      'Número de sucursal',
      'Calle y No.',
      'Colonia',
      'Municipio / Delegación',
      'Zona',
      'Estado',
      'Código postal',
    ],
    [
      'L PRUEBA NORTE',
      'Activa',
      '901',
      'AV. UNO 100',
      'CENTRO',
      'MONTERREY',
      'Noreste',
      'Nuevo León',
      '64000',
    ],
    [
      'L PRUEBA CDMX',
      'Activa',
      '902',
      'CALLE DOS 2',
      'DEL VALLE',
      'BENITO JUÁREZ',
      'Metropolitana',
      'CDMX',
      '3100',
    ],
    [
      'L PRUEBA EDOMEX',
      'Activa',
      '0903',
      'BLVD. TRES',
      'SATÉLITE',
      'NAUCALPAN',
      'Metropolitana',
      'Estado de México',
      '53100',
    ],
    [
      'L CP CRUZADO',
      'Activa',
      '904',
      'AV. CUATRO',
      'CENTRO',
      'AGUASCALIENTES',
      'Centro',
      'Aguascalientes',
      '52900',
    ],
    [
      'L CERRADA',
      'Inactiva',
      '905',
      'AV. CINCO',
      'CENTRO',
      'ZAPOPAN',
      'Centro',
      'Jalisco',
      '45050',
    ],
    ['', '', '', '', '', '', '', '', ''],
    ['', '', '', '.', '', '', '', '', ''],
  ],
};

const CENTROS_SHEET: DirectorySheet = {
  name: 'Centros',
  rows: [
    [
      'Alta en Ekon',
      'Codigo Ekon',
      'Determinante',
      'Tienda',
      'Dirección',
      'Latitud',
      'Longuitud',
    ],
    [
      'true',
      '1',
      '901',
      'PRUEBA NORTE',
      'Av. Uno 100, Monterrey',
      '25.6714',
      '-100.309',
    ],
    [
      'true',
      '2',
      '902',
      'PRUEBA CDMX',
      'Calle Dos 2, CDMX',
      '19.3732',
      '-99.1784',
    ],
    ['true', '3', '903', 'PRUEBA EDOMEX', 'Blvd. Tres', '-99.23', '19.51'],
    ['true', '9', '999', 'SIN DIRECCIÓN', 'Sin dirección', '20.1', '-98.7'],
  ],
};

const OTHER_SHEET: DirectorySheet = {
  name: 'Articulos',
  rows: [
    ['ARTICULO', '', 'MEGAMUPI DIGITAL'],
    ['Producto', 'Codigo', 'Escandallo'],
  ],
};

function build(sheets: DirectorySheet[]) {
  const read = readDirectorySheets(sheets);
  const built = buildDirectory(read.rows);
  return {
    entries: built.entries,
    issues: [...read.issues, ...built.issues],
    byNumber: new Map(built.entries.map((e) => [e.storeNumber, e])),
  };
}

describe('geografía', () => {
  it('normaliza el CP y recupera el cero inicial de la CDMX', () => {
    expect(normalizePostalCode('3100')).toBe('03100');
    expect(normalizePostalCode(64000)).toBe('64000');
    expect(normalizePostalCode('64000.0')).toBe('64000');
    expect(normalizePostalCode('123')).toBeNull();
    expect(normalizePostalCode('00999')).toBeNull();
    expect(normalizePostalCode('')).toBeNull();
  });

  it('deduce el estado por prefijo de CP', () => {
    expect(stateForPostalCode('03100')).toBe('Ciudad de México');
    expect(stateForPostalCode('52900')).toBe('México');
    expect(stateForPostalCode('64750')).toBe('Nuevo León');
    expect(stateForPostalCode('97000')).toBe('Yucatán');
  });

  it('canoniza los nombres de estado del directorio', () => {
    expect(canonicalState('CDMX')).toBe('Ciudad de México');
    expect(canonicalState('Estado de México')).toBe('México');
    expect(canonicalState('Baja California Norte')).toBe('Baja California');
    expect(canonicalState('queretaro')).toBe('Querétaro');
    expect(canonicalState('Atlántida')).toBeNull();
  });

  it('detecta coordenadas invertidas o fuera de México', () => {
    expect(isInsideMexico(19.43, -99.13)).toBe(true);
    expect(isInsideMexico(-99.13, 19.43)).toBe(false);
    expect(isInsideMexico(40.7, -74)).toBe(false);
  });

  it('número de tienda sin ceros a la izquierda', () => {
    expect(normalizeStoreNumber('0078')).toBe('78');
    expect(normalizeStoreNumber(78)).toBe('78');
    expect(normalizeStoreNumber(' 78.0 ')).toBe('78');
  });
});

describe('lectura del directorio', () => {
  it('reconoce el directorio y la hoja de coordenadas, ignora el resto', () => {
    const { entries, byNumber } = build([
      DIRECTORY_SHEET,
      CENTROS_SHEET,
      OTHER_SHEET,
    ]);
    expect(entries.map((e) => e.storeNumber)).toEqual([
      '901',
      '902',
      '903',
      '904',
      '905',
      '999',
    ]);
    expect(byNumber.get('901')).toMatchObject({
      name: 'L PRUEBA NORTE',
      state: 'Nuevo León',
      zone: 'Noreste',
      postalCode: '64000',
      lat: 25.6714,
      lng: -100.309,
      coordinateSource: 'ekon',
      status: 'active',
    });
    expect(byNumber.get('902')).toMatchObject({
      state: 'Ciudad de México',
      postalCode: '03100',
    });
    expect(byNumber.get('905')?.status).toBe('inactive');
  });

  it('reporta el CP que no corresponde al estado y lo conserva', () => {
    const { issues, byNumber } = build([DIRECTORY_SHEET]);
    const hit = issues.find((i) => i.code === 'postal-code-state-mismatch');
    expect(hit).toMatchObject({ storeNumber: '904', sheet: 'Hoja1', row: 5 });
    expect(hit?.message).toContain('México');
    expect(byNumber.get('904')?.postalCode).toBe('52900');
    expect(byNumber.get('904')?.state).toBe('Aguascalientes');
  });

  it('rechaza coordenadas invertidas en lugar de pintarlas en el mar', () => {
    const { issues, byNumber } = build([DIRECTORY_SHEET, CENTROS_SHEET]);
    expect(byNumber.get('903')).toMatchObject({
      lat: null,
      lng: null,
      coordinateSource: null,
    });
    expect(
      issues.some(
        (i) => i.code === 'invalid-coordinates' && i.storeNumber === '903',
      ),
    ).toBe(true);
    expect(
      issues.some(
        (i) => i.code === 'missing-coordinates' && i.storeNumber === '903',
      ),
    ).toBe(false);
  });

  it('avisa de tiendas activas sin coordenadas, no de las inactivas', () => {
    const { issues } = build([DIRECTORY_SHEET, CENTROS_SHEET]);
    const missing = issues
      .filter((i) => i.code === 'missing-coordinates')
      .map((i) => i.storeNumber);
    expect(missing).toEqual(['904']);
  });

  it('avisa de coordenadas de una tienda que no está en el directorio', () => {
    const { issues } = build([DIRECTORY_SHEET, CENTROS_SHEET]);
    expect(
      issues.some(
        (i) =>
          i.code === 'coordinates-without-store' && i.storeNumber === '999',
      ),
    ).toBe(true);
  });

  it('un número de tienda repetido en la hoja es error y conserva la primera fila', () => {
    const dup: DirectorySheet = {
      ...DIRECTORY_SHEET,
      rows: [
        ...DIRECTORY_SHEET.rows,
        [
          'L OTRA',
          'Activa',
          '901',
          'X',
          'X',
          'X',
          'Centro',
          'Jalisco',
          '44100',
        ],
      ],
    };
    const { issues, byNumber } = build([dup]);
    expect(
      issues.find((i) => i.code === 'duplicate-store-number'),
    ).toMatchObject({ severity: 'error', storeNumber: '901' });
    expect(byNumber.get('901')?.name).toBe('L PRUEBA NORTE');
  });

  it('omite números de tienda que no sirven como id', () => {
    const bad: DirectorySheet = {
      ...DIRECTORY_SHEET,
      rows: [
        DIRECTORY_SHEET.rows[0]!,
        [
          'L RARA',
          'Activa',
          '12/B',
          'X',
          'X',
          'X',
          'Centro',
          'Jalisco',
          '44100',
        ],
      ],
    };
    const { issues, entries } = build([bad]);
    expect(entries).toEqual([]);
    expect(issues[0]).toMatchObject({ code: 'missing-store-number', row: 2 });
  });

  it('sin encabezados reconocibles lo dice explícitamente', () => {
    const { issues, entries } = build([OTHER_SHEET]);
    expect(entries).toEqual([]);
    expect(issues[0]?.code).toBe('missing-header');
  });
});

const BASE: StoreDirectoryEntry = {
  storeNumber: '901',
  name: 'L PRUEBA',
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
};

describe('comparación contra lo guardado', () => {
  it('un dato vacío del archivo no borra el guardado', () => {
    const merged = mergeEntry(BASE, {
      ...BASE,
      street: '',
      postalCode: null,
      lat: null,
      lng: null,
      coordinateSource: null,
    });
    expect(merged).toEqual(BASE);
  });

  it('las coordenadas capturadas a mano no las pisa un archivo', () => {
    const manual = {
      ...BASE,
      lat: 25.7,
      lng: -100.4,
      coordinateSource: 'manual' as const,
    };
    expect(mergeEntry(manual, BASE)).toMatchObject({
      lat: 25.7,
      coordinateSource: 'manual',
    });
  });

  it('clasifica nuevas, cambiadas, iguales y ausentes sin borrar', () => {
    const stored = [
      BASE,
      { ...BASE, storeNumber: '902' },
      { ...BASE, storeNumber: '903' },
    ];
    const incoming = [
      BASE,
      { ...BASE, storeNumber: '902', postalCode: '64001' },
      { ...BASE, storeNumber: '904' },
    ];
    const diff = diffDirectory(stored, incoming);
    expect(diff.unchanged.map((e) => e.storeNumber)).toEqual(['901']);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]).toMatchObject({
      storeNumber: '902',
      fields: ['postalCode'],
    });
    expect(diff.created.map((e) => e.storeNumber)).toEqual(['904']);
    expect(diff.notInFile.map((e) => e.storeNumber)).toEqual(['903']);
  });
});

describe('cobertura contra el catálogo de pantallas', () => {
  it('reporta faltantes en ambos sentidos con pantallas activas', () => {
    const directory = [
      BASE,
      { ...BASE, storeNumber: '902' },
      { ...BASE, storeNumber: '905', status: 'inactive' as const },
    ];
    const coverage = catalogCoverage(directory, [
      { storeNumber: '0901', storeName: 'Prueba', active: true },
      { storeNumber: '77', storeName: 'Cuernavaca', active: true },
      { storeNumber: '77', storeName: 'Cuernavaca', active: true },
      { storeNumber: '902', storeName: 'Prueba 2', active: false },
    ]);
    expect(coverage.catalogWithoutDirectory).toEqual([
      { storeNumber: '77', storeName: 'Cuernavaca', screens: 2 },
    ]);
    expect(coverage.directoryWithoutScreens.map((e) => e.storeNumber)).toEqual([
      '902',
    ]);
  });
});
