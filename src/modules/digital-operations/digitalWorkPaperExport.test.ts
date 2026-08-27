import { describe, expect, it } from 'vitest';
import {
  createDigitalTracking,
  type DigitalOperationalItem,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';
import {
  buildDigitalWorkPaper,
  digitalWorkPaperFileName,
  eligibleDigitalWorkPaperItems,
} from './digitalWorkPaperExport';

const actor = { uid: 'u1', email: 'operador@ism.mx' };

function item(
  id: string,
  retailerCode: 'CHEDRAUI' | 'LA_COMER',
  active = true,
): DigitalOperationalItem {
  return {
    id,
    operationalKey: id,
    logicalFlightKey: id,
    source: 'ekon-campaign-tracking',
    retailerCode,
    retailerLabel: retailerCode === 'CHEDRAUI' ? 'Chedraui' : 'La Comer',
    supportCode: 'COPETE_DIGITAL',
    supportLabel: 'Copete Digital',
    cmsName: 'CMS Externo',
    campaignNumber: id === 'chedraui' ? '101' : '202',
    periodId: 'C17',
    periodLabel: 'C17',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-15',
    fixationStart: '2026-08-02',
    fixationEnd: '2026-08-14',
    placementMode: 'fixation',
    client: 'Cliente Uno',
    advertiser: 'Marca Uno',
    product: 'REFRIS',
    creativityId: 'CR-17',
    creativityTitle: 'Creatividad C17',
    creativityStatus: 'Aprobada',
    centers: 12,
    supports: 12,
    placementRowIds: [],
    active,
    firstBatchId: 'b1',
    lastBatchId: 'b1',
    updatedAt: 1,
  };
}

function tracking(id: string, cancelled = false): DigitalOperationalTracking {
  return {
    ...createDigitalTracking(id, actor, 1),
    lifecycleStatus: cancelled ? 'cancelled' : 'active',
    comments: [
      {
        id: 'cm-1',
        text: 'Primer comentario',
        createdAt: Date.UTC(2026, 7, 3, 10),
        createdByUid: actor.uid,
        createdByEmail: actor.email,
      },
      {
        id: 'cm-2',
        text: 'Segundo comentario',
        createdAt: Date.UTC(2026, 7, 4, 12),
        createdByUid: actor.uid,
        createdByEmail: actor.email,
      },
    ],
  };
}

describe('digitalWorkPaperExport', () => {
  it('exporta solo operaciones vigentes y no canceladas', () => {
    const items = [
      item('chedraui', 'CHEDRAUI'),
      item('inactive', 'LA_COMER', false),
      item('cancelled', 'LA_COMER'),
    ];
    expect(
      eligibleDigitalWorkPaperItems({
        items,
        tracking: [
          tracking('chedraui'),
          tracking('inactive'),
          tracking('cancelled', true),
        ],
        periodKey: '2026-08-01|2026-08-15|C17',
      }).map((entry) => entry.id),
    ).toEqual(['chedraui']);
  });

  it('replica la estructura visual del ejemplo y deja Arte vacío', async () => {
    const buffer = await buildDigitalWorkPaper({
      items: [item('chedraui', 'CHEDRAUI'), item('lacomerc', 'LA_COMER')],
      tracking: [tracking('chedraui'), tracking('lacomerc')],
      periodKey: '2026-08-01|2026-08-15|C17',
    });
    const { default: ExcelJS } = await import('exceljs');
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as ArrayBuffer);

    expect(reopened.worksheets.map((sheet) => sheet.name)).toEqual([
      'CHEDRAUI',
      'LACOMER',
    ]);
    const chedraui = reopened.getWorksheet('CHEDRAUI')!;
    expect(chedraui.getRow(1).values).toEqual([
      undefined,
      'Cadena',
      'Cliente',
      'Anunciante',
      'Campaña',
      'Fecha Fijación',
      'Fecha Retirada',
      'Creatividad Id',
      'Pasillo',
      'Arte',
      'Comentarios',
    ]);
    expect(chedraui.getRow(1).height).toBe(30);
    expect(chedraui.getRow(1).getCell(1).fill).toMatchObject({
      fgColor: { argb: 'FFED7D31' },
    });
    expect(
      reopened.getWorksheet('LACOMER')!.getRow(1).getCell(1).fill,
    ).toMatchObject({
      fgColor: { argb: 'FFC00000' },
    });
    expect(chedraui.getColumn(9).width).toBeCloseTo(80.6328125);
    expect(chedraui.getRow(2).height).toBe(30);
    expect(chedraui.getRow(2).getCell(5).value).toBeInstanceOf(Date);
    expect(chedraui.getRow(2).getCell(5).numFmt).toBe('yyyy-mm-dd');
    expect(chedraui.getRow(2).getCell(9).value ?? '').toBe('');
    expect(String(chedraui.getRow(2).getCell(10).value)).toContain(
      'Primer comentario',
    );
    expect(String(chedraui.getRow(2).getCell(10).value)).toContain(
      'Segundo comentario',
    );
  });

  it('nombra el archivo como el papel de trabajo de referencia', () => {
    expect(digitalWorkPaperFileName('C17')).toBe(
      'Papel de trabajo - C17 operadores.xlsx',
    );
  });
});
