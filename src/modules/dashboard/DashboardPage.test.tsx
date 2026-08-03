import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { AdmiraScreen } from '@/domain';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/campaignOperationalTracking', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/campaignOperationalTracking')
  >('@/services/campaignOperationalTracking');
  return { ...actual, listOperationalTracking: vi.fn() };
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
    fechaInicio: over.fechaInicio ?? '2020-01-01',
    fechaFin: over.fechaFin ?? '2020-01-20',
    mes: 'Enero',
    link: over.link ?? '',
    supports: [],
    ...over,
  };
}

beforeEach(() => {
  // Campaña terminada, sin link y con testigos pendientes → alerta crítica.
  vi.mocked(listCampaigns).mockResolvedValue([
    campaign({ name: 'VIEJA', nameKey: 'vieja', tipo: 'PROVEEDOR' }),
  ]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
});

// --- Utilidades para la sección de carga (fechas relativas a hoy) ------------

function dayOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function scr(o: {
  id: string;
  numero: string;
  calendarSupport: string;
  nombre?: string;
}): AdmiraScreen {
  return {
    id: o.id,
    original: {
      'TIPO DE pantallas': '',
      CENTROS: '',
      CIRCUITO: '',
      RESOLUCION: '',
      FORMATO: '',
      'Nombre en plataforma': '',
      'TIPO DE PASES': '',
      'Numero de Tienda': o.numero,
      'Nombre de tienda': o.nombre ?? 'Tienda',
      Modelo: '',
      ARTICULOS: '',
      BRANDS: '',
    },
    metadata: {
      active: true,
      createdAt: 0,
      updatedAt: 0,
      createdBy: '',
      updatedBy: '',
      source: '',
      sourceSheet: '',
      sourceRow: 0,
      deactivationReason: null,
      version: 1,
      calendarSupport: o.calendarSupport,
    },
  };
}

function withOccupancyData() {
  vi.mocked(listCampaigns).mockResolvedValue([
    campaign({
      name: 'BUEN FIN',
      nameKey: 'buen fin',
      tipo: 'INSTITUCIONAL',
      fechaInicio: dayOffset(-1),
      fechaFin: dayOffset(10),
      supports: [
        {
          support: 'VIDEO WALL CRIUS',
          owner: 'liverpool',
          stores: [{ numero: '5', nombre: 'Polanco' }],
        },
      ],
    }),
  ]);
  vi.mocked(listScreens).mockResolvedValue([
    scr({
      id: 'a',
      numero: '5',
      calendarSupport: 'VIDEO WALL CRIUS',
      nombre: 'Polanco 03',
    }),
  ]);
}

function renderDash() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage — resumen operativo', () => {
  it('muestra alertas críticas con enlace a Seguimiento', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    // La campaña vencida aparece como alerta con enlace a Seguimiento.
    const links = await screen.findAllByRole('link', { name: 'VIEJA' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/seguimiento?campana=vieja');
  });

  it('siempre muestra las tarjetas de módulos', async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: /Módulos/i }),
    ).toBeInTheDocument();
  });

  it('muestra un mensaje si falla la carga', async () => {
    vi.mocked(listCampaigns).mockRejectedValue(new Error('x'));
    renderDash();
    expect(
      await screen.findByText(/No se pudo cargar el resumen operativo/i),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage — carga por tienda y soporte', () => {
  beforeEach(withOccupancyData);

  it('renderiza tarjetas, gráficas y clasificación', async () => {
    renderDash();
    expect(
      await screen.findByRole('heading', {
        name: /Carga por tienda y soporte/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Tienda con mayor carga')).toBeInTheDocument();
    expect(screen.getByText('Soporte con mayor carga')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Soportes con mayor carga/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Tiendas con mayor carga/i }),
    ).toBeInTheDocument();
    // Clasificación por texto (no solo color): leyenda + chip.
    expect(screen.getAllByText('Institucional').length).toBeGreaterThan(0);
  });

  it('las barras exponen aria-label con el pico (accesibilidad)', async () => {
    renderDash();
    await screen.findByRole('heading', { name: /Soportes con mayor carga/i });
    expect(
      screen.getByRole('button', {
        name: /^VIDEO WALL CRIUS\. Pico 1 campañas simultáneas/i,
      }),
    ).toBeInTheDocument();
  });

  it('abre el detalle de un soporte con enlace a Seguimiento', async () => {
    renderDash();
    const bar = await screen.findByRole('button', {
      name: /^VIDEO WALL CRIUS\. .*Ver detalle/i,
    });
    await userEvent.click(bar);
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByRole('link', { name: 'BUEN FIN' });
    expect(link).toHaveAttribute('href', '/seguimiento?campana=buen%20fin');
  });

  it('abre el detalle de una tienda', async () => {
    renderDash();
    const bar = await screen.findByRole('button', {
      name: /^Polanco 03, tienda 5\./i,
    });
    await userEvent.click(bar);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('cambiar el periodo (rango personalizado futuro) recalcula y vacía', async () => {
    renderDash();
    await screen.findByRole('heading', { name: /Carga por tienda y soporte/i });
    await userEvent.selectOptions(screen.getByLabelText('Periodo'), 'custom');
    await userEvent.type(screen.getByLabelText('Desde'), '2030-01-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2030-01-31');
    expect(
      await screen.findByText(/Sin campañas en el periodo/i),
    ).toBeInTheDocument();
  });

  it('filtrar por clasificación Proveedor deja sin datos a una campaña institucional', async () => {
    renderDash();
    await screen.findByRole('heading', { name: /Carga por tienda y soporte/i });
    await userEvent.selectOptions(
      screen.getByLabelText('Clasificación'),
      'provider',
    );
    expect(
      await screen.findByText(/Sin campañas en el periodo/i),
    ).toBeInTheDocument();
  });

  it('tiene botón Actualizar', async () => {
    renderDash();
    expect(
      await screen.findByRole('button', { name: /Actualizar/i }),
    ).toBeInTheDocument();
  });

  it('estado vacío cuando no hay campañas', async () => {
    vi.mocked(listCampaigns).mockResolvedValue([]);
    renderDash();
    expect(
      await screen.findByText(/Aún no hay campañas\. Importa el calendario/i),
    ).toBeInTheDocument();
  });
});
