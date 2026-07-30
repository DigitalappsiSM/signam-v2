import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/campaignOperationalTracking', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/campaignOperationalTracking')
  >('@/services/campaignOperationalTracking');
  return { ...actual, listOperationalTracking: vi.fn() };
});

function campaign(over: Partial<StoredCampaign>): StoredCampaign {
  return {
    id: over.id ?? 'id',
    row: 1,
    name: over.name ?? 'CAMPAÑA',
    nameKey: over.nameKey ?? (over.name ?? 'campaña').toLowerCase(),
    signature: 'sig',
    tipo: over.tipo ?? '',
    vendidoPor: 'Liverpool',
    fechaInicio: over.fechaInicio ?? '2020-01-01',
    fechaFin: over.fechaFin ?? '2020-01-20',
    mes: 'Enero',
    link: over.link ?? '',
    supports: [],
    ...over,
  };
}

beforeEach(() => {
  // Campaña terminada, sin link y con testigos pendientes → alerta crítica.
  vi.mocked(listCampaigns).mockResolvedValue([
    campaign({ name: 'VIEJA', nameKey: 'vieja', tipo: 'PROVEEDOR' }),
  ]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
});

describe('DashboardPage — resumen operativo', () => {
  it('muestra alertas críticas con enlace a Seguimiento', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    // La campaña vencida aparece como alerta con enlace a Seguimiento.
    const links = await screen.findAllByRole('link', { name: 'VIEJA' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/seguimiento?campana=vieja');
  });

  it('siempre muestra las tarjetas de módulos', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: /Módulos/i }),
    ).toBeInTheDocument();
  });
});
