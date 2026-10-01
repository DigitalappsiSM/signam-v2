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

describe('SLA independientes', () => {
  const policies = [
    { name: 'Primera respuesta', status: 'failed', deadline: null },
    { name: 'Política de cierre', status: 'reached', deadline: null },
  ];
  it('una respuesta tardía no penaliza resolución, incluso al reabrir', () => {
    const value = summarizeIncidents([
      { ...ticket, sla: 'Incumplido', policies },
    ]);
    expect(value.resolutionSla).toMatchObject({
      compliance: 100,
      passed: 1,
      failed: 0,
      evaluated: 1,
    });
    expect(value.responseSla).toMatchObject({ compliance: 0, failed: 1 });
    expect(value.compliance).toBe(0);
  });
  it('cada tipo tiene su denominador y cuenta un ticket con varias políticas una vez', () => {
    const value = summarizeIncidents([
      { ...ticket, policies: [...policies, policies[1]!] },
      {
        ...ticket,
        policies: [{ name: 'Cierre', status: 'failed', deadline: null }],
      },
      {
        ...ticket,
        policies: [{ name: 'Cierre', status: 'ongoing', deadline: null }],
      },
      {
        ...ticket,
        policies: [{ name: 'Cierre', status: 'unexpected', deadline: null }],
      },
      { ...ticket, cancelled: true, policies },
      ticket,
    ]);
    expect(value.resolutionSla).toMatchObject({
      compliance: 50,
      evaluated: 2,
      ongoing: 1,
      missing: 2,
    });
    expect(value.responseSla.evaluated).toBe(1);
  });
  it('usa etapas objetivo reconocidas sin inventar políticas para nombres ambiguos', () => {
    const value = summarizeIncidents([
      {
        ...ticket,
        policies: [
          {
            name: '48 horas',
            targetStage: 'Resuelto',
            status: 'reached',
            deadline: null,
          },
          {
            name: '6 horas',
            targetStage: 'En progreso',
            status: 'failed',
            deadline: null,
          },
          {
            name: 'Primera respuesta y cierre',
            targetStage: 'Resuelto',
            status: 'failed',
            deadline: null,
          },
        ],
      },
    ]);
    expect(value.resolutionSla.compliance).toBe(100);
    expect(value.responseSla.compliance).toBe(0);
    const unknown = summarizeIncidents([
      {
        ...ticket,
        sla: 'Cumplido',
        resolutionHours: 1,
        policies: [
          {
            name: 'Servicio',
            targetStage: 'Revisión',
            status: 'reached',
            deadline: null,
          },
        ],
      },
    ]);
    expect(unknown.resolutionSla.compliance).toBeNull();
    expect(unknown.responseSla.compliance).toBeNull();
  });
});
