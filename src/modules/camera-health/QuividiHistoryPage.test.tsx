import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuividiHistoryPage } from './QuividiHistoryPage';
import {
  assignQuividiHistoryBinding,
  getQuividiHistoryOverview,
} from '@/services/quividi';

vi.mock('@/services/quividi', () => ({
  getQuividiHistoryOverview: vi.fn(),
  startQuividiHistory: vi.fn(),
  assignQuividiHistoryBinding: vi.fn(),
}));

describe('Conciliación del histórico Quividi', () => {
  it('lista solo locations con datos pendientes y permite revisar todas', async () => {
    vi.mocked(getQuividiHistoryOverview).mockResolvedValue({
      stores: [
        {
          storeId: 'LIV-007',
          number: '007',
          name: 'Santa Fe',
          supports: ['MEGA MUPI DIGITAL'],
        },
        {
          storeId: 'LIV-008',
          number: '008',
          name: 'Sin cámara',
          supports: ['BANNER DIGITAL'],
        },
      ],
      networkId: 3089,
      started: true,
      queued: 90,
      completed: 50,
      inferred: 35,
      needsReview: 12,
      unsupported: 3,
      retrying: 0,
      locations: [
        {
          id: 1,
          label: 'Asociada',
          active: true,
          storeId: 'LIV-007',
          storeName: 'Santa Fe',
          support: 'MUPI',
          pointId: 'LIV-007-MUPI-P1',
          validFrom: '2026-09-28',
          firstMeasuredDate: '2026-04-01',
          hasPendingData: false,
        },
        {
          id: 2,
          label: 'Pendiente',
          active: true,
          storeId: null,
          storeName: '',
          support: '',
          pointId: null,
          validFrom: null,
          firstMeasuredDate: '2026-05-01',
          hasPendingData: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<QuividiHistoryPage />);
    const selector = await screen.findByRole('combobox', {
      name: 'Location Quividi',
    });
    expect(within(selector).getAllByRole('option')).toHaveLength(2);
    expect(
      within(selector).getByRole('option', { name: /Pendiente/ }),
    ).toBeInTheDocument();
    expect(
      within(selector).queryByRole('option', { name: /Asociada/ }),
    ).toBeNull();
    await user.selectOptions(selector, '2');
    const stores = screen.getByRole('combobox', { name: 'Tienda Liverpool' });
    expect(
      within(stores).getByRole('option', { name: '008 — Sin cámara' }),
    ).toBeInTheDocument();
    await user.selectOptions(stores, 'LIV-007');
    const supports = screen.getByRole('combobox', { name: 'Soporte' });
    expect(
      within(supports).queryByRole('option', { name: 'BANNER DIGITAL' }),
    ).toBeNull();
    await user.selectOptions(supports, 'MEGA MUPI DIGITAL');
    expect(screen.getByLabelText(/Desde/)).toHaveValue('2026-05-01');
    expect(screen.getByLabelText('Hasta (opcional)')).toHaveValue('');
    expect(screen.getByLabelText('Punto SIGNAM (opcional)')).not.toBeRequired();
    await user.click(
      screen.getByRole('button', { name: 'Guardar asignación histórica' }),
    );
    expect(assignQuividiHistoryBinding).toHaveBeenCalledWith({
      locationId: 2,
      storeId: 'LIV-007',
      storeName: 'Santa Fe',
      support: 'MEGA MUPI DIGITAL',
      pointId: null,
      validFrom: '2026-05-01',
      validTo: null,
    });
    await user.selectOptions(stores, 'LIV-008');
    expect(supports).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Guardar asignación histórica' }),
    ).toBeDisabled();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Mostrar todas/ }));
    expect(within(selector).getAllByRole('option')).toHaveLength(3);
    expect(
      within(selector).getByRole('option', { name: /Asociada/ }),
    ).toBeInTheDocument();
  });
});
