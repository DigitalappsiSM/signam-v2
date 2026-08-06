import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OperationalTrackingPage } from './OperationalTrackingPage';
import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  listOperationalTracking,
  updateCheck,
  updateClassification,
  markAllChecks,
  addComment,
} from '@/services/campaignOperationalTracking';
import type { UserRole } from '@/domain';
import {
  initialTracking,
  addComment as addCommentPure,
} from './trackingFactory';

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
    markAllChecks: vi.fn(),
    addComment: vi.fn(),
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

/** Fecha `YYYY-MM-DD` desplazada `offset` días respecto de hoy (para timeframe). */
function dayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OperationalTrackingPage />
    </MemoryRouter>,
  );
}

/**
 * Renderiza y quita el filtro temporal por defecto (pulsa "Ver todo") para que
 * las pruebas que no verifican la ventana de fechas vean todas las campañas
 * (los fixtures usan fechas fijas fuera de la ventana relativa a "hoy").
 */
async function renderAllPeriods() {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Ver todo' }));
}

beforeEach(() => {
  authState.role = 'admin';
  vi.mocked(listCampaigns).mockResolvedValue([INST, UNK]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
  vi.mocked(updateCheck).mockReset();
  vi.mocked(updateClassification).mockReset();
  vi.mocked(markAllChecks).mockReset();
  vi.mocked(addComment).mockReset();
});

describe('OperationalTrackingPage', () => {
  it('la campaña con tipo desconocido queda con clasificación pendiente', async () => {
    await renderAllPeriods();
    await screen.findByText('REGRESO');
    const sel = screen.getByLabelText(
      'Clasificación de REGRESO',
    ) as HTMLSelectElement;
    expect(sel.value).toBe('');
  });

  it('filtra por clasificación', async () => {
    await renderAllPeriods();
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
    await renderAllPeriods();
    await screen.findByText('BUEN FIN');
    const csm = screen.getByLabelText('Programación CSM de BUEN FIN');
    await userEvent.click(csm);
    await waitFor(() => expect(updateCheck).toHaveBeenCalledTimes(1));
    expect(updateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: campaignIdentity(INST),
        key: 'csmProgramming',
        completed: true,
        classification: 'institutional',
        linkValid: true,
      }),
    );
  });

  it('muestra los cinco indicadores como casillas en la tabla', async () => {
    await renderAllPeriods();
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
    await renderAllPeriods();
    await screen.findByText('BUEN FIN');
    const rowInst = screen.getByText('BUEN FIN').closest('tr')!;
    expect(within(rowInst).getByText('10/05/2026')).toBeInTheDocument();
    expect(within(rowInst).getByText('20/05/2026')).toBeInTheDocument();
  });

  it('muestra un mensaje de error de carga', async () => {
    vi.mocked(listCampaigns).mockRejectedValue(new Error('x'));
    await renderAllPeriods();
    expect(
      await screen.findByText(/No se pudo cargar el seguimiento/i),
    ).toBeInTheDocument();
  });

  it('ordena por campaña al pulsar el encabezado', async () => {
    await renderAllPeriods();
    await screen.findByText('BUEN FIN');
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    // Orden inicial (por nombre, ascendente en la carga).
    expect(names()).toEqual(['BUEN FIN', 'REGRESO']);
    // Dos clics → descendente.
    const header = screen.getByRole('button', { name: 'Campaña' });
    await userEvent.click(header);
    await userEvent.click(header);
    expect(names()).toEqual(['REGRESO', 'BUEN FIN']);
  });

  it('solo las campañas terminadas ofrecen "Marcar todas"', async () => {
    const FIN = campaign({
      id: 'f',
      name: 'TERMINADA',
      nameKey: 'terminada',
      fechaInicio: dayOffset(-40),
      fechaFin: dayOffset(-30),
    });
    const FUT = campaign({
      id: 'u2',
      name: 'FUTURA',
      nameKey: 'futura',
      fechaInicio: dayOffset(30),
      fechaFin: dayOffset(40),
    });
    vi.mocked(listCampaigns).mockResolvedValue([FIN, FUT]);
    await renderAllPeriods();
    await screen.findByText('TERMINADA');
    const finRow = screen.getByText('TERMINADA').closest('tr')!;
    expect(
      within(finRow).getByRole('button', { name: 'Marcar todas' }),
    ).toBeInTheDocument();
    const futRow = screen.getByText('FUTURA').closest('tr')!;
    expect(
      within(futRow).queryByRole('button', { name: 'Marcar todas' }),
    ).not.toBeInTheDocument();
  });

  it('"Marcar todas" marca todos los indicadores de la campaña', async () => {
    vi.mocked(markAllChecks).mockResolvedValue({} as never);
    const FIN = campaign({
      id: 'f',
      name: 'TERMINADA',
      nameKey: 'terminada',
      fechaInicio: dayOffset(-40),
      fechaFin: dayOffset(-30),
      tipo: 'INSTITUCIONAL',
    });
    vi.mocked(listCampaigns).mockResolvedValue([FIN]);
    await renderAllPeriods();
    await screen.findByText('TERMINADA');
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas' }));
    await waitFor(() => expect(markAllChecks).toHaveBeenCalledTimes(1));
    expect(markAllChecks).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: campaignIdentity(FIN),
        classification: 'institutional',
      }),
    );
  });

  it('muestra el historial de comentarios al expandir', async () => {
    const track = addCommentPure(
      initialTracking(
        {
          campaignNameKey: campaignIdentity(INST),
          campaignName: 'BUEN FIN',
          classification: 'institutional',
          classificationSource: 'import-user',
          linkValid: true,
        },
        { uid: 'u1', email: 'a@b.mx' },
        1000,
      ),
      'c1',
      'Testigos revisados',
      { uid: 'u1', email: 'a@b.mx' },
      2000,
    );
    vi.mocked(listOperationalTracking).mockResolvedValue([track]);
    await renderAllPeriods();
    await screen.findByText('BUEN FIN');
    await userEvent.click(
      screen.getByRole('button', { name: 'Comentarios de BUEN FIN' }),
    );
    expect(screen.getByText('Testigos revisados')).toBeInTheDocument();
    expect(screen.getByText('a@b.mx')).toBeInTheDocument();
  });

  it('agrega un comentario desde el panel expandido', async () => {
    vi.mocked(addComment).mockResolvedValue({} as never);
    await renderAllPeriods();
    await screen.findByText('BUEN FIN');
    await userEvent.click(
      screen.getByRole('button', { name: 'Comentarios de BUEN FIN' }),
    );
    await userEvent.type(
      screen.getByLabelText('Nuevo comentario para BUEN FIN'),
      'Revisado',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Agregar' }));
    await waitFor(() => expect(addComment).toHaveBeenCalledTimes(1));
    expect(addComment).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: campaignIdentity(INST),
        text: 'Revisado',
      }),
    );
  });
});

