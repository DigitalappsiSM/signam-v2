import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdmiraScreen } from '@/domain/models';
import { getQuividiCommercialAudit } from '@/services/quividi';
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

vi.mock('@/services/screens', () => ({
  listScreens: vi.fn(async () => [
    catalogScreen('5', 'LIVERPOOL INSURGENTES', 'MEGA MUPI DIGITAL'),
    catalogScreen('199', 'LIVERPOOL POLANCO', 'MEGA MUPI DIGITAL'),
    catalogScreen('5', 'LIVERPOOL INSURGENTES', 'BANNER DIGITAL'),
    catalogScreen('300', 'LIVERPOOL SATÉLITE', "MUPPI'S"),
  ]),
}));

vi.mock('@/services/quividi', () => ({
  getQuividiCommercialAudit: vi.fn(async () => ({
    storeNumber: '005',
    storeName: 'LIVERPOOL INSURGENTES',
    support: 'MEGA MUPI DIGITAL',
    days: [],
  })),
}));

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

  it('el click (activación de lectores de pantalla) también elige la sugerencia', async () => {
    render(<CommercialIntelligencePage />);
    const store = screen.getByRole('combobox', { name: /Tienda/ });
    fireEvent.focus(store);
    fireEvent.change(store, { target: { value: 'pola' } });
    fireEvent.click(await screen.findByRole('option', { name: /POLANCO/ }));
    expect(store).toHaveValue('LIVERPOOL POLANCO (199)');
  });
});
