import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  DESGLOSE_HEADERS,
  bulkReportFileName,
  buildCampaignReportWorkbook,
  individualReportFileName,
  sanitizeFilePart,
} from './campaignExcelExport';
import type { CampaignReport, CampaignReportRow } from './campaignReport';

function row(over: Partial<CampaignReportRow>): CampaignReportRow {
  return {
    ekonNumber: over.ekonNumber ?? null,
    campaignName: over.campaignName ?? 'Camp',
    campaignType: over.campaignType ?? 'Proveedor',
    startDate: over.startDate ?? '2026-05-01',
    endDate: over.endDate ?? '2026-05-31',
    storeNumber: over.storeNumber ?? '10',
    storeName: over.storeName ?? 'T10',
    liverpoolSupport: over.liverpoolSupport ?? 'SOP',
    screenType: over.screenType ?? 'LED',
    model: over.model ?? 'M',
    circuit: over.circuit ?? 'C',
    resolution: over.resolution ?? 'R',
    format: over.format ?? 'F',
    platformName: over.platformName ?? 'P',
  };
}

async function reload(report: CampaignReport): Promise<ExcelJS.Workbook> {
  const wb = await buildCampaignReportWorkbook(report);
  const buffer = await wb.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer as ArrayBuffer);
  return reopened;
}

