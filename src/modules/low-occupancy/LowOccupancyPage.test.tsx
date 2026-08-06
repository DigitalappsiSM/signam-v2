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
import { LowOccupancyPage } from './LowOccupancyPage';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { UserRole } from '@/domain';

const authState = {
  user: {
    uid: 'u1',
    email: 'admin@signam.mx',
    displayName: null as string | null,
    role: 'admin' as UserRole,
  },
  loading: false,
  configured: true,
};

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => authState,
}));

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));

vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

function screenOf(
  id: string,
  original: Partial<AdmiraScreenOriginal>,
  calendarSupport: string,
  active = true,
): AdmiraScreen {
  return {
    id,
    original: { ...emptyOriginal(), ...original },
    metadata: {
      ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
      active,
      calendarSupport,
    },
  };
}

function campaignOf(
  name: string,
  support: string,
  ...stores: string[]
): StoredCampaign {
  return {
    id: name,
    row: 2,
    name,
    nameKey: name.toLowerCase(),
    signature: 'sig',
    tipo: 'ISM/PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '2026-08-01',
    fechaFin: '2026-08-31',
    mes: '',
    link: '',
    supports: [
      {
        support,
        owner: 'liverpool',
        stores: stores.map((numero) => ({ numero, nombre: '' })),
      },
    ],
  };
}

const SCREENS: AdmiraScreen[] = [
  screenOf(
    't1',
    {
      'Numero de Tienda': '1',
      RESOLUCION: 'R',
      ARTICULOS: 'A',
      CENTROS: 'C1',
      'Nombre de tienda': 'Tienda Uno',
      'TIPO DE PASES': 'PASES FULL',
    },
    'LED',
  ),
  screenOf(
    't2a',
    { 'Numero de Tienda': '2', RESOLUCION: 'R', ARTICULOS: 'X', CENTROS: 'C2' },
    'LED',
  ),
  screenOf(
    't2b',
    { 'Numero de Tienda': '2', RESOLUCION: 'R', ARTICULOS: 'Y', CENTROS: 'C2' },
    'LED',
  ),
  screenOf(
    't2c',
    { 'Numero de Tienda': '2', RESOLUCION: 'R', ARTICULOS: 'Z', CENTROS: 'C2' },
    'LED',
  ),
  screenOf(
    't4',
    {
      'Numero de Tienda': '4',
      RESOLUCION: 'R2',
      ARTICULOS: 'Q',
      CENTROS: 'C4',
    },
    'APARADOR',
  ),
];

const CAMPAIGNS: StoredCampaign[] = [
  campaignOf('Camp1', 'LED', '1'),
  campaignOf('Camp2', 'LED', '2'),
];

function renderPage(date = '2026-08-15') {
  return render(
    <MemoryRouter initialEntries={[`/alertas-ocupacion?fecha=${date}`]}>
      <LowOccupancyPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.user = {
    uid: 'u1',
    email: 'admin@signam.mx',
    displayName: null,
    role: 'admin',
  };
  vi.mocked(listCampaigns).mockReset().mockResolvedValue(CAMPAIGNS);
  vi.mocked(listScreens).mockReset().mockResolvedValue(SCREENS);
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('LowOccupancyPage — carga y resumen', () => {
  it('muestra la carga inicial y luego el resumen', async () => {
    renderPage();
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument();
    await screen.findByText('Total de unidades');
    const summary = screen.getByLabelText('Resumen del análisis de ocupación');
    // 3 unidades: store1 (1), store2 (3), store4 (0).
    expect(
      within(summary).getByText('Total de unidades').previousSibling,
    ).toHaveTextContent('3');
  });

  it('muestra un error si falla la carga', async () => {
    vi.mocked(listCampaigns).mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /No se pudieron cargar/i,
    );
  });

  it('recalcula al pulsar Recalcular', async () => {
    renderPage();
    await screen.findByText('Total de unidades');
    expect(listCampaigns).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /Recalcular/i }));
    await waitFor(() => expect(listCampaigns).toHaveBeenCalledTimes(2));
  });
});

