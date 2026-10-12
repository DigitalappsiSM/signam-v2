import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exportQuividiHistoryCoverage,
  scanQuividiHistoryGaps,
} from '@/services/quividi';
import { HistoryGapsPanel } from './HistoryGapsPanel';

vi.mock('@/services/quividi', () => ({
  scanQuividiHistoryGaps: vi.fn(async ({ reload }: { reload: boolean }) => ({
    dates: ['2026-09-21'],
    locations: 1,
    checked: 33,
    missing: 2,
    incomplete: 0,
    empty: 1,
    datesWithMeasurementGaps: ['2026-09-21'],
    reload,
    enqueued: reload ? 3 : 0,
    pending: 0,
  })),
  exportQuividiHistoryCoverage: vi.fn(async () => ({
    month: '2026-09',
    csv: 'location_id,date\n',
    rows: 1,
  })),
}));

afterEach(() => vi.restoreAllMocks());

function pickSeptember() {
  fireEvent.change(screen.getByLabelText('Mes'), {
    target: { value: '2026-09' },
  });
}

describe('HistoryGapsPanel', () => {
  it('revisar no recarga y muestra el desglose', async () => {
    render(<HistoryGapsPanel />);
    pickSeptember();
    fireEvent.click(screen.getByRole('button', { name: 'Revisar huecos' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      '3 particiones con hueco (2 faltantes, 0 incompletas, 1 vacías en medición).',
    );
    expect(scanQuividiHistoryGaps).toHaveBeenCalledWith({
      month: '2026-09',
      reload: false,
    });
  });

  it('recargar pide confirmación antes de consumir la API', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<HistoryGapsPanel />);
    pickSeptember();
    fireEvent.click(screen.getByRole('button', { name: 'Recargar faltantes' }));
    expect(confirm).toHaveBeenCalled();
    expect(scanQuividiHistoryGaps).not.toHaveBeenCalledWith(
      expect.objectContaining({ reload: true }),
    );

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Recargar faltantes' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se encolaron 3 para volver a pedirse a Quividi.',
    );
  });

  it('descarga el CSV de cobertura del mes', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      () => undefined,
    );
    render(<HistoryGapsPanel />);
    pickSeptember();
    fireEvent.click(
      screen.getByRole('button', { name: 'Descargar cobertura (CSV)' }),
    );
    await waitFor(() =>
      expect(exportQuividiHistoryCoverage).toHaveBeenCalledWith('2026-09'),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
  });
});