describe('buildCampaignReportWorkbook', () => {
  it('genera un archivo que exceljs puede volver a abrir', async () => {
    const report: CampaignReport = { rows: [row({})], issues: [] };
    const wb = await reload(report);
    expect(wb.getWorksheet('Desglose')).toBeDefined();
  });

  it('escribe los encabezados exactos y en orden en la primera fila', async () => {
    const report: CampaignReport = { rows: [row({})], issues: [] };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const header = sheet.getRow(1);
    const values = (header.values as (string | undefined)[]).slice(1);
    expect(values).toEqual([...DESGLOSE_HEADERS]);
  });

  it('coloca el número de campaña Ekon en la primera columna', async () => {
    const report: CampaignReport = {
      rows: [row({ ekonNumber: 4242 })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    expect(sheet.getCell('A1').value).toBe('Número de campaña en Ekon');
    expect(sheet.getCell('A2').value).toBe(4242);
  });

  it('coloca el tipo de campaña después del nombre', async () => {
    const report: CampaignReport = {
      rows: [row({ campaignType: 'Institucional' })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    expect(sheet.getCell('C1').value).toBe('Tipo de campaña');
    expect(sheet.getCell('C2').value).toBe('Institucional');
    const summary = wb.getWorksheet('Resumen')!;
    expect(summary.getCell('C1').value).toBe('Tipo de campaña');
    expect(summary.getCell('C2').value).toBe('Institucional');
  });

  it('deja la celda de Ekon vacía cuando no hay número', async () => {
    const report: CampaignReport = {
      rows: [row({ ekonNumber: null })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const value = sheet.getCell('A2').value;
    expect(value == null || value === '').toBe(true);
  });

  it('no incluye ninguna columna "Cantidad"', async () => {
    const report: CampaignReport = { rows: [row({})], issues: [] };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const header = (sheet.getRow(1).values as (string | undefined)[]).slice(1);
    expect(
      header.some((h) => (h ?? '').toLowerCase().includes('cantidad')),
    ).toBe(false);
  });

  it('escribe el número de tienda como texto', async () => {
    const report: CampaignReport = {
      rows: [row({ storeNumber: '78' })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const cell = sheet.getCell('F2');
    expect(cell.value).toBe('78');
    expect(typeof cell.value).toBe('string');
  });

  it('congela la fila superior y aplica autofiltro', async () => {
    const report: CampaignReport = { rows: [row({})], issues: [] };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const view = sheet.views[0];
    expect(view?.state).toBe('frozen');
    expect(view?.state === 'frozen' && view.ySplit).toBe(1);
    expect(sheet.autoFilter).toBeTruthy();
  });

  it('exporta las fechas como fecha real con formato dd/mm/aaaa', async () => {
    const report: CampaignReport = {
      rows: [row({ startDate: '2026-05-01', endDate: '2026-05-31' })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    const start = sheet.getCell('D2');
    const end = sheet.getCell('E2');
    // Fecha real (Date), no texto, para que Excel ordene y filtre por fecha.
    expect(start.value).toBeInstanceOf(Date);
    expect(end.value).toBeInstanceOf(Date);
    // Sin desfase de zona horaria: se conserva la fecha civil en UTC.
    expect((start.value as Date).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect((end.value as Date).toISOString()).toBe('2026-05-31T00:00:00.000Z');
    // Formato visible dd/mm/aaaa.
    expect(start.numFmt).toBe('dd/mm/yyyy');
    expect(end.numFmt).toBe('dd/mm/yyyy');
  });

  it('acepta el formato día-primero de Liverpool como fecha real', async () => {
    const report: CampaignReport = {
      rows: [row({ startDate: '1/5/26', endDate: '31/5/26' })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    expect((sheet.getCell('D2').value as Date).toISOString()).toBe(
      '2026-05-01T00:00:00.000Z',
    );
    expect((sheet.getCell('E2').value as Date).toISOString()).toBe(
      '2026-05-31T00:00:00.000Z',
    );
  });

  it('conserva como texto una fecha no interpretable y deja vacía la ausente', async () => {
    const report: CampaignReport = {
      rows: [row({ startDate: 'por confirmar', endDate: '' })],
      issues: [],
    };
    const wb = await reload(report);
    const sheet = wb.getWorksheet('Desglose')!;
    // No parseable: se reporta el texto original, no se corrige en silencio.
    expect(sheet.getCell('D2').value).toBe('por confirmar');
    // Vacía: celda en blanco.
    const end = sheet.getCell('E2').value;
    expect(end == null || end === '').toBe(true);
  });

  it('crea la hoja Incidencias solo cuando hay incidencias', async () => {
    const withoutIssues: CampaignReport = { rows: [row({})], issues: [] };
    const noSheet = await reload(withoutIssues);
    expect(noSheet.getWorksheet('Incidencias')).toBeUndefined();

    const withIssues: CampaignReport = {
      rows: [row({})],
      issues: [
        {
          ekonNumber: null,
          campaignName: 'Camp',
          campaignType: 'Proveedor',
          startDate: '2026-05-01',
          endDate: '2026-05-31',
          support: 'SOP',
          store: '999',
          code: 'store-not-in-catalog',
          message: 'La tienda 999 no existe en el catálogo.',
        },
      ],
    };
    const withSheet = await reload(withIssues);
    const issues = withSheet.getWorksheet('Incidencias')!;
    expect(issues).toBeDefined();
    expect(issues.getCell('C1').value).toBe('Tipo de campaña');
    expect(issues.getCell('C2').value).toBe('Proveedor');
  });
});

describe('nombres de archivo', () => {
  it('individual con Ekon', () => {
    expect(
      individualReportFileName({
        campaignName: 'COLCHONIZA 2026',
        ekonNumber: 12345,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      }),
    ).toBe('12345_COLCHONIZA 2026_01-05-2026_31-05-2026_Desglose.xlsx');
  });

  it('individual sin Ekon', () => {
    expect(
      individualReportFileName({
        campaignName: 'COLCHONIZA 2026',
        ekonNumber: null,
        startDate: '2026-05-01',
        endDate: '2026-05-31',
      }),
    ).toBe('Sin Ekon_COLCHONIZA 2026_01-05-2026_31-05-2026_Desglose.xlsx');
  });

  it('sanitiza caracteres inválidos del nombre de campaña', () => {
    expect(sanitizeFilePart('A/B:C*?')).toBe('A_B_C__');
    const name = individualReportFileName({
      campaignName: 'A/B',
      ekonNumber: 1,
      startDate: '',
      endDate: '',
    });
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
    expect(name).toContain('sin-fecha');
  });

  it('masivo con ambos límites, uno o ninguno', () => {
    expect(bulkReportFileName('2026-05-01', '2026-06-30')).toBe(
      'Campañas_01-05-2026_a_30-06-2026.xlsx',
    );
    expect(bulkReportFileName('2026-05-01', '')).toBe(
      'Campañas_desde_01-05-2026.xlsx',
    );
    expect(bulkReportFileName('', '2026-06-30')).toBe(
      'Campañas_hasta_30-06-2026.xlsx',
    );
    expect(bulkReportFileName('', '')).toBe('Campañas_todas.xlsx');
  });
});
