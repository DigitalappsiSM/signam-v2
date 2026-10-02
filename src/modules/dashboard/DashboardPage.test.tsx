import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';
import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { AdmiraScreen } from '@/domain';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';
import { listStoreDirectory } from '@/services/storeDirectory';
import { getControlCenterSnapshot } from '@/services/controlCenter';

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/storeDirectory', () => ({
  listStoreDirectory: vi.fn(),
}));
vi.mock('@/services/controlCenter', () => ({
  getControlCenterSnapshot: vi.fn(),
}));
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

const VIEJA = campaign({ name: 'VIEJA', nameKey: 'vieja', tipo: 'PROVEEDOR' });

beforeEach(() => {
  // Campaña terminada, sin link y con testigos pendientes → alerta crítica.
  vi.mocked(listCampaigns).mockResolvedValue([VIEJA]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
  vi.mocked(listStoreDirectory).mockResolvedValue([]);
  vi.mocked(getControlCenterSnapshot).mockResolvedValue({
    generatedAt: '2026-10-01T00:00:00Z',
    tickets: [],
    cameras: [],
    camerasLatestDate: null,
    warnings: [],
  });
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

function renderDash(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <DashboardPage />
    </MemoryRouter>,
  );
}

// El Centro de Control reúne todo en una sola vista (sin pestañas): esto
// espera a que la sección indicada esté presente antes de buscar su contenido.
async function goTo(view: 'Seguimiento' | 'Carga') {
  await screen.findByRole('heading', {
    name: view === 'Seguimiento' ? /Atención operativa/i : /Carga por tienda/i,
  });
}

// Periodo que intersecta la vigencia de VIEJA (campaña de 2020). El periodo por
// defecto es "Hoy", que excluiría al histórico; estas rutas lo vuelven visible.
const VIEJA_ROUTE = '/?periodo=custom&desde=2020-01-01&hasta=2020-12-31';

describe('DashboardPage — resumen operativo', () => {
  it('presenta KPIs con semáforo, estado textual y acciones rápidas', async () => {
    renderDash(VIEJA_ROUTE);

    const summary = await screen.findByLabelText('Resumen de campañas activas');
    expect(
      within(summary).getByLabelText(/Campañas activas: 0\. En ejecución/i),
    ).toHaveClass('dash-tile--info');
    expect(
      within(summary).getByLabelText(/Vencidas con pendientes: 1\. Urgente/i),
    ).toHaveClass('dash-tile--danger');

    const actionsTitle = screen.getByRole('heading', {
      name: /Acciones rápidas/i,
    });
    const actions = actionsTitle.closest('section');
    expect(actions).not.toBeNull();
    expect(
      within(actions!).getByRole('link', { name: /Seguimiento operativo/i }),
    ).toHaveAttribute('href', '/seguimiento');
    expect(
      within(actions!).getByRole('link', { name: /Importar Calendario/i }),
    ).toHaveAttribute('href', '/importar');
  });

  it('reúne mapa, semáforo, prioridades, estados y carga en una sola vista', async () => {
    renderDash(VIEJA_ROUTE);
    await screen.findByRole('region', { name: 'Atención inmediata' });
    expect(
      screen.getByRole('region', { name: 'Centro de Control' }),
    ).toBeInTheDocument();
    for (const name of [
      /Semáforo operativo/i,
      /Carga diaria/i,
      /Atención operativa/i,
      /Estados de campaña/i,
      /Carga por tienda/i,
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    // El selector de retailer se conserva; las pestañas Hoy/Seguimiento/Carga no.
    expect(screen.getByRole('tab', { name: 'Liverpool' })).toBeInTheDocument();
    expect(
      screen.queryByRole('tab', { name: 'Seguimiento' }),
    ).not.toBeInTheDocument();
  });

  it('marca atención inmediata cuando hay terminadas con pendientes', async () => {
    renderDash(VIEJA_ROUTE);
    expect(
      await screen.findByLabelText(/Estado operativo: Atención inmediata/i),
    ).toHaveClass('dashboard-health--danger');
  });

  it('no degrada la salud por campañas futuras ni por próximos vencimientos preventivos', async () => {
    const ACTIVA = campaign({
      id: 'activa',
      name: 'ACTIVA',
      nameKey: 'activa',
      tipo: 'INSTITUCIONAL',
      fechaInicio: dayOffset(-1),
      fechaFin: dayOffset(1),
      link: 'https://example.com',
    });
    const FUTURA = campaign({
      id: 'futura',
      name: 'FUTURA',
      nameKey: 'futura',
      tipo: 'PROVEEDOR',
      fechaInicio: dayOffset(3),
      fechaFin: dayOffset(10),
    });

    vi.mocked(listCampaigns).mockResolvedValue([ACTIVA, FUTURA]);
    vi.mocked(listOperationalTracking).mockResolvedValue([
      {
        campaignId: ACTIVA.id,
        campaignNameKey: campaignIdentity(ACTIVA),
        classification: 'institutional',
        liverpoolValidated: true,
        csmProgrammed: true,
      } as unknown as Awaited<
        ReturnType<typeof listOperationalTracking>
      >[number],
    ]);

    renderDash();

    const health = await screen.findByLabelText(/Estado operativo: Operación al día/i);
    expect(health).toHaveClass('dashboard-health--success');
    expect(within(health).getByText('100%')).toBeInTheDocument();
  });

  it('incluye terminadas con pendientes (sin testigo vencido) en el widget de Atención inmediata', async () => {
    // Institucional terminada: los testigos NO aplican (no hay "vencido" ni
    // "vence hoy"), pero queda con un check aplicable pendiente → alerta
    // crítica "Terminada con pendientes". La tarjeta de salud la marca en rojo;
    // el widget de Atención inmediata debe incluirla también (sin contradicción).
    const INSTIT = campaign({
      name: 'INSTIT',
      nameKey: 'instit',
      tipo: 'INSTITUCIONAL',
      fechaInicio: '2020-03-01',
      fechaFin: '2020-03-20',
    });
    vi.mocked(listCampaigns).mockResolvedValue([INSTIT]);
    const { container } = renderDash(VIEJA_ROUTE);

    // Salud operativa en rojo por la terminada con pendientes.
    expect(
      await screen.findByLabelText(/Estado operativo: Atención inmediata/i),
    ).toHaveClass('dashboard-health--danger');

    // El widget NO debe quedar vacío ("en calma") y debe enlazar la campaña.
    const urgent = container.querySelector('.dashboard-urgent');
    expect(urgent).not.toBeNull();
    expect(urgent).not.toHaveClass('dashboard-urgent--clear');
    expect(
      within(urgent as HTMLElement).getByRole('link', { name: 'INSTIT' }),
    ).toBeInTheDocument();
  });

  it('muestra alertas críticas con enlace a Seguimiento', async () => {
    renderDash(VIEJA_ROUTE);
    // La campaña vencida aparece como alerta con enlace a Seguimiento.
    const links = await screen.findAllByRole('link', { name: 'VIEJA' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute(
      'href',
      `/seguimiento?campana=${encodeURIComponent(campaignIdentity(VIEJA))}`,
    );
  });

  it('el Centro de Control sigue en pie si Odoo y el directorio fallan', async () => {
    vi.mocked(listStoreDirectory).mockRejectedValue(new Error('x'));
    vi.mocked(getControlCenterSnapshot).mockRejectedValue(new Error('x'));
    renderDash(VIEJA_ROUTE);
    const cc = await screen.findByRole('region', { name: 'Centro de Control' });
    expect(
      within(cc).getByRole('button', { name: /Campañas al aire/i }),
    ).toBeInTheDocument();
    expect(
      await within(cc).findByText(/No se pudo leer el directorio de tiendas/i),
    ).toBeInTheDocument();
    expect(
      within(cc).getByText(/No se pudieron leer incidencias ni audiencias/i),
    ).toBeInTheDocument();
  });

  it('muestra un mensaje si falla la carga', async () => {
    vi.mocked(listCampaigns).mockRejectedValue(new Error('x'));
    renderDash();
    expect(
      await screen.findByText(/No se pudo cargar el resumen operativo/i),
    ).toBeInTheDocument();
  });

  it('una campaña cancelada NO aparece en las alertas del resumen operativo', async () => {
    // VIEJA (proveedor, terminada, sin link) sería alerta crítica; cancelada,
    // debe desaparecer por completo del resumen operativo superior.
    vi.mocked(listOperationalTracking).mockResolvedValue([
      {
        campaignNameKey: campaignIdentity(VIEJA),
        classification: 'provider',
        lifecycleStatus: 'cancelled',
      } as unknown as Awaited<
        ReturnType<typeof listOperationalTracking>
      >[number],
    ]);
    renderDash(VIEJA_ROUTE);
    await goTo('Seguimiento');
    // Ya no hay enlaces a VIEJA en el resumen (alertas/terminadas con pendientes).
    const attention = await screen.findByRole('region', {
      name: /Atención operativa/i,
    });
    expect(
      within(attention).queryByRole('link', { name: 'VIEJA' }),
    ).not.toBeInTheDocument();
    // Aparece, en cambio, en «Estados de campaña» → Canceladas.
    const cancelled = await screen.findByRole('region', {
      name: 'Canceladas',
    });
    expect(
      within(cancelled).getByRole('link', { name: 'VIEJA' }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'En pausa' })).queryByRole(
        'link',
        { name: 'VIEJA' },
      ),
    ).not.toBeInTheDocument();
  });

  it('una campaña en pausa sale del resumen y aparece en «En pausa»', async () => {
    vi.mocked(listOperationalTracking).mockResolvedValue([
      {
        campaignNameKey: campaignIdentity(VIEJA),
        classification: 'provider',
        lifecycleStatus: 'paused',
        statusReason: {
          code: 'provider-request',
          label: 'Solicitud del proveedor',
          detail: null,
        },
      } as unknown as Awaited<
        ReturnType<typeof listOperationalTracking>
      >[number],
    ]);
    renderDash(VIEJA_ROUTE);
    await goTo('Seguimiento');
    const attention = await screen.findByRole('region', {
      name: /Atención operativa/i,
    });
    expect(
      within(attention).queryByRole('link', { name: 'VIEJA' }),
    ).not.toBeInTheDocument();
    const paused = await screen.findByRole('region', { name: 'En pausa' });
    expect(
      within(paused).getByRole('link', { name: 'VIEJA' }),
    ).toBeInTheDocument();
    expect(
      within(paused).getByText(/Solicitud del proveedor/),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage — periodo predeterminado', () => {
  it('sin parámetros en la URL selecciona "Mes actual"', async () => {
    renderDash();
    const periodo = (await screen.findByLabelText(
      'Periodo',
    )) as HTMLSelectElement;
    expect(periodo.value).toBe('this-month');
  });

  it('respeta periodo=today explícito en la URL', async () => {
    render(
      <MemoryRouter initialEntries={['/?periodo=today']}>
        <DashboardPage />
      </MemoryRouter>,
    );
    const periodo = (await screen.findByLabelText(
      'Periodo',
    )) as HTMLSelectElement;
    expect(periodo.value).toBe('today');
  });

  it('no ofrece un preset de año completo', async () => {
    renderDash();
    const periodo = (await screen.findByLabelText(
      'Periodo',
    )) as HTMLSelectElement;
    const labels = Array.from(periodo.options).map((o) => o.textContent ?? '');
    expect(labels).toEqual([
      'Hoy',
      'Semana actual',
      'Próximos 7 días',
      'Mes actual',
      'Próximos 30 días',
      'Rango personalizado',
    ]);
    expect(labels.some((l) => /a[ñn]o/i.test(l))).toBe(false);
  });
});

describe('DashboardPage — filtros globales y detalle de KPI', () => {
  it('con periodo Hoy (por defecto) una campaña histórica no cuenta como urgente', async () => {
    renderDash();
    const summary = await screen.findByLabelText('Resumen de campañas activas');
    expect(
      within(summary).getByLabelText(/Vencidas con pendientes: 0\./i),
    ).toBeInTheDocument();
    // La histórica de 2020 no aparece en el resumen con periodo Hoy.
    expect(
      screen.queryByRole('link', { name: 'VIEJA' }),
    ).not.toBeInTheDocument();
  });

  it('la campaña histórica reaparece al elegir un periodo que intersecta su vigencia', async () => {
    renderDash(VIEJA_ROUTE);
    const summary = await screen.findByLabelText('Resumen de campañas activas');
    expect(
      within(summary).getByLabelText(/Vencidas con pendientes: 1\. Urgente/i),
    ).toBeInTheDocument();
  });

  it('una campaña vigente con indicadores vencidos aparece como urgente con periodo Hoy', async () => {
    vi.mocked(listCampaigns).mockResolvedValue([
      campaign({
        name: 'ACTUAL',
        nameKey: 'actual',
        tipo: 'PROVEEDOR',
        fechaInicio: dayOffset(-15),
        fechaFin: dayOffset(15),
      }),
    ]);
    renderDash();
    const summary = await screen.findByLabelText('Resumen de campañas activas');
    expect(
      within(summary).getByLabelText(/Vencidas con pendientes: 1\. Urgente/i),
    ).toBeInTheDocument();
  });

  it('al pulsar una tarjeta se abre su detalle flotante con el conteo y enlace a Seguimiento', async () => {
    renderDash(VIEJA_ROUTE);
    const card = await screen.findByLabelText(
      /Vencidas con pendientes: 1\. Urgente\. Ver detalle/i,
    );
    await userEvent.click(card);
    const detail = await screen.findByRole('dialog', {
      name: 'Vencidas con pendientes',
    });
    expect(
      within(detail).getByText(/1 campaña · Periodo/i),
    ).toBeInTheDocument();
    const link = within(detail).getByRole('link', { name: 'VIEJA' });
    expect(link).toHaveAttribute(
      'href',
      `/seguimiento?campana=${encodeURIComponent(campaignIdentity(VIEJA))}`,
    );
    // Ventana flotante: no abre espacio bajo la tarjeta y cierra con Escape.
    expect(
      screen.getByLabelText('Resumen de campañas activas'),
    ).not.toContainElement(detail);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('cambiar la clasificación recalcula tarjetas y el detalle abierto', async () => {
    renderDash(VIEJA_ROUTE);
    const card = await screen.findByLabelText(
      /Vencidas con pendientes: 1\. Urgente\. Ver detalle/i,
    );
    await userEvent.click(card);
    // VIEJA es Proveedor; filtrar por Institucional la deja fuera.
    await userEvent.selectOptions(
      screen.getByLabelText('Clasificación'),
      'institutional',
    );
    const detail = await screen.findByRole('dialog', {
      name: 'Vencidas con pendientes',
    });
    expect(
      within(detail).getByText(/Ninguna campaña coincide/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Vencidas con pendientes: 0\./i),
    ).toBeInTheDocument();
  });

  it('permite escribir varias letras en la búsqueda con el detalle abierto', async () => {
    renderDash(VIEJA_ROUTE);
    const card = await screen.findByLabelText(
      /Vencidas con pendientes: 1\. Urgente\. Ver detalle/i,
    );
    await userEvent.click(card);
    const input = screen.getByLabelText('Buscar campaña');
    await userEvent.type(input, 'VIE');
    // El foco no se robó tras la primera letra: el texto completo se conservó.
    expect(input).toHaveValue('VIE');
    const detail = await screen.findByRole('dialog', {
      name: 'Vencidas con pendientes',
    });
    expect(
      within(detail).getByRole('link', { name: 'VIEJA' }),
    ).toBeInTheDocument();
  });

  it('buscar por nombre limita las tarjetas', async () => {
    renderDash(VIEJA_ROUTE);
    const summary = await screen.findByLabelText('Resumen de campañas activas');
    expect(
      within(summary).getByLabelText(/Vencidas con pendientes: 1\./i),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Buscar campaña'), 'NO EXISTE');
    expect(
      await screen.findByLabelText(/Vencidas con pendientes: 0\./i),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage — carga por tienda y soporte', () => {
  beforeEach(withOccupancyData);

  it('renderiza tarjetas, gráficas y clasificación', async () => {
    renderDash();
    await goTo('Carga');
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
    expect(
      screen.getByRole('heading', { name: /Mezcla por clasificación/i }),
    ).toBeInTheDocument();
    // Clasificación por texto (no solo color): leyenda + chip.
    expect(screen.getAllByText('Institucional').length).toBeGreaterThan(0);
  });

  it('muestra las gráficas ECharts (área diaria y dona) accesibles', async () => {
    renderDash();
    // Carga diaria vive en Hoy (por defecto); el lienzo ECharts se difiere,
    // el contenedor accesible siempre está.
    expect(
      await screen.findByRole('img', { name: /Campañas simultáneas por día/i }),
    ).toBeInTheDocument();

    // Mezcla por clasificación vive en Carga.
    await goTo('Carga');
    expect(
      await screen.findByRole('img', { name: /Campañas por clasificación/i }),
    ).toBeInTheDocument();
  });

  it('las barras exponen aria-label con el pico (accesibilidad)', async () => {
    renderDash();
    await goTo('Carga');
    await screen.findByRole('heading', { name: /Soportes con mayor carga/i });
    expect(
      screen.getByRole('button', {
        name: /^VIDEO WALL CRIUS\. Pico 1 campañas simultáneas/i,
      }),
    ).toBeInTheDocument();
  });

  it('abre el detalle de un soporte con enlace a Seguimiento', async () => {
    renderDash();
    await goTo('Carga');
    const bar = await screen.findByRole('button', {
      name: /^VIDEO WALL CRIUS\. .*Ver detalle/i,
    });
    await userEvent.click(bar);
    const dialog = await screen.findByRole('dialog');
    const link = within(dialog).getByRole('link', { name: 'BUEN FIN' });
    expect(link).toHaveAttribute('href', '/seguimiento?campana=id');
  });

  it('abre el detalle de una tienda', async () => {
    renderDash();
    await goTo('Carga');
    const bar = await screen.findByRole('button', {
      name: /^Polanco 03, tienda 5\./i,
    });
    await userEvent.click(bar);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('cambiar el periodo (rango personalizado futuro) recalcula y vacía', async () => {
    renderDash();
    // Carga diaria (Hoy, por defecto) refleja el mismo filtro de periodo.
    await screen.findByRole('heading', { name: /Carga diaria/i });
    await userEvent.selectOptions(screen.getByLabelText('Periodo'), 'custom');
    await userEvent.type(screen.getByLabelText('Desde'), '2030-01-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2030-01-31');
    expect(
      await screen.findByText(/Sin campañas en el periodo/i),
    ).toBeInTheDocument();
  });

  it('filtrar por clasificación Proveedor deja sin datos a una campaña institucional', async () => {
    renderDash();
    await screen.findByRole('heading', { name: /Carga diaria/i });
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
    await goTo('Carga');
    expect(
      await screen.findByText(/Aún no hay campañas\. Importa el calendario/i),
    ).toBeInTheDocument();
  });
});
