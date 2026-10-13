import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { UserRole } from '@/domain';
import type { AdmiraScreen } from '@/domain/models';
import {
  getQuividiCommercialAudit,
  rebuildQuividiCommercialRollup,
} from '@/services/quividi';
import { CommercialIntelligencePage } from './CommercialIntelligencePage';

function catalogScreen(
  storeNumber: string,
  storeName: string,
  calendarSupport: string,
): AdmiraScreen {
  return {
    id: `${storeNumber}-${calendarSupport}`,
    original: {
      'Numero de Tienda': storeNumber,
      'Nombre de tienda': storeName,
    } as AdmiraScreen['original'],
    metadata: {
      calendarSupport,
      quividiLocationId: 1,
    } as AdmiraScreen['metadata'],
  };
}

const authState = { role: 'admin' as UserRole };
vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'me',
      email: 'admin@signam.mx',
      displayName: null,
      role: authState.role,
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/screens', () => ({
  listScreens: vi.fn(async () => [
    catalogScreen('5', 'LIVERPOOL INSURGENTES', 'MEGA MUPI DIGITAL'),
    catalogScreen('199', 'LIVERPOOL POLANCO', 'MEGA MUPI DIGITAL'),
    catalogScreen('5', 'LIVERPOOL INSURGENTES', 'BANNER DIGITAL'),
    catalogScreen('300', 'LIVERPOOL SATÉLITE', "MUPPI'S"),
  ]),
}));

const PENDING_DAY = {
  date: '2026-09-29',
  raw: [
    {
      locationId: 141982,
      pointId: 'LIV-005-MUPI-P1',
      ots: 0,
      effectiveOts: 0,
      watchers: 229,
      attentionSeconds: 0,
      dwellSeconds: 0,
      measured: true,
      otsMeasured: false,
      viewersMeasured: true,
    },
  ],
  commercial: null,
  fase1: null,
  consistency: 'pending-rollup' as const,
};

vi.mock('@/services/quividi', () => ({
  getQuividiCommercialAudit: vi.fn(async () => ({
    storeNumber: '005',
    storeName: 'LIVERPOOL INSURGENTES',
    support: 'MEGA MUPI DIGITAL',
    days: [],
  })),
  rebuildQuividiCommercialRollup: vi.fn(async () => ({ rowsWritten: 1 })),
}));

async function auditInsurgentes() {
  const store = screen.getByRole('combobox', { name: /Tienda/ });
  fireEvent.focus(store);
  fireEvent.change(store, { target: { value: 'insurgentes' } });
  fireEvent.click(await screen.findByRole('option', { name: /INSURGENTES/ }));
  fireEvent.change(screen.getByLabelText('Desde'), {
    target: { value: '2026-09-01' },
  });
  fireEvent.change(screen.getByLabelText('Hasta'), {
    target: { value: '2026-09-30' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Auditar' }));
}

describe('CommercialIntelligencePage', () => {
  it('elige la tienda con el teclado y envía el número y soporte del catálogo', async () => {
    render(<CommercialIntelligencePage />);
    const store = screen.getByRole('combobox', { name: /Tienda/ });
    fireEvent.focus(store);
    fireEvent.change(store, { target: { value: 'liverpool' } });
    await waitFor(() =>
      expect(
        within(screen.getByRole('listbox')).getAllByRole('option'),
      ).toHaveLength(3),
    );

    fireEvent.keyDown(store, { key: 'ArrowDown' });
    fireEvent.keyDown(store, { key: 'Enter' });
    expect(store).toHaveValue('LIVERPOOL INSURGENTES (005)');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auditar' }));

    await waitFor(() =>
      expect(getQuividiCommercialAudit).toHaveBeenCalledWith({
        storeNumber: '005',
        support: 'MEGA MUPI DIGITAL',
        startDate: '2026-10-01',
        endDate: '2026-10-10',
        campaignId: undefined,
      }),
    );
  });

  it('la primera flecha arriba marca la última sugerencia', async () => {
    render(<CommercialIntelligencePage />);
    const store = screen.getByRole('combobox', { name: /Tienda/ });
    fireEvent.focus(store);
    fireEvent.change(store, { target: { value: 'liverpool' } });
    await waitFor(() =>
      expect(
        within(screen.getByRole('listbox')).getAllByRole('option'),
      ).toHaveLength(3),
    );
    fireEvent.keyDown(store, { key: 'ArrowUp' });
    fireEvent.keyDown(store, { key: 'Enter' });
    expect(store).toHaveValue('LIVERPOOL SATÉLITE (300)');
  });

  it('al cambiar de soporte envía el soporte nuevo de la misma tienda', async () => {
    vi.mocked(getQuividiCommercialAudit).mockClear();
    render(<CommercialIntelligencePage />);
    const store = screen.getByRole('combobox', { name: /Tienda/ });
    fireEvent.focus(store);
    fireEvent.change(store, { target: { value: 'insurgentes' } });
    fireEvent.click(await screen.findByRole('option', { name: /INSURGENTES/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Soporte/ }), {
      target: { value: 'BANNER DIGITAL' },
    });
    expect(store).toHaveValue('LIVERPOOL INSURGENTES (005)');
    fireEvent.change(screen.getByLabelText('Desde'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-10-02' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Auditar' }));
    await waitFor(() =>
      expect(getQuividiCommercialAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          storeNumber: '005',
          support: 'BANNER DIGITAL',
        }),
      ),
    );
  });

  it('rotula «OTS sin medir» y ofrece reconstruir el rollup pendiente', async () => {
    authState.role = 'admin';
    vi.mocked(getQuividiCommercialAudit).mockResolvedValue({
      storeNumber: '005',
      storeName: 'LIVERPOOL INSURGENTES',
      support: 'MEGA MUPI DIGITAL',
      days: [PENDING_DAY],
    });
    render(<CommercialIntelligencePage />);
    await auditInsurgentes();

    expect(
      await screen.findByText(/OTS sin medir · 229 watchers/),
    ).toBeInTheDocument();
    expect(screen.getByText('Rollup pendiente')).toBeInTheDocument();
    // Cambiar el formulario después no altera lo que se reconstruye.
    fireEvent.change(screen.getByLabelText('Hasta'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruir rollup' }));
    await waitFor(() =>
      expect(rebuildQuividiCommercialRollup).toHaveBeenCalledWith({
        storeNumber: '005',
        support: 'MEGA MUPI DIGITAL',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Rollup reconstruido: 1 día(s)',
    );
  });

  it('viewer no ve el botón de reconstruir', async () => {
    authState.role = 'viewer';
    vi.mocked(getQuividiCommercialAudit).mockResolvedValue({
      storeNumber: '005',
      storeName: 'LIVERPOOL INSURGENTES',
      support: 'MEGA MUPI DIGITAL',
      days: [PENDING_DAY],
    });
    render(<CommercialIntelligencePage />);
    await auditInsurgentes();
    expect(await screen.findByText('Rollup pendiente')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reconstruir rollup' }),
    ).not.toBeInTheDocument();
    authState.role = 'admin';
  });

  it('el click (activación de lectores de pantalla) también elige la sugerencia', async () => {
    render(<CommercialIntelligencePage />);
    const store = screen.getByRole('combobox', { name: /Tienda/ });
    fireEvent.focus(store);
    fireEvent.change(store, { target: { value: 'pola' } });
    fireEvent.click(await screen.findByRole('option', { name: /POLANCO/ }));
    expect(store).toHaveValue('LIVERPOOL POLANCO (199)');
  });
});
