import * as XLSX from 'xlsx';

export const GRASSFISH_IMPORT_LIMIT = 400;

export interface GrassfishCamera {
  locationId: number;
}

export interface GrassfishPlayer {
  boxId: string;
  name: string;
  storeKey: string | null;
  displayCount: 2;
  camera1: GrassfishCamera | null;
  camera2: GrassfishCamera | null;
  audienceMode: 'primary' | 'both';
}

const HEADERS = [
  'Box-ID',
  'Player',
  'Clave tienda',
  'Location ID 1',
  'Location ID 2',
  'Total audiencia',
];

function camera(location: string): GrassfishCamera | null {
  if (!location) return null;
  if (!/^[1-9]\d{0,14}$/.test(location)) {
    throw new Error('El Location ID de Quividi debe ser un entero positivo.');
  }
  return { locationId: Number(location) };
}

export function parseGrassfishCatalog(csv: string): GrassfishPlayer[] {
  const workbook = XLSX.read(csv.replace(/^\uFEFF/, ''), {
    type: 'string',
    raw: true,
    FS: ',',
  });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error('El archivo está vacío.');
  const [headers, ...rows] = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });
  if (
    !headers ||
    headers.length !== HEADERS.length ||
    HEADERS.some((header, idx) => header !== headers[idx]?.trim())
  ) {
    throw new Error('El encabezado debe ser: ' + HEADERS.join(', '));
  }
  if (!rows.length || rows.length > GRASSFISH_IMPORT_LIMIT) {
    throw new Error('El archivo debe contener entre 1 y 400 players.');
  }

  const playerIds = new Set<string>();
  const locations = new Set<number>();
  return rows.map((row, idx) => {
    const [
      boxId = '',
      name = '',
      storeKey = '',
      loc1 = '',
      loc2 = '',
      mode = '',
    ] = row.map((cell) => String(cell).trim());
    try {
      if (!/^[A-Z0-9_-]{1,40}$/.test(boxId) || !name || name.length > 150) {
        throw new Error('Box-ID o nombre de player inválido.');
      }
      if (storeKey && !/^[A-Za-z0-9_-]{1,80}$/.test(storeKey)) {
        throw new Error('La clave maestra de tienda es inválida.');
      }
      if (playerIds.has(boxId)) throw new Error('Box-ID de player duplicado.');
      playerIds.add(boxId);
      const camera1 = camera(loc1);
      const camera2 = camera(loc2);
      if (camera2 && !camera1) throw new Error('Captura primero la cámara 1.');
      if (mode && mode !== 'primary' && mode !== 'both') {
        throw new Error('Total audiencia debe ser primary o both.');
      }
      if (mode === 'both' && !camera2) {
        throw new Error('El modo both requiere dos cámaras.');
      }
      for (const point of [camera1, camera2]) {
        if (!point) continue;
        if (locations.has(point.locationId)) {
          throw new Error('Location ID de Quividi duplicado.');
        }
        locations.add(point.locationId);
      }
      return {
        boxId,
        name,
        storeKey: storeKey || null,
        displayCount: 2,
        camera1,
        camera2,
        audienceMode: mode === 'both' ? 'both' : 'primary',
      };
    } catch (error) {
      throw new Error(
        `Registro ${idx + 1} (${boxId}): ${(error as Error).message}`,
      );
    }
  });
}
