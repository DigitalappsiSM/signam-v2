import { describe, it, expect } from 'vitest';
import { parseCampaigns, parseStoreComment } from './campaignParse';
import type { WorkbookData } from './calendarImport';

const headers = [
  'MES',
  'CAMPAÑAS DIGITALES',
  'Tipo de Campaña',
  'LINK',
  'CAMPAÑA NUEVA/ ACTUALIZADA',
  'VENDIDO POR',
  'FECHA INICIO',
  'FECHA \nFIN',
  'VIDEO WALL CRIUS',
  'PANTALLAS CUADRADAS',
  'MUPPI´S',
  'PENDON',
];

function wb(
  dataRows: string[][],
  comments: WorkbookData['comments'] = [],
): WorkbookData {
  return {
    sheets: [{ name: 'Hoja 2', rows: [headers, ...dataRows] }],
    comments,
  };
}

describe('parseStoreComment', () => {
  it('separa número y nombre por tabulador', () => {
    expect(parseStoreComment('103\tL INTERLOMAS\n78\tL GUADALAJARA')).toEqual([
      { numero: '103', nombre: 'L INTERLOMAS' },
      { numero: '78', nombre: 'L GUADALAJARA' },
    ]);
  });

  it('tolera separación por espacios y líneas sin nombre', () => {
    expect(parseStoreComment('6   L. COAPA\n999')).toEqual([
      { numero: '6', nombre: 'L. COAPA' },
      { numero: '999', nombre: '' },
    ]);
  });

  it('ignora líneas vacías', () => {
    expect(parseStoreComment('\n\n2\tL INSURGENTES\n\n')).toEqual([
      { numero: '2', nombre: 'L INSURGENTES' },
    ]);
  });

  it('ignora líneas sin número de tienda (no confunde la "L" con número)', () => {
    expect(
      parseStoreComment('Tiendas asignadas:\nL SANTA FE\n7\tL SANTA FE'),
    ).toEqual([{ numero: '7', nombre: 'L SANTA FE' }]);
  });
});

describe('parseCampaigns', () => {
  const dataRow = [
    'FEBRERO',
    'Nike Verano',
    'ISM/PROVEEDOR',
    '',
    '',
    'LIVERPOOL',
    '2/1/26',
    '2/16/26',
    'Asignada', // VIDEO WALL CRIUS
    '', // PANTALLAS CUADRADAS
    'Asignada', // MUPPI´S
    '', // PENDON
  ];

  it('extrae la campaña con sus metadatos', () => {
    const result = parseCampaigns(wb([dataRow]));
    expect(result.totalCampaigns).toBe(1);
    const c = result.campaigns[0]!;
    expect(c.name).toBe('Nike Verano');
    expect(c.vendidoPor).toBe('LIVERPOOL');
    expect(c.fechaInicio).toBe('2/1/26');
    expect(c.fechaFin).toBe('2/16/26');
  });

  it('clasifica columnas de soporte Liverpool vs InStore', () => {
    const result = parseCampaigns(wb([dataRow]));
    expect(result.liverpoolSupports).toContain('VIDEO WALL CRIUS');
    expect(result.liverpoolSupports).toContain('PANTALLAS CUADRADAS');
    expect(result.instoreSupports).toEqual(['MUPPI´S', 'PENDON']);
  });

  it('incluye solo los soportes marcados "Asignada" y sus tiendas', () => {
    const result = parseCampaigns(
      wb(
        [dataRow],
        [
          {
            sheet: 'Hoja 2',
            row: 2,
            col: 9,
            address: 'I2',
            text: '78\tL GUADALAJARA\n2\tL INSURGENTES',
          },
        ],
      ),
    );
    const c = result.campaigns[0]!;
    expect(c.supports.map((s) => s.support)).toEqual([
      'VIDEO WALL CRIUS',
      'MUPPI´S',
    ]);
    const vw = c.supports.find((s) => s.support === 'VIDEO WALL CRIUS')!;
    expect(vw.owner).toBe('liverpool');
    expect(vw.stores).toEqual([
      { numero: '78', nombre: 'L GUADALAJARA' },
      { numero: '2', nombre: 'L INSURGENTES' },
    ]);
    const muppis = c.supports.find((s) => s.support === 'MUPPI´S')!;
    expect(muppis.owner).toBe('instore-media');
  });

  it('omite filas sin nombre de campaña', () => {
    const empty = headers.map(() => '');
    const result = parseCampaigns(wb([dataRow, empty]));
    expect(result.totalCampaigns).toBe(1);
  });

  it('bloquea si falta la columna de nombre de campaña', () => {
    const noName: WorkbookData = {
      sheets: [
        {
          name: 'Hoja 2',
          rows: [
            ['MES', 'OTRA'],
            ['x', 'y'],
          ],
        },
      ],
      comments: [],
    };
    const result = parseCampaigns(noName);
    expect(
      result.issues.some((i) => i.code === 'missing-campaign-column'),
    ).toBe(true);
  });
});
