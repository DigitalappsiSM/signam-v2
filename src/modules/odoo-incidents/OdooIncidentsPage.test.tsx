import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OdooIncidentsPage } from './OdooIncidentsPage';
import { can } from '@/app/permissions';
vi.mock('@/components/charts/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} />
  ),
}));
vi.mock('@/services/odooIncidents', () => ({
  getOdooOverview: vi.fn().mockResolvedValue({
    month: '2026-09',
    fetchedAt: '2026-09-30T22:00:00Z',
    warnings: [],
    missingFields: [],
    tickets: [
      {
        id: 1,
        title: 'Incidencia A',
        retailer: 'Liverpool',
        store: '001 - Tienda',
        requester: 'Persona',
        assignee: 'Equipo',
        stage: 'Nuevo',
        closed: false,
        cancelled: false,
        category: 'Soporte',
        modality: 'Remoto',
        tags: [],
        sla: 'Incumplido',
        firstResponseHours: 2,
        resolutionHours: null,
        policies: [],
        url: 'https://in-storemedia.odoo.com/',
      },
      {
        id: 2,
        title: 'Incidencia B',
        retailer: 'Chedraui',
        store: null,
        requester: 'Otra persona',
        assignee: 'Equipo',
        stage: 'Resuelto',
        closed: true,
        cancelled: false,
        category: 'General',
        modality: 'In situ',
        tags: [],
        sla: 'Sin dato',
        firstResponseHours: null,
        resolutionHours: 4,
        policies: [],
        url: 'https://in-storemedia.odoo.com/',
      },
    ],
  }),
}));
describe('dashboard incidencias', () => {
  it('combina retailer y atención con indicadores y detalle', async () => {
    render(<OdooIncidentsPage />);
    expect(await screen.findByText('#1 · Incidencia A')).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByLabelText('Retailer'),
      'Chedraui',
    );
    expect(screen.queryByText('#1 · Incidencia A')).not.toBeInTheDocument();
    expect(screen.getByText('#2 · Incidencia B')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Atención'), 'Remoto');
    expect(screen.queryByText('#2 · Incidencia B')).not.toBeInTheDocument();
  });
  it('no da acceso al perfil comercial', () => {
    expect(can('commercial', 'odooIncidents.read')).toBe(false);
    expect(can('viewer', 'odooIncidents.read')).toBe(true);
  });
});
