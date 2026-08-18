import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { reconcileCampaign } from '@/domain/ekon';
import { assignmentsFromSpecs } from '@/domain/ekon/fixtures';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { ReconciliationRow } from './reconciliationView';
import { toReconInput } from './reconciliationView';
import { ReconciliationDetailModal } from './ReconciliationDetailModal';

const P32 = {
  'ID Periodo': '32',
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
};

function row(): ReconciliationRow {
  const campaign: StoredCampaign = {
    id: 'campaign-1',
    name: 'Campaña Modal',
    nameKey: 'campaña modal',
    signature: 'signature',
    tipo: 'Proveedor',
    vendidoPor: '',
    fechaInicio: '2026-07-28',
    fechaFin: '2026-08-03',
    mes: 'Agosto',
    link: '',
    row: 1,
    supports: [
      {
        support: 'MEGA MUPI DIGITAL',
        owner: 'liverpool',
        stores: [
          { numero: '10', nombre: 'Tienda Diez' },
          { numero: '20', nombre: 'Tienda Veinte' },
        ],
      },
    ],
  };
  const assignments = assignmentsFromSpecs([
    {
      ...P32,
      Campaña: '30001',
      Artículo: 'MEGA MUPI DIGITAL',
      Determinante: '10',
      Tienda: 'TIENDA 10 EKON',
    },
  ]);
  return {
    campaign,
    ekonNumber: '30001',
    result: reconcileCampaign(toReconInput(campaign), '30001', assignments),
  };
}

function renderModal(overrides?: {
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
}) {
  return render(
    <MemoryRouter>
      <ReconciliationDetailModal
        row={row()}
        onClose={() => undefined}
        onPrevious={overrides?.onPrevious}
        onNext={overrides?.onNext}
        hasPrevious={overrides?.hasPrevious ?? false}
        hasNext={overrides?.hasNext ?? false}
      />
    </MemoryRouter>,
  );
}

describe('ReconciliationDetailModal', () => {
  it('abre en diferencias y permite consultar todas las tiendas', async () => {
    renderModal();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('#20')).toBeInTheDocument();
    expect(screen.queryByText('#10')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Todas \(2\)/i }));
    expect(screen.getByText('#10')).toBeInTheDocument();
    expect(screen.getByText('#20')).toBeInTheDocument();
  });

  it('copia un listado tabulado con las diferencias', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderModal();

    await userEvent.click(
      screen.getByRole('button', { name: /Copiar diferencias/i }),
    );

    expect(writeText).toHaveBeenCalledOnce();
    const copied = String(writeText.mock.calls[0]![0]);
    expect(copied).toContain('Campaña\tNúmero Ekon\tTienda');
    expect(copied).toContain('Campaña Modal\t30001\t20');
    expect(await screen.findByText('Copiadas')).toBeInTheDocument();
  });

  it('navega entre campañas con incidencias', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    renderModal({ onPrevious, onNext, hasPrevious: true, hasNext: true });

    await userEvent.click(
      screen.getByRole('button', { name: /Campaña anterior/i }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Campaña siguiente/i }),
    );

    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
