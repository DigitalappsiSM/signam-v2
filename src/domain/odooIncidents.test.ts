import { describe, expect, it } from 'vitest';
import {
  mexicoMonth,
  summarizeIncidents,
  type OdooIncident,
} from './odooIncidents';
const ticket: OdooIncident = {
  id: 1,
  title: 'Prueba',
  retailer: 'Liverpool',
  store: '001 - Tienda',
  requester: 'Persona',
  assignee: 'Equipo',
  stage: 'Nuevo',
  closed: false,
  cancelled: false,
  category: 'Soporte',
  modality: 'Sin dato',
  tags: [],
  createdAt: '',
  closedAt: null,
  firstResponseHours: null,
  resolutionHours: null,
  sla: 'Sin dato',
  policies: [],
  url: '',
};
describe('indicadores Odoo', () => {
  it('excluye cancelados, SLA sin dato y en curso del denominador', () => {
    const value = summarizeIncidents([
      { ...ticket, sla: 'Cumplido' },
      { ...ticket, id: 2, sla: 'Incumplido' },
      { ...ticket, id: 3, sla: 'En curso' },
      { ...ticket, id: 4, sla: 'Cumplido', cancelled: true },
      { ...ticket, id: 5 },
    ]);
    expect(value.compliance).toBe(50);
    expect(value.evaluated).toBe(2);
    expect(value.firstResponse.value).toBeNull();
  });
  it('cuenta cada ticket una vez y deja contenido y tiendas desconocidas fuera del ranking técnico', () => {
    const value = summarizeIncidents([
      ticket,
      { ...ticket, id: 2, category: 'Contenido' },
      { ...ticket, id: 3, category: 'Cámaras', store: null },
      { ...ticket, id: 4, firstResponseHours: 2 },
      { ...ticket, id: 5, closed: true, resolutionHours: 4 },
    ]);
    expect(value.stores[0]?.tickets).toBe(3);
    expect(value.firstResponse.value).toBe(2);
    expect(value.resolution.value).toBe(4);
  });
  it('usa el mes de México en el cambio de mes UTC', () => {
    expect(mexicoMonth(new Date('2026-10-01T03:00:00Z'))).toBe('2026-09');
  });
});
