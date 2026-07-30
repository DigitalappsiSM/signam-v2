import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CampaignsPage } from './CampaignsPage';
import type { StoredCampaign } from './campaignDiff';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  listEkonLinks,
  saveEkonLink,
  unlinkEkon,
} from '@/services/campaignEkonLinks';

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1',
      email: 'admin@signam.mx',
      displayName: null,
      role: 'admin',
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/campaignEkonLinks', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/campaignEkonLinks')
  >('@/services/campaignEkonLinks');
  return {
    ...actual,
    listEkonLinks: vi.fn(),
    saveEkonLink: vi.fn(),
    unlinkEkon: vi.fn(),
  };
});

function campaign(over: Partial<StoredCampaign>): StoredCampaign {
  return {
    id: over.id ?? 'id',
    row: 1,
    name: over.name ?? 'CAMPAÑA',
    nameKey: over.nameKey ?? (over.name ?? 'campaña').toLowerCase(),
    signature: 'sig',
    tipo: 'Digital',
    vendidoPor: 'Liverpool',
    fechaInicio: over.fechaInicio ?? '2026-05-10',
    fechaFin: over.fechaFin ?? '2026-05-20',
    mes: 'Mayo',
    link: '',
    supports: [],
    ...over,
  };
}

const A = campaign({
  id: 'a',
  name: 'BUEN FIN',
  nameKey: 'buen fin',
  fechaInicio: '2026-05-10',
  fechaFin: '2026-05-20',
});
const B = campaign({
  id: 'b',
  name: 'REGRESO A CLASES',
  nameKey: 'regreso a clases',
  fechaInicio: '2026-08-01',
  fechaFin: '2026-08-10',
});

beforeEach(() => {
  vi.mocked(listCampaigns).mockResolvedValue([A, B]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listEkonLinks).mockResolvedValue([
    {
      id: 'k',
      campaignNameKey: 'buen fin',
      campaignName: 'BUEN FIN',
      ekonCampaignNumber: 777,
      createdAt: 1,
      createdBy: 'x',
      updatedAt: 1,
      updatedBy: 'x',
    },
  ]);
  vi.mocked(saveEkonLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(unlinkEkon).mockReset().mockResolvedValue(undefined);
});

describe('CampaignsPage — columna Ekon y filtros', () => {
  it('muestra la columna "# campaña Ekon" con el número o "—"', async () => {
    render(<CampaignsPage />);
    expect(
      await screen.findByRole('columnheader', { name: /# campaña Ekon/i }),
    ).toBeInTheDocument();

    const rowA = screen.getByText('BUEN FIN').closest('tr')!;
    expect(within(rowA).getByText('777')).toBeInTheDocument();

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    // La celda Ekon de B muestra "—".
    expect(within(rowB).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('combina búsqueda por nombre y filtro por periodo', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');

    // Filtro por periodo de agosto → solo REGRESO A CLASES.
    const desde = screen.getByLabelText('Desde');
    await userEvent.type(desde, '2026-07-01');
    await waitFor(() =>
      expect(screen.queryByText('BUEN FIN')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('REGRESO A CLASES')).toBeInTheDocument();

    // Búsqueda que no coincide con lo que queda en el periodo → sin resultados.
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar campaña/i),
      'buen',
    );
    expect(
      await screen.findByText(/Ninguna campaña coincide/i),
    ).toBeInTheDocument();
  });

  it('valida el rango invertido y no presenta resultados', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-09-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2026-01-01');
    expect(
      await screen.findByText(/no puede ser posterior/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('BUEN FIN')).not.toBeInTheDocument();
  });

  it('guarda una asociación Ekon nueva desde el modal', async () => {
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    const input = screen.getByLabelText(/# campaña Ekon/i);
    await userEvent.type(input, '4321');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(saveEkonLink).toHaveBeenCalledTimes(1));
    expect(saveEkonLink).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: 'regreso a clases',
        campaignName: 'REGRESO A CLASES',
        ekonCampaignNumber: 4321,
      }),
    );
  });

  it('rechaza en la UI un número Ekon inválido sin llamar al servicio', async () => {
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');
    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    await userEvent.type(screen.getByLabelText(/# campaña Ekon/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /mayor que cero/i,
    );
    expect(saveEkonLink).not.toHaveBeenCalled();
  });
});
