import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createDigitalTracking,
  updateDigitalCheck,
  type DigitalOperationalItem,
  type DigitalOperationalTracking,
} from '@/domain/digital-operations';
import { listDigitalOperationalItems } from '@/services/digitalOperationalItems';
import {
  appendDigitalComment,
  listDigitalTracking,
  setDigitalCheck,
  setDigitalLifecycle,
} from '@/services/digitalOperationalTracking';
import { DigitalOperationsPage } from './DigitalOperationsPage';

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1',
      email: 'operador@ism.mx',
      displayName: null,
      role: 'admin',
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/digitalOperationalItems', () => ({
  listDigitalOperationalItems: vi.fn(),
}));

vi.mock('@/services/digitalOperationalTracking', () => ({
  listDigitalTracking: vi.fn(),
  setDigitalCheck: vi.fn(),
  setDigitalLifecycle: vi.fn(),
  appendDigitalComment: vi.fn(),
}));

function item(over: Partial<DigitalOperationalItem>): DigitalOperationalItem {
  return {
    id: over.id ?? 'op-1',
    operationalKey: over.id ?? 'op-1',
    logicalFlightKey: over.id ?? 'op-1',
    source: 'ekon-campaign-tracking',
    retailerCode: over.retailerCode ?? 'CHEDRAUI',
    retailerLabel: over.retailerLabel ?? 'Chedraui',
    supportCode: 'COPETE_DIGITAL',
    supportLabel: 'Copete Digital',
    cmsName: 'CMS Externo',
    campaignNumber: over.campaignNumber ?? '100',
    periodId: over.periodId ?? 'C18',
    periodLabel: over.periodLabel ?? 'C18',
    periodStart: over.periodStart ?? '2026-08-16',
    periodEnd: over.periodEnd ?? '2026-08-31',
    fixationStart: over.fixationStart ?? '2026-08-16',
    fixationEnd: over.fixationEnd ?? '2026-08-31',
    placementMode: over.placementMode ?? 'fixation',
    client: over.client ?? 'Cliente Uno',
    advertiser: over.advertiser ?? 'Marca Uno',
    product: over.product ?? 'Producto Uno',
    creativityId: over.creativityId ?? 'CR-1',
    creativityTitle: over.creativityTitle ?? 'Creatividad Uno',
    creativityStatus: 'Aprobada',
    centers: 12,
    supports: 12,
    placementRowIds: [],
    active: over.active ?? true,
    firstBatchId: 'b1',
    lastBatchId: 'b1',
    updatedAt: 1,
  };
}

const actor = { uid: 'u1', email: 'operador@ism.mx' };

function tracking(id: string): DigitalOperationalTracking {
  return createDigitalTracking(id, actor, 1);
}

function dayOffset(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

beforeEach(() => {
  const items = [
    item({
      id: 'previous',
      campaignNumber: 'ANTERIOR',
      periodId: 'C17',
      periodLabel: 'C17',
      periodStart: dayOffset(-30),
      periodEnd: dayOffset(-16),
      fixationStart: dayOffset(-30),
      fixationEnd: dayOffset(-16),
    }),
    item({
      id: 'current',
      campaignNumber: 'ACTUAL',
      active: false,
      periodStart: dayOffset(-15),
      periodEnd: dayOffset(15),
      fixationStart: dayOffset(-15),
      fixationEnd: dayOffset(15),
    }),
    item({
      id: 'next',
      campaignNumber: 'SIGUIENTE',
      periodId: 'C19',
      periodLabel: 'C19',
      periodStart: dayOffset(16),
      periodEnd: dayOffset(30),
      fixationStart: dayOffset(16),
      fixationEnd: dayOffset(30),
    }),
    item({
      id: 'old',
      campaignNumber: 'HISTÓRICA',
      periodId: 'C10',
      periodLabel: 'C10',
      periodStart: dayOffset(-100),
      periodEnd: dayOffset(-86),
      fixationStart: dayOffset(-100),
      fixationEnd: dayOffset(-86),
    }),
  ];
  vi.mocked(listDigitalOperationalItems).mockResolvedValue(items);
  vi.mocked(listDigitalTracking).mockResolvedValue(
    items.map((entry) => tracking(entry.id)),
  );
  vi.mocked(setDigitalCheck).mockReset();
  vi.mocked(setDigitalLifecycle).mockReset();
  vi.mocked(appendDigitalComment).mockReset();
});

describe('DigitalOperationsPage', () => {
  it('muestra tres catorcenas y conserva visibles los elementos inactivos', async () => {
    render(<DigitalOperationsPage />);

    expect(await screen.findByText('ACTUAL')).toBeInTheDocument();
    expect(screen.getByText('ANTERIOR')).toBeInTheDocument();
    expect(screen.getByText('SIGUIENTE')).toBeInTheDocument();
    expect(screen.queryByText('HISTÓRICA')).not.toBeInTheDocument();
    expect(screen.getByText('Inactiva en fuente')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Ver todo' }));
    expect(screen.getByText('HISTÓRICA')).toBeInTheDocument();
  });

  it('edita checks inline y actualiza el estado de avance', async () => {
    const updated = updateDigitalCheck(
      tracking('current'),
      'downloadLink',
      true,
      actor,
      2,
    );
    vi.mocked(setDigitalCheck).mockResolvedValue(updated);
    render(<DigitalOperationsPage />);

    const checkbox = await screen.findByRole('checkbox', {
      name: 'Link de descarga de ACTUAL',
    });
    await userEvent.click(checkbox);

    expect(setDigitalCheck).toHaveBeenCalledWith(
      'current',
      'downloadLink',
      true,
      actor,
    );
    const row = screen.getByText('ACTUAL').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('En curso')).toBeInTheDocument();
    expect(within(row!).getByText('33%')).toBeInTheDocument();
  });

  it('expande el detalle y agrega comentarios sin prompts del navegador', async () => {
    const updated = {
      ...tracking('current'),
      comments: [
        {
          id: 'cm-1',
          text: 'Validar material final',
          createdAt: 2,
          createdByUid: actor.uid,
          createdByEmail: actor.email,
        },
      ],
    };
    vi.mocked(appendDigitalComment).mockResolvedValue(updated);
    render(<DigitalOperationsPage />);

    await userEvent.click(
      await screen.findByRole('button', {
        name: 'Detalle y comentarios de ACTUAL',
      }),
    );
    expect(screen.getByText('Producto Uno')).toBeInTheDocument();

    await userEvent.type(
      screen.getByRole('textbox', { name: 'Nuevo comentario para ACTUAL' }),
      'Validar material final',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(appendDigitalComment).toHaveBeenCalledWith(
      'current',
      'Validar material final',
      actor,
    );
    expect(screen.getByText('Validar material final')).toBeInTheDocument();
  });
});
