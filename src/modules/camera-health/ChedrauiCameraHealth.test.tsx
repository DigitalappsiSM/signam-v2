import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import {
  createChedrauiCameraHealthTicket,
  getChedrauiCameraHealth,
  type ChedrauiHealthOverview,
} from '@/services/quividi';
import { ChedrauiCameraHealth } from './ChedrauiCameraHealth';

vi.mock('@/services/quividi', () => ({
  createChedrauiCameraHealthTicket: vi.fn(),
  getChedrauiCameraHealth: vi.fn(),
}));

it('muestra la cobertura, crea el ticket y enlaza al equipo Chedraui', async () => {
  const overview: ChedrauiHealthOverview = {
    canRefresh: true,
    canCreateTicket: true,
    currentMeasurementDate: '2026-11-22',
    measurementWarning: null,
    tickets: {},
    history: [
      {
        date: '2026-11-23',
        observedAt: 1795443300000,
        measurementDate: '2026-11-22',
        cameras: [
          {
            boxId: 'BOX-A',
            player: 'Selecto Coapa',
            storeKey: 'COAPA',
            camera: 1,
            locationId: 42,
            inNetwork: true,
            lastSeen: '2026-11-22T23:00:00Z',
          },
        ],
        measurement: {
          42: {
            expectedCoreHours: 11,
            coreMeasuredHours: 2,
            coreOtsHours: 1,
            coreOts: 85,
            status: 'partial_measurement',
          },
        },
      },
    ],
  };
  vi.mocked(getChedrauiCameraHealth)
    .mockResolvedValueOnce(overview)
    .mockResolvedValue({
      ...overview,
      tickets: {
        42: {
          ticketId: 91,
          teamId: 27,
          recoveredTicketId: null,
          creating: false,
          lastSeen: null,
          observedAt: 0,
        },
      },
    });
  vi.mocked(createChedrauiCameraHealthTicket).mockResolvedValue({
    ticketId: 91,
  });
  render(<ChedrauiCameraHealth />);

  const row = within((await screen.findByText('Selecto Coapa')).closest('tr')!);
  expect(row.getByText('Medición parcial')).toBeInTheDocument();
  expect(row.getByText('2/11 h')).toBeInTheDocument();
  expect(row.getByText('85')).toBeInTheDocument();
  await userEvent.click(row.getByRole('button', { name: 'Crear ticket' }));

  expect(createChedrauiCameraHealthTicket).toHaveBeenCalledWith(42);
  expect(await row.findByRole('link', { name: 'Ticket #91' })).toHaveAttribute(
    'href',
    'https://in-storemedia.odoo.com/odoo/helpdesk/27/tickets/91',
  );
});
