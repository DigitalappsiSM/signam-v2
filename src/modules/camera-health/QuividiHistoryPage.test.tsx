import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuividiHistoryPage } from './QuividiHistoryPage';
import { getQuividiHistoryOverview } from '@/services/quividi';

vi.mock('@/services/quividi', () => ({
  getQuividiHistoryOverview: vi.fn(),
  startQuividiHistory: vi.fn(),
  assignQuividiHistoryBinding: vi.fn(),
}));

describe('Conciliación del histórico Quividi', () => {
  it('lista solo locations con datos pendientes y permite revisar todas', async () => {
    vi.mocked(getQuividiHistoryOverview).mockResolvedValue({
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
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Mostrar todas/ }));
    expect(within(selector).getAllByRole('option')).toHaveLength(3);
    expect(
      within(selector).getByRole('option', { name: /Asociada/ }),
    ).toBeInTheDocument();
  });
});
