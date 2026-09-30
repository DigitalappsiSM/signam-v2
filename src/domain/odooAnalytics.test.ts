import { describe, expect, it } from 'vitest';
import { incidentAnalytics, percentile } from './odooAnalytics';
import type { OdooIncident } from './odooIncidents';
const ticket: OdooIncident = {
  id: 1,
  title: 'Ticket',
  retailer: 'Liverpool',
  store: '001 - Tienda',
  requester: 'Solicitante',
  assignee: 'Soporte',
  stage: 'Nuevo',
  closed: false,
  cancelled: false,
  category: 'Soporte',
  modality: 'Remoto',
  tags: [],
  createdAt: '2026-09-02 03:00:00',
  closedAt: null,
  firstResponseHours: 2,
  resolutionHours: null,
  sla: 'En curso',
  policies: [],
  url: '',
};
describe('análisis ejecutivo Odoo', () => {
  it('calcula percentiles sin tratar faltantes como cero', () => {
    expect(percentile([null, 2, 4], 0.5)).toBe(3);
    expect(percentile([null], 0.9)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
  });
  it('usa fecha México para volumen y no incluye días futuros', () => {
    const result = incidentAnalytics(
      [ticket],
      '2026-09',
      '2026-09-02T05:00:00Z',
    );
    expect(result.daily).toEqual([{ date: '2026-09-01', count: 1 }]);
    expect(result.ages[0]?.count).toBe(1);
  });
  it('no atribuye cancelados a antigüedad ni tiempos de resolución abiertos', () => {
    const result = incidentAnalytics(
      [
        { ...ticket, cancelled: true },
        { ...ticket, id: 2, closed: true, resolutionHours: 48 },
      ],
      '2026-09',
      '2026-09-30T22:00:00Z',
    );
    expect(result.ages.every((row) => row.count === 0)).toBe(true);
    expect(result.closureMedian).toBe(48);
    expect(result.assignees[0]?.total).toBe(2);
  });
});
