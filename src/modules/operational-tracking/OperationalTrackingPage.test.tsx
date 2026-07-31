import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OperationalTrackingPage } from './OperationalTrackingPage';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  listOperationalTracking,
  updateCheck,
  updateClassification,
} from '@/services/campaignOperationalTracking';
import type { UserRole } from '@/domain';

const authState = { role: 'admin' as UserRole };
vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1',
      email: 'a@b.mx',
      displayName: null,
      role: authState.role,
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/campaignOperationalTracking', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/campaignOperationalTracking')
  >('@/services/campaignOperationalTracking');
  return {
    ...actual,
    listOperationalTracking: vi.fn(),
    updateCheck: vi.fn(),
    updateClassification: vi.fn(),
  };
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
    fechaInicio: over.fechaInicio ?? '2026-05-10',
    fechaFin: over.fechaFin ?? '2026-05-20',
    mes: 'Mayo',
    link: over.link ?? '',
    supports: [],
    ...over,
  };
}

const INST = campaign({
  id: 'a',
  name: 'BUEN FIN',
  nameKey: 'buen fin',
  tipo: 'INSTITUCIONAL',
  link: 'https://x.com/a.zip',
});
const UNK = campaign({
  id: 'b',
  name: 'REGRESO',
  nameKey: 'regreso',
  tipo: 'Digital',
});

function renderPage() {
  return render(
    <MemoryRouter>
      <OperationalTrackingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.role = 'admin';
  vi.mocked(listCampaigns).mockResolvedValue([INST, UNK]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
  vi.mocked(updateCheck).mockReset();
  vi.mocked(updateClassification).mockReset();
});

describe('OperationalTrackingPage', () => {
  it('la campaña con tipo desconocido queda con clasificación pendiente', async () => {
    renderPage();
    await screen.findByText('REGRESO');
    const sel = screen.getByLabelText(
      'Clasificación de REGRESO',
    ) as HTMLSelectElement;
    expect(sel.value).toBe('');
  });

  it('filtra por clasificación', async () => {
    renderPage();
    await screen.findByText('BUEN FIN');
    await userEvent.selectOptions(
      screen.getByLabelText('Clasificación'),
      'institutional',
    );
    expect(screen.getByText('BUEN FIN')).toBeInTheDocument();
    expect(screen.queryByText('REGRESO')).not.toBeInTheDocument();
  });

  it('marca un check directamente en la tabla (sin abrir detalle)', async () => {
    vi.mocked(updateCheck).mockResolvedValue({} as never);
    renderPage();
    await screen.findByText('BUEN FIN');
    const csm = screen.getByLabelText('Programación CSM de BUEN FIN');
    await userEvent.click(csm);
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(1));
    expect(updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: 'buen fin',
        key: 'csmProgramming',
        completed: true,
        classification: 'institutional',
        linkValid: true,
      }),
    );
  });

  it('muestra los cinco indicadores como casillas en la tabla', async () => {
    renderPage();
    await screen.findByText('BUEN FIN');
    for (const h of ['Link', 'Validación', 'CSM', 'T Arr.', 'T Comp.']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    // Institucional con link válido → Validación y Link marcadas por defecto.
    expect(
      (
        screen.getByLabelText(
          'Validación Liverpool de BUEN FIN',
        ) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(
      (
        screen.getByLabelText(
          'Programación CSM de BUEN FIN',
        ) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it('muestra las fechas en formato dd/mm/aaaa', async () => {
    renderPage();
    await screen.findByText('BUEN FIN');
    const rowInst = screen.getByText('BUEN FIN').closest('tr')!;
    expect(within(rowInst).getByText('10/05/2026')).toBeInTheDocument();
    expect(within(rowInst).getByText('20/05/2026')).toBeInTheDocument();
  });

  it('muestra un mensaje de error de carga', async () => {
    vi.mocked(listCampaigns).mockRejectedValue(new Error('x'));
    renderPage();
    expect(
      await screen.findByText(/No se pudo cargar el seguimiento/i),
    ).toBeInTheDocument();
  });
});
