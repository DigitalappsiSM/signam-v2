import { describe, expect, it } from 'vitest';
import { readAdmiraPassesWorkbook } from './readAdmiraPassesWorkbook';

function csvFile(content: string): Blob {
  const bytes = new TextEncoder().encode(content);
  return {
    name: 'occupation_details.csv',
    type: 'text/csv',
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Blob;
}

describe('readAdmiraPassesWorkbook — CSV nativo Admira', () => {
  it('lee UTF-8, fechas civiles y campos entre comillas con comas', async () => {
    const file = csvFile(
      [
        'Nombre, Nombre descriptivo, Criterios, Día ,Campaña, Contenidos, Ratios, Nivel Ratio, Categoria, Horario, Distribuida, Pases/Slots Programados, Pases/Slots en uso,Pases/Slots Totales',
        '"PLAYER, UNO","Player descriptivo",LIVERPOOL,15/09/2026,"Campaña, septiembre","Video, versión final",Instore Liverpool,Liverpool,Publicidad Tipo 1,00:00 00:24,Yes,Ilimitados,90,90',
      ].join('\n'),
    );

    const result = await readAdmiraPassesWorkbook(file);

    expect(result.sheetName).toBe('CSV');
    expect(result.headerRow).toBe(1);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      player: 'PLAYER, UNO',
      descriptiveName: 'Player descriptivo',
      date: '2026-09-15',
      campaign: 'Campaña, septiembre',
      content: 'Video, versión final',
      ratio: 1,
      passes: 90,
    });
  });
});
