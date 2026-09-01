import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ReportingPage } from './ReportingPage';

vi.mock('@/services/campaigns', () => ({
  listCampaigns: vi.fn(async () => []),
}));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn(async () => []) }));
vi.mock('@/services/campaignOperationalTracking', () => ({
  listOperationalTracking: vi.fn(async () => []),
}));
vi.mock('@/services/digitalOperationalItems', () => ({
  listDigitalOperationalItems: vi.fn(async () => []),
}));
vi.mock('@/services/digitalOperationalTracking', () => ({
  listDigitalTracking: vi.fn(async () => []),
}));
vi.mock('@/services/campaignEkonLinks', () => ({
  listEkonLinks: vi.fn(async () => []),
  ekonNumberForCampaign: vi.fn(() => null),
}));
vi.mock('@/services/ekonImports', () => ({
  listBatches: vi.fn(async () => []),
}));
vi.mock('@/services/ekonAssignments', () => ({
  listReconciliationAssignmentsByEkonNumber: vi.fn(async () => []),
}));

describe('ReportingPage', () => {
  it('carga el resumen y permite navegar a calidad y conciliación', async () => {
    render(
      <MemoryRouter>
        <ReportingPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Reporting' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Campañas en alcance')).toBeInTheDocument();
    expect(screen.getByText('Embudo operativo')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Calidad y conciliación' }),
    );

    expect(screen.getByText('Última importación EKON')).toBeInTheDocument();
    expect(screen.getByText('Conciliación Liverpool–EKON')).toBeInTheDocument();
  });
});
