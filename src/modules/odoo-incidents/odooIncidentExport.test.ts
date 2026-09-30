import { describe, expect, it } from 'vitest';
import { buildOdooWorkbook } from './odooIncidentExport';
import type { OdooIncident } from '@/domain/odooIncidents';
const ticket: OdooIncident = {
  id: 1,
  title: '=1+1',
  retailer: 'Liverpool',
  store: null,
  requester: 'Solicitante',
  assignee: 'Soporte',
  stage: 'Nuevo',
  closed: false,
  cancelled: false,
  category: 'Soporte',
  modality: 'Sin dato',
  tags: [],
  createdAt: '2026-09-02 03:00:00',
  closedAt: null,
  firstResponseHours: null,
  resolutionHours: null,
  sla: 'Sin dato',
  policies: [],
  url: '',
};
describe('Excel Odoo', () => {
  it('conserva faltantes, filtros y texto literal sin fórmulas', async () => {
    const workbook = await buildOdooWorkbook(
      [ticket],
      '2026-09',
      '2026-09-30T22:00:00Z',
      { Retailer: 'Liverpool' },
    );
    expect(workbook.worksheets).toHaveLength(12);
    expect(workbook.getWorksheet('Tickets')?.getCell('B2').value).toBe('=1+1');
    expect(workbook.getWorksheet('Tickets')?.getCell('M2').value).toBe(
      'Sin dato',
    );
    expect(workbook.getWorksheet('Tiendas técnicas')?.rowCount).toBe(1);
    expect(workbook.getWorksheet('Resumen')?.getColumn(2).values).toContain(
      'Liverpool',
    );
    const buffer = await workbook.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(1000);
  });
});
