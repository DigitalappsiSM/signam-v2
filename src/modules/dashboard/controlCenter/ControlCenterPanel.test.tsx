import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { StoredDirectoryEntry } from '@/services/storeDirectory';
import { listStoreDirectory } from '@/services/storeDirectory';
import { getControlCenterSnapshot } from '@/services/controlCenter';
import type { StoreOccupancy } from '../occupancyModel';
import { ControlCenterPanel } from './ControlCenterPanel';
import type { UserRole } from '@/domain';

vi.mock('@/services/storeDirectory', () => ({ listStoreDirectory: vi.fn() }));
vi.mock('@/services/controlCenter', () => ({
  getControlCenterSnapshot: vi.fn(),
}));

const dir = (over: Partial<StoredDirectoryEntry>): StoredDirectoryEntry => ({
  storeNumber: '901',
  name: 'L PRUEBA NORTE',
  status: 'active',
  street: '',
  neighborhood: '',
  municipality: 'MONTERREY',
  state: 'Nuevo León',
  zone: 'Noreste',
  postalCode: '64000',
  lat: 25.67,
  lng: -100.3,
  coordinateSource: 'ekon',
  createdAt: 1,
  updatedAt: 1,
  updatedBy: 'x',
  ...over,
});

const CAMPAIGNS: StoreOccupancy['campaigns'] = [
  ...['i-0', 'i-1'].map((id) => ({
    campaignId: id,
    campaignName: id,
    campaignNameKey: id,
    classification: 'institutional' as const,
    startDate: null,
    endDate: null,
  })),
  ...['p-0', 'p-1', 'p-2', 'p-3', 'p-4'].map((id) => ({
    campaignId: id,
    campaignName: id,
    campaignNameKey: id,
    classification: 'provider' as const,
    startDate: null,
    endDate: null,
  })),
];

// Las mismas 7 campañas se distribuyen en dos tiendas: siguen siendo 7.
const OCC: StoreOccupancy[] = ['901', '902'].map((storeNumber) => ({
  storeNumber,
  storeName: 'Prueba',
  peakConcurrentCampaigns: 3,
  distinctCampaigns: 7,
  campaignDays: 20,
  classification: { institutional: 2, provider: 5, unknown: 0 },
  distinctSupports: 2,
  physicalScreens: 4,
  campaigns: CAMPAIGNS,
}));

beforeEach(() => {
  vi.mocked(listStoreDirectory).mockResolvedValue([
    dir({}),
    dir({ storeNumber: '902', name: 'L JALISCO', state: 'Jalisco' }),
  ]);
  vi.mocked(getControlCenterSnapshot).mockResolvedValue({
    generatedAt: '2026-10-01T00:00:00Z',
    tickets: [
      {
        id: 18501,
        title: 'Pantalla apagada',
        category: 'Soporte',
        storeNumber: '902',
        storeLabel: '902 - Jalisco',
        stage: 'En progreso',
        assignee: 'Soporte ISM',
        createdAt: '2020-01-01 00:00:00',
        url: 'https://in-storemedia.odoo.com/odoo/helpdesk/6/tickets/18501',
      },
    ],
    cameras: [
      {
        locationId: 1,
        storeNumber: '901',
        storeName: 'Prueba',
        support: 'VIDEO WALL',
        status: 'normal',
        severity: 'none',
        latestDate: '2026-09-30',
        consecutiveDays: 0,
        coreOts: 1500,
        ticketId: null,
      },
    ],
    camerasLatestDate: '2026-09-30',
    warnings: [],
  });
});

function renderPanel(role: UserRole = 'admin') {
  return render(
    <MemoryRouter>
      <ControlCenterPanel
        occupancyStores={OCC}
        supportedStores={new Set(['901', '902'])}
        theme="light"
        role={role}
        todayLabel="01/10/2026"
        refreshKey={0}
      />
    </MemoryRouter>,
  );
}

describe('Centro de Control', () => {
  it('muestra campañas separadas en marcas y Liverpool, incidencias y audiencia', async () => {
    renderPanel();
    const rail = await screen.findByRole('complementary', {
      name: 'Indicadores',
    });
    const campaigns = within(rail).getByRole('button', {
      name: /Campañas al aire/i,
    });
    expect(campaigns).toHaveTextContent('7');
    expect(campaigns).toHaveTextContent('Marcas 5');
    expect(campaigns).toHaveTextContent('Liverpool 2');
    expect(
      await within(rail).findByRole('button', {
        name: /Incidencias abiertas\s*1/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(rail).getByRole('button', { name: /Audiencia OTS/i }),
    ).toHaveTextContent('1,500');
  });

  it('la capa Incidencias recorre tickets y abre el ticket en Odoo', async () => {
    renderPanel();
    await screen.findByText(/Incidencias abiertas/i);
    await userEvent.click(screen.getByRole('button', { name: 'Incidencias' }));
    const nav = await screen.findByLabelText('Navegador de tickets');
    expect(nav).toHaveTextContent('Incidencia 1 de 1');
    expect(nav).toHaveTextContent('Pantalla apagada');
    expect(
      within(nav).getByRole('link', { name: 'Abrir en Odoo' }),
    ).toHaveAttribute(
      'href',
      'https://in-storemedia.odoo.com/odoo/helpdesk/6/tickets/18501',
    );
    await userEvent.click(
      within(nav).getByRole('button', { name: /L JALISCO/ }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: /L JALISCO · Tienda 902/,
    });
    expect(within(dialog).getByText('Crítica')).toBeInTheDocument();
  });

  it('las tarjetas abren una ventana flotante que se cierra con Escape', async () => {
    renderPanel();
    await userEvent.click(
      await screen.findByRole('button', { name: /Incidencias abiertas/i }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Incidencias abiertas',
    });
    expect(within(dialog).getByText('L JALISCO · 902')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el rol comercial no ve accesos a módulos que no puede abrir', async () => {
    vi.mocked(getControlCenterSnapshot).mockResolvedValue({
      generatedAt: '',
      tickets: [],
      cameras: [
        {
          locationId: 5,
          storeNumber: '901',
          storeName: 'Prueba',
          support: 'MUPI',
          status: 'no_ots',
          severity: 'critical',
          latestDate: '2026-09-30',
          consecutiveDays: 2,
          coreOts: 0,
          ticketId: 77,
        },
      ],
      camerasLatestDate: '2026-09-30',
      warnings: [],
    });
    renderPanel('commercial');
    await screen.findByText(/Incidencias abiertas/i);
    await userEvent.click(screen.getByRole('button', { name: 'Incidencias' }));
    const nav = await screen.findByLabelText('Navegador de tickets');
    expect(nav).toHaveTextContent('Con ticket');
    expect(
      within(nav).queryByRole('link', { name: 'Salud de cámaras' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(nav).getByRole('button', { name: /L PRUEBA NORTE/ }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('link', { name: 'Ver en Directorio' }),
    ).not.toBeInTheDocument();
  });

  it('ranking de estados cambia con la capa', async () => {
    renderPanel();
    expect(
      await screen.findByRole('heading', { name: /Estados con más campañas/i }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Audiencias' }));
    expect(
      screen.getByRole('heading', { name: /Estados con más audiencia/i }),
    ).toBeInTheDocument();
  });
});
