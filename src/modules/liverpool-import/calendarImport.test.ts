import { describe, it, expect } from 'vitest';
import { analyzeCalendar, type WorkbookData } from './calendarImport';

function wb(
  sheets: { name: string; rows: string[][] }[],
  comments: WorkbookData['comments'] = [],
): WorkbookData {
  return { sheets, comments };
}

const hoja2Rows = [
  ['Calendario de campañas'],
  ['Campaña', 'Inicio', 'Fin', 'Soporte', 'Tienda'],
  ['Nike Verano', '2026-06-01', '2026-06-30', 'VIDEO WALL CRIUS', '78'],
  ['Adidas', '2026-07-01', '2026-07-15', "MUPPI'S", '10'],
  ['', '', '', '', ''],
];

describe('analyzeCalendar', () => {
  it('prefiere la hoja "Hoja 2" como operativa', () => {
    const result = analyzeCalendar(
      wb([
        { name: 'Tiempos', rows: [['x']] },
        { name: 'Hoja 2', rows: hoja2Rows },
      ]),
    );
    expect(result.operativeSheet).toBe('Hoja 2');
  });

  it('detecta la fila de encabezados y las columnas', () => {
    const result = analyzeCalendar(wb([{ name: 'Hoja 2', rows: hoja2Rows }]));
    expect(result.headerRow).toBe(2);
    expect(result.headers).toEqual([
      'Campaña',
      'Inicio',
      'Fin',
      'Soporte',
      'Tienda',
    ]);
  });

  it('cuenta filas de datos ignorando vacías y arma vista previa', () => {
    const result = analyzeCalendar(wb([{ name: 'Hoja 2', rows: hoja2Rows }]));
    expect(result.dataRowCount).toBe(2);
    expect(result.previewRows).toHaveLength(2);
    expect(result.previewRows[0]?.[0]).toBe('Nike Verano');
  });

  it('detecta valores InStore Media (Muppi’s / Pendón)', () => {
    const rows = [
      ['Campaña', 'Soporte'],
      ['A', "MUPPI'S"],
      ['B', 'Pendón'],
      ['C', 'MUPPIS'],
      ['D', 'VIDEO WALL CRIUS'],
    ];
    const result = analyzeCalendar(wb([{ name: 'Hoja 2', rows }]));
    const total = result.instoreSupports.reduce((n, s) => n + s.count, 0);
    expect(total).toBe(3);
    expect(
      result.instoreSupports.some((s) => s.value === 'VIDEO WALL CRIUS'),
    ).toBe(false);
  });

  it('incluye los comentarios de la hoja operativa', () => {
    const result = analyzeCalendar(
      wb(
        [{ name: 'Hoja 2', rows: hoja2Rows }],
        [
          {
            sheet: 'Hoja 2',
            row: 3,
            col: 5,
            address: 'E3',
            text: 'Tiendas: 78, 10',
          },
          { sheet: 'Otra', row: 1, col: 1, address: 'A1', text: 'ignorar' },
        ],
      ),
    );
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0]?.text).toBe('Tiendas: 78, 10');
  });

  it('reporta workbook vacío como bloqueante', () => {
    const result = analyzeCalendar(wb([]));
    expect(result.operativeSheet).toBeNull();
    expect(result.issues.some((i) => i.severity === 'blocking')).toBe(true);
  });

  it('advierte si no hay filas de datos', () => {
    const result = analyzeCalendar(
      wb([{ name: 'Hoja 2', rows: [['Campaña', 'Soporte']] }]),
    );
    expect(result.dataRowCount).toBe(0);
    expect(result.issues.some((i) => i.code === 'no-data')).toBe(true);
  });
});