describe('LowOccupancyPage — tabla, filtros y detalle', () => {
  it('lista las unidades evaluadas', async () => {
    renderPage();
    await screen.findByText('Tienda Uno');
    const rows = screen.getAllByRole('row');
    // encabezado + 3 unidades
    expect(rows).toHaveLength(4);
  });

  it('filtra por ratio recomendado', async () => {
    renderPage();
    await screen.findByText('Tienda Uno');
    await userEvent.selectOptions(
      screen.getByLabelText('Filtrar por ratio recomendado'),
      '1',
    );
    await waitFor(() =>
      expect(screen.getByText('1 de 3 unidades')).toBeInTheDocument(),
    );
  });

  it('abre el detalle con los contenidos deduplicados', async () => {
    renderPage();
    await screen.findByText('Tienda Uno');
    // La fila de la tienda 2 (3 proveedores).
    const cell = screen.getByText('C2');
    const row = cell.closest('tr')!;
    await userEvent.click(
      within(row).getByRole('button', { name: /Ver detalle/i }),
    );
    const dialog = await screen.findByRole('dialog');
    // Tres contenidos de la misma campaña (X, Y, Z).
    expect(within(dialog).getAllByText('Camp2')).toHaveLength(3);
    expect(within(dialog).getByText('X')).toBeInTheDocument();
    expect(within(dialog).getByText('Y')).toBeInTheDocument();
    expect(within(dialog).getByText('Z')).toBeInTheDocument();
  });
});

describe('LowOccupancyPage — exportaciones', () => {
  function groupCard(title: RegExp) {
    return screen.getByText(title).closest('article')!;
  }

  it('descarga el CSV Ratio 1 con el nombre correcto', async () => {
    const origCreate = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    const spy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'a') anchors.push(el as HTMLAnchorElement);
        return el;
      });
    try {
      renderPage();
      await screen.findByText(/LED · R/);
      const card = groupCard(/LED · R/);
      const btn = within(card)
        .getAllByRole('button', { name: /Descargar CSV/i })
        .find((b) => !(b as HTMLButtonElement).disabled)!;
      await userEvent.click(btn);
      const anchor = anchors[anchors.length - 1]!;
      expect(anchor.download).toBe(
        'LED_R_RATIO_1_ANALISIS_2026-08-15_GENERADO_' +
          anchor.download.split('GENERADO_')[1],
      );
      expect(anchor.download).toContain('RATIO_1');
    } finally {
      spy.mockRestore();
    }
  });

  it('deshabilita la descarga cuando no hay filas', async () => {
    renderPage();
    await screen.findByText(/APARADOR · R2/);
    const card = groupCard(/APARADOR · R2/);
    expect(
      within(card).getByRole('button', { name: /Sin pantallas para Ratio 1/i }),
    ).toBeDisabled();
    expect(
      within(card).getByRole('button', { name: /Sin pantallas para Ratio 3/i }),
    ).toBeDisabled();
  });

  it('respeta el permiso de exportación (viewer no ve botones de descarga)', async () => {
    authState.user = {
      uid: 'v1',
      email: 'viewer@signam.mx',
      displayName: null,
      role: 'viewer',
    };
    renderPage();
    await screen.findByText(/LED · R/);
    expect(
      screen.getAllByText(/Sin permiso de exportación/i).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: /Descargar CSV/i }),
    ).not.toBeInTheDocument();
  });
});

describe('LowOccupancyPage — fecha', () => {
  it('toma la fecha del parámetro ?fecha=', async () => {
    renderPage('2026-08-20');
    await screen.findByText('Total de unidades');
    expect(screen.getByLabelText('Fecha de análisis')).toHaveValue(
      '2026-08-20',
    );
  });

  it('recalcula al cambiar la fecha fuera de vigencia', async () => {
    renderPage('2026-08-15');
    await screen.findByText('Tienda Uno');
    // Cambia a una fecha sin campañas vigentes → todas las unidades a 0.
    const input = screen.getByLabelText('Fecha de análisis');
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    await waitFor(() => {
      const summary = screen.getByLabelText(
        'Resumen del análisis de ocupación',
      );
      // Las 3 unidades quedan sin ocupación.
      expect(
        within(summary).getByText('Sin ocupación (0)').previousSibling,
      ).toHaveTextContent('3');
    });
  });
});