describe('OperationalTrackingPage — filtro de periodo', () => {
  it('por defecto solo muestra campañas dentro de la ventana de 3 meses', async () => {
    const IN = campaign({
      id: 'in',
      name: 'EN VENTANA',
      nameKey: 'en ventana',
      fechaInicio: dayOffset(0),
      fechaFin: dayOffset(5),
    });
    const OUT = campaign({
      id: 'out',
      name: 'LEJANA',
      nameKey: 'lejana',
      fechaInicio: dayOffset(200),
      fechaFin: dayOffset(210),
    });
    vi.mocked(listCampaigns).mockResolvedValue([IN, OUT]);
    renderPage();
    // La campaña vigente aparece; la lejana queda fuera de la ventana.
    await screen.findByText('EN VENTANA');
    expect(screen.queryByText('LEJANA')).not.toBeInTheDocument();

    // "Ver todo" revela la lejana…
    await userEvent.click(screen.getByRole('button', { name: 'Ver todo' }));
    expect(await screen.findByText('LEJANA')).toBeInTheDocument();

    // …y "Restablecer" vuelve a la ventana por defecto (la oculta).
    await userEvent.click(screen.getByRole('button', { name: 'Restablecer' }));
    await waitFor(() =>
      expect(screen.queryByText('LEJANA')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('EN VENTANA')).toBeInTheDocument();
  });

  it('permite filtrar por un rango de fechas personalizado', async () => {
    // Fixtures por defecto: INST/UNK en mayo 2026 (fuera de la ventana actual).
    renderPage();
    // Con el rango a mayo 2026 aparecen.
    fireEvent.change(screen.getByLabelText('Periodo desde'), {
      target: { value: '2026-05-01' },
    });
    fireEvent.change(screen.getByLabelText('Periodo hasta'), {
      target: { value: '2026-05-31' },
    });
    expect(await screen.findByText('BUEN FIN')).toBeInTheDocument();
    expect(screen.getByText('REGRESO')).toBeInTheDocument();
  });

  it('valida el rango invertido (Desde posterior a Hasta)', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Periodo desde'), {
      target: { value: '2026-09-01' },
    });
    fireEvent.change(screen.getByLabelText('Periodo hasta'), {
      target: { value: '2026-01-01' },
    });
    expect(
      await screen.findByText(/no puede ser posterior/i),
    ).toBeInTheDocument();
  });
});
