import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CampaignsPage } from './CampaignsPage';
import { todayIsoDate } from '@/modules/low-occupancy/occupancyAnalysis';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from './campaignDiff';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  listEkonLinks,
  saveEkonLink,
  unlinkEkon,
} from '@/services/campaignEkonLinks';
import {
  consolidate,
  type Consolidation,
  type ConsolidationIssue,
} from '@/modules/consolidation/consolidate';
import { buildZip } from '@/modules/exports/csvExport';
import {
  buildCampaignPptPlan,
  buildCampaignPpt,
} from '@/modules/exports/pptExport';
import { buildCampaignReport } from '@/modules/exports/campaignReport';
import { buildCampaignReportBlob } from '@/modules/exports/campaignExcelExport';

vi.mock('@/modules/exports/pptExport', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/exports/pptExport')
  >('@/modules/exports/pptExport');
  return {
    ...actual,
    buildCampaignPptPlan: vi.fn(),
    buildCampaignPpt: vi.fn(),
  };
});

vi.mock('@/modules/consolidation/consolidate', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/consolidation/consolidate')
  >('@/modules/consolidation/consolidate');
  return { ...actual, consolidate: vi.fn() };
});

vi.mock('@/modules/exports/csvExport', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/exports/csvExport')
  >('@/modules/exports/csvExport');
  return { ...actual, buildZip: vi.fn() };
});

vi.mock('@/modules/exports/campaignReport', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/exports/campaignReport')
  >('@/modules/exports/campaignReport');
  return { ...actual, buildCampaignReport: vi.fn(actual.buildCampaignReport) };
});

vi.mock('@/modules/exports/campaignExcelExport', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/exports/campaignExcelExport')
  >('@/modules/exports/campaignExcelExport');
  return { ...actual, buildCampaignReportBlob: vi.fn() };
});

// Evita que jsdom falle al "descargar" (no implementa createObjectURL) y no
// intenta navegar al hacer click en el enlace temporal.
vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: {
      uid: 'u1',
      email: 'admin@signam.mx',
      displayName: null,
      role: 'admin',
    },
    loading: false,
    configured: true,
  }),
}));

vi.mock('@/services/campaigns', () => ({ listCampaigns: vi.fn() }));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/campaignEkonLinks', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/campaignEkonLinks')
  >('@/services/campaignEkonLinks');
  return {
    ...actual,
    listEkonLinks: vi.fn(),
    saveEkonLink: vi.fn(),
    unlinkEkon: vi.fn(),
  };
});

function campaign(over: Partial<StoredCampaign>): StoredCampaign {
  return {
    id: over.id ?? 'id',
    row: 1,
    name: over.name ?? 'CAMPAÑA',
    nameKey: over.nameKey ?? (over.name ?? 'campaña').toLowerCase(),
    signature: 'sig',
    tipo: 'Digital',
    vendidoPor: 'Liverpool',
    fechaInicio: over.fechaInicio ?? '2026-05-10',
    fechaFin: over.fechaFin ?? '2026-05-20',
    mes: 'Mayo',
    link: '',
    supports: [],
    ...over,
  };
}

const A = campaign({
  id: 'a',
  name: 'BUEN FIN',
  nameKey: 'buen fin',
  fechaInicio: '2026-05-10',
  fechaFin: '2026-05-20',
});
const B = campaign({
  id: 'b',
  name: 'REGRESO A CLASES',
  nameKey: 'regreso a clases',
  fechaInicio: '2026-08-01',
  fechaFin: '2026-08-10',
});

function cons(
  campaignName: string,
  resolution: string,
  rows: number,
): Consolidation {
  return {
    campaignName,
    resolution,
    admiraCampaignName: `${campaignName}_ ART`,
    articulos: 'ART',
    rows: Array.from({ length: rows }, () => ({
      ARTICULOS: 'ART',
      BRANDS: '',
      CENTROS: '',
      CIRCUITO: '',
      RESOLUCION: resolution,
      RETAILERS: 'LIVERPOOL',
      'TIPO DE PASES': '',
    })),
    screenIds: [],
    storeCount: rows,
  };
}

function issue(campaign: string): ConsolidationIssue {
  return {
    code: 'store-not-in-catalog',
    campaign,
    support: 'VIDEO WALL CRIUS',
    message: '',
  };
}

// Por defecto: BUEN FIN con 2 CSV y 3 incidencias; REGRESO A CLASES sin CSV.
function defaultConsolidation() {
  vi.mocked(consolidate).mockReturnValue({
    consolidations: [
      cons('BUEN FIN', '914 x 908', 9),
      cons('BUEN FIN', '1920 x 1080', 4),
    ],
    issues: [issue('BUEN FIN'), issue('BUEN FIN'), issue('BUEN FIN')],
    excludedInstore: [],
    ismExcludedCount: 0,
  });
}

beforeEach(() => {
  vi.mocked(listCampaigns).mockResolvedValue([A, B]);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listEkonLinks).mockResolvedValue([
    {
      id: 'k',
      campaignNameKey: 'buen fin',
      campaignName: 'BUEN FIN',
      ekonCampaignNumber: 777,
      createdAt: 1,
      createdBy: 'x',
      updatedAt: 1,
      updatedBy: 'x',
    },
  ]);
  vi.mocked(saveEkonLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(unlinkEkon).mockReset().mockResolvedValue(undefined);
  vi.mocked(buildZip)
    .mockReset()
    .mockResolvedValue(new Blob(['zip']));
  vi.mocked(consolidate).mockReset();
  defaultConsolidation();
  vi.mocked(buildCampaignPptPlan).mockReset().mockReturnValue({
    campaignName: 'BUEN FIN',
    startDate: '2026-05-10',
    endDate: '2026-05-20',
    slides: [],
    issues: [],
  });
  vi.mocked(buildCampaignPpt)
    .mockReset()
    .mockResolvedValue(new Blob(['pptx']));
  vi.mocked(buildCampaignReport).mockClear();
  vi.mocked(buildCampaignReportBlob)
    .mockReset()
    .mockResolvedValue(new Blob(['xlsx']));
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

describe('CampaignsPage — columna Ekon y filtros', () => {
  it('muestra la columna "# campaña Ekon" con el número o "—"', async () => {
    render(<CampaignsPage />);
    expect(
      await screen.findByRole('columnheader', { name: /# campaña Ekon/i }),
    ).toBeInTheDocument();

    const rowA = screen.getByText('BUEN FIN').closest('tr')!;
    expect(within(rowA).getByText('777')).toBeInTheDocument();

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    // La celda Ekon de B muestra "—".
    expect(within(rowB).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('filtra por el número Ekon completo o parcial', async () => {
    render(<CampaignsPage />);
    const searchInput = await screen.findByPlaceholderText(
      /Buscar por campaña o # Ekon/i,
    );

    await userEvent.type(searchInput, '77');
    expect(screen.getByText('BUEN FIN')).toBeInTheDocument();
    expect(screen.queryByText('REGRESO A CLASES')).not.toBeInTheDocument();

    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'regreso');
    expect(screen.queryByText('BUEN FIN')).not.toBeInTheDocument();
    expect(screen.getByText('REGRESO A CLASES')).toBeInTheDocument();
  });

  it('muestra todas las campañas que comparten el número Ekon buscado', async () => {
    vi.mocked(listEkonLinks).mockResolvedValue([
      {
        id: 'a',
        campaignId: 'a',
        campaignNameKey: A.nameKey,
        campaignName: A.name,
        ekonCampaignNumber: 777,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
      {
        id: 'b',
        campaignId: 'b',
        campaignNameKey: B.nameKey,
        campaignName: B.name,
        ekonCampaignNumber: 777,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
    ]);

    render(<CampaignsPage />);
    await userEvent.type(
      await screen.findByPlaceholderText(/Buscar por campaña o # Ekon/i),
      '777',
    );

    expect(screen.getByText('BUEN FIN')).toBeInTheDocument();
    expect(screen.getByText('REGRESO A CLASES')).toBeInTheDocument();
  });

  it('distingue flights homónimos por campaign.id al buscar su Ekon', async () => {
    const firstFlight = campaign({
      id: 'flight-1',
      name: 'HIPER X',
      nameKey: 'hiper x',
      fechaInicio: '2026-08-01',
      fechaFin: '2026-08-07',
    });
    const secondFlight = campaign({
      id: 'flight-2',
      name: 'HIPER X',
      nameKey: 'hiper x',
      fechaInicio: '2026-08-08',
      fechaFin: '2026-08-14',
    });
    vi.mocked(listCampaigns).mockResolvedValue([firstFlight, secondFlight]);
    vi.mocked(listEkonLinks).mockResolvedValue([
      {
        id: 'flight-1',
        campaignId: 'flight-1',
        campaignNameKey: 'hiper x',
        campaignName: 'HIPER X',
        ekonCampaignNumber: 1001,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
      {
        id: 'flight-2',
        campaignId: 'flight-2',
        campaignNameKey: 'hiper x',
        campaignName: 'HIPER X',
        ekonCampaignNumber: 2002,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
    ]);

    render(<CampaignsPage />);
    await userEvent.type(
      await screen.findByPlaceholderText(/Buscar por campaña o # Ekon/i),
      '2002',
    );

    expect(screen.getAllByText('HIPER X')).toHaveLength(1);
    expect(screen.getByText('08/08/2026')).toBeInTheDocument();
    expect(screen.queryByText('01/08/2026')).not.toBeInTheDocument();
  });

  it('combina búsqueda por nombre y filtro por periodo', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');

    // Filtro por periodo de agosto → solo REGRESO A CLASES.
    const desde = screen.getByLabelText('Desde');
    await userEvent.type(desde, '2026-07-01');
    await waitFor(() =>
      expect(screen.queryByText('BUEN FIN')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('REGRESO A CLASES')).toBeInTheDocument();

    // Búsqueda que no coincide con lo que queda en el periodo → sin resultados.
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      'buen',
    );
    expect(
      await screen.findByText(/Ninguna campaña coincide/i),
    ).toBeInTheDocument();
  });

  it('valida el rango invertido y no presenta resultados', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-09-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2026-01-01');
    expect(
      await screen.findByText(/no puede ser posterior/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('BUEN FIN')).not.toBeInTheDocument();
  });

  it('guarda una asociación Ekon nueva desde el modal', async () => {
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    const input = screen.getByLabelText(/# campaña Ekon/i);
    await userEvent.type(input, '4321');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(saveEkonLink).toHaveBeenCalledTimes(1));
    expect(saveEkonLink).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: 'regreso a clases',
        campaignName: 'REGRESO A CLASES',
        ekonCampaignNumber: 4321,
      }),
    );
  });

  it('avisa qué campaña ya usa el número y guarda si se confirma', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    // 777 ya lo tiene BUEN FIN.
    await userEvent.type(screen.getByLabelText(/# campaña Ekon/i), '777');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toContain('BUEN FIN');
    expect(confirmSpy.mock.calls[0]![0]).toContain('777');

    await waitFor(() => expect(saveEkonLink).toHaveBeenCalledTimes(1));
    expect(saveEkonLink).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignNameKey: 'regreso a clases',
        ekonCampaignNumber: 777,
      }),
    );
    confirmSpy.mockRestore();
  });

  it('avisa y NO guarda si se cancela la confirmación', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');

    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    await userEvent.type(screen.getByLabelText(/# campaña Ekon/i), '777');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(saveEkonLink).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('rechaza en la UI un número Ekon inválido sin llamar al servicio', async () => {
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');
    const rowB = screen.getByText('REGRESO A CLASES').closest('tr')!;
    await userEvent.click(within(rowB).getByTitle(/Ver detalle/i));

    await userEvent.type(screen.getByLabelText(/# campaña Ekon/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /mayor que cero/i,
    );
    expect(saveEkonLink).not.toHaveBeenCalled();
  });

  it('edita solo el flight seleccionado aunque otro homónimo comparta Ekon', async () => {
    const may = campaign({
      id: 'flight-may',
      name: 'VENTA VERANO VECI',
      nameKey: 'venta verano veci',
      fechaInicio: '2026-05-01',
      fechaFin: '2026-05-15',
    });
    const jun = campaign({
      id: 'flight-jun',
      name: 'VENTA VERANO VECI',
      nameKey: 'venta verano veci',
      fechaInicio: '2026-06-01',
      fechaFin: '2026-06-15',
    });
    vi.mocked(listCampaigns).mockResolvedValue([may, jun]);
    vi.mocked(listEkonLinks).mockResolvedValue([
      {
        id: may.id,
        campaignId: may.id,
        campaignNameKey: may.nameKey,
        campaignName: may.name,
        ekonCampaignNumber: 25348,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
      {
        id: jun.id,
        campaignId: jun.id,
        campaignNameKey: jun.nameKey,
        campaignName: jun.name,
        ekonCampaignNumber: 25348,
        createdAt: 1,
        createdBy: 'x',
        updatedAt: 1,
        updatedBy: 'x',
      },
    ]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CampaignsPage />);
    const names = await screen.findAllByText('VENTA VERANO VECI');
    const mayRow = names
      .map((node) => node.closest('tr'))
      .find((row) => row?.textContent?.includes('01/05/2026'))!;
    await userEvent.click(within(mayRow).getByTitle(/Ver detalle/i));
    const input = screen.getByLabelText(/# campaña Ekon/i);
    await userEvent.clear(input);
    await userEvent.type(input, '99999');
    await userEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(saveEkonLink).toHaveBeenCalledTimes(1));
    expect(saveEkonLink).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: 'flight-may',
        ekonCampaignNumber: 99999,
      }),
    );
    expect(saveEkonLink).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: 'flight-jun' }),
    );
    confirmSpy.mockRestore();
  });
});

describe('CampaignsPage — menú de descargas', () => {
  async function openMenu(name: string) {
    await userEvent.click(
      screen.getByRole('button', {
        name: new RegExp(`Descargas de ${name}`, 'i'),
      }),
    );
    return screen.getByRole('menu', {
      name: new RegExp(`Descargas de ${name}`, 'i'),
    });
  }

  it('ofrece el desglose Excel como primera opción, luego ZIP y resoluciones', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Descargar desglose Excel');
    expect(items[1]).toHaveTextContent('Descargar todos en ZIP');
    expect(items).toHaveLength(4); // Excel + ZIP + 2 resoluciones
    expect(within(menu).getByText('914 x 908 — 9 filas')).toBeInTheDocument();
    expect(within(menu).getByText('1920 x 1080 — 4 filas')).toBeInTheDocument();
  });

  it('descarga el desglose Excel de la instancia exacta de esa campaña', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    await userEvent.click(within(menu).getByText('Descargar desglose Excel'));
    await waitFor(() =>
      expect(buildCampaignReportBlob).toHaveBeenCalledTimes(1),
    );
    // El modelo se construye con exactamente esa campaña (sin homónimas).
    const campaignsArg = vi.mocked(buildCampaignReport).mock.calls[0]![0];
    expect(campaignsArg).toHaveLength(1);
    expect(campaignsArg[0]!.id).toBe('a');
    expect(campaignsArg[0]!.name).toBe('BUEN FIN');
  });

  it('ofrece ZIP aunque la campaña tenga un único CSV', async () => {
    vi.mocked(consolidate).mockReturnValue({
      consolidations: [cons('BUEN FIN', '914 x 908', 9)],
      issues: [],
      excludedInstore: [],
      ismExcludedCount: 0,
    });
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    expect(
      within(menu).getByText('Descargar todos en ZIP'),
    ).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3); // Excel + ZIP + 1
  });

  it('solo permite un menú abierto a la vez', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await openMenu('BUEN FIN');
    await userEvent.click(
      screen.getByRole('button', {
        name: /Descargas de REGRESO A CLASES/i,
      }),
    );
    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });

  it('genera el ZIP con todas las consolidaciones de esa campaña y cierra el menú', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    await userEvent.click(within(menu).getByText('Descargar todos en ZIP'));
    await waitFor(() => expect(buildZip).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(buildZip).mock.calls[0]![0];
    expect(arg).toHaveLength(2);
    expect(arg.every((x) => x.campaignName === 'BUEN FIN')).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('conserva las descargas individuales y cierra el menú al elegir una', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    await userEvent.click(within(menu).getByText('914 x 908 — 9 filas'));
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
    expect(buildZip).not.toHaveBeenCalled();
  });

  it('cierra el menú con Escape', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await openMenu('BUEN FIN');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('cierra el menú al pulsar fuera', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await openMenu('BUEN FIN');
    await userEvent.click(document.body);
    await waitFor(() =>
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(),
    );
  });

  it('una campaña sin consolidaciones muestra "Sin CSV" y no ofrece ZIP', async () => {
    render(<CampaignsPage />);
    await screen.findByText('REGRESO A CLASES');
    const menu = await openMenu('REGRESO A CLASES');
    expect(within(menu).getByText('Sin CSV')).toBeInTheDocument();
    expect(
      within(menu).queryByText('Descargar todos en ZIP'),
    ).not.toBeInTheDocument();
  });

  it('renderiza el panel fuera del contenedor desplazable de la tabla', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    const menu = await openMenu('BUEN FIN');
    expect(menu.closest('.diagnosis__table-wrap')).toBeNull();
    expect(document.body.contains(menu)).toBe(true);
  });
});

describe('CampaignsPage — flights homónimos (dedup de descargas)', () => {
  // Reproduce el caso "EL CORTE INGLES": tres flights homónimos que, con el
  // motor real, deben producir una sola consolidación por resolución. El menú
  // debe mostrar una única opción por resolución (no una por flight) y el ZIP
  // recibir exactamente dos consolidaciones.
  function ledScreen(
    id: string,
    numero: string,
    resolution: string,
    centros: string,
    articulos: string,
  ): AdmiraScreen {
    return {
      id,
      original: {
        ...emptyOriginal(),
        'Numero de Tienda': numero,
        RESOLUCION: resolution,
        CENTROS: centros,
        ARTICULOS: articulos,
      },
      metadata: {
        ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
        active: true,
        calendarSupport: 'LED',
      },
    };
  }

  async function setupHomonymousFlights() {
    // 10 pantallas 914 X 908 (filas distintas por CENTROS) + 1 pantalla 690 X 832.
    const screens: AdmiraScreen[] = [];
    for (let i = 1; i <= 10; i += 1) {
      screens.push(ledScreen(`s${i}`, String(i), '914 X 908', `C${i}`, 'A'));
    }
    screens.push(ledScreen('s11', '11', '690 X 832', 'C11', 'B'));

    const stores = Array.from({ length: 11 }, (_, i) => ({
      numero: String(i + 1),
      nombre: '',
    }));
    const flight = (id: string): StoredCampaign =>
      campaign({
        id,
        name: 'EL CORTE INGLES',
        nameKey: 'el corte ingles',
        supports: [{ support: 'LED', owner: 'liverpool', stores }],
      });

    vi.mocked(listCampaigns).mockResolvedValue([
      flight('f1'),
      flight('f2'),
      flight('f3'),
    ]);
    vi.mocked(listScreens).mockResolvedValue(screens);
    vi.mocked(listEkonLinks).mockResolvedValue([]);
    // Usa el motor real de consolidación (no un resultado ya deduplicado).
    const actual = await vi.importActual<
      typeof import('@/modules/consolidation/consolidate')
    >('@/modules/consolidation/consolidate');
    vi.mocked(consolidate).mockImplementation(actual.consolidate);
  }

  it('muestra una sola opción por resolución pese a los flights repetidos', async () => {
    await setupHomonymousFlights();
    render(<CampaignsPage />);
    await screen.findAllByText('EL CORTE INGLES');

    // Hay varias filas homónimas; abrimos el menú de la primera.
    const triggers = screen.getAllByRole('button', {
      name: /Descargas de EL CORTE INGLES/i,
    });
    await userEvent.click(triggers[0]!);
    const menu = screen.getByRole('menu', {
      name: /Descargas de EL CORTE INGLES/i,
    });

    // Exactamente una opción por resolución.
    expect(within(menu).getAllByText('690 X 832 — 1 filas')).toHaveLength(1);
    expect(within(menu).getAllByText('914 X 908 — 10 filas')).toHaveLength(1);

    // No hay seis botones de resolución (comportamiento anterior: 3 flights × 2).
    const resItems = within(menu)
      .getAllByRole('menuitem')
      .filter((el) => /—\s*\d+\s*filas/.test(el.textContent ?? ''));
    expect(resItems).toHaveLength(2);
  });

  it('el ZIP recibe una sola consolidación por resolución', async () => {
    await setupHomonymousFlights();
    render(<CampaignsPage />);
    await screen.findAllByText('EL CORTE INGLES');

    const triggers = screen.getAllByRole('button', {
      name: /Descargas de EL CORTE INGLES/i,
    });
    await userEvent.click(triggers[0]!);
    const menu = screen.getByRole('menu', {
      name: /Descargas de EL CORTE INGLES/i,
    });
    await userEvent.click(within(menu).getByText('Descargar todos en ZIP'));

    await waitFor(() => expect(buildZip).toHaveBeenCalledTimes(1));
    const arg = vi.mocked(buildZip).mock.calls[0]![0];
    expect(arg).toHaveLength(2);
    expect(arg.map((c) => c.resolution).sort()).toEqual([
      '690 X 832',
      '914 X 908',
    ]);
  });
});

describe('CampaignsPage — exportación masiva Excel', () => {
  const bulkBtn = () =>
    screen.getByRole('button', { name: /Exportar (todas|filtradas)/i });

  it('sin filtros muestra "Exportar todas (N)" con el total visible', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    expect(
      screen.getByRole('button', { name: 'Exportar todas (2)' }),
    ).toBeInTheDocument();
  });

  it('con búsqueda muestra "Exportar filtradas (N)" y exporta exactamente el filtrado', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      'BUEN',
    );
    const btn = await screen.findByRole('button', {
      name: 'Exportar filtradas (1)',
    });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(buildCampaignReportBlob).toHaveBeenCalledTimes(1),
    );
    // Se exporta exactamente el arreglo `filtered` (respeta la búsqueda).
    const calls = vi.mocked(buildCampaignReport).mock.calls;
    const arg = calls[calls.length - 1]![0];
    expect(arg).toHaveLength(1);
    expect(arg[0]!.name).toBe('BUEN FIN');
  });

  it('exporta exactamente las campañas filtradas por número Ekon', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      '777',
    );
    const btn = await screen.findByRole('button', {
      name: 'Exportar filtradas (1)',
    });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(buildCampaignReportBlob).toHaveBeenCalledTimes(1),
    );
    const calls = vi.mocked(buildCampaignReport).mock.calls;
    const arg = calls[calls.length - 1]![0];
    expect(arg.map((c) => c.id)).toEqual(['a']);
  });

  it('el periodo Desde/Hasta afecta el conjunto exportado', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    // Solo agosto: excluye BUEN FIN (mayo), incluye REGRESO A CLASES.
    await userEvent.type(screen.getByLabelText('Desde'), '2026-08-01');
    const btn = await screen.findByRole('button', {
      name: 'Exportar filtradas (1)',
    });
    await userEvent.click(btn);
    await waitFor(() =>
      expect(buildCampaignReportBlob).toHaveBeenCalledTimes(1),
    );
    const calls = vi.mocked(buildCampaignReport).mock.calls;
    const arg = calls[calls.length - 1]![0];
    expect(arg.map((c) => c.name)).toEqual(['REGRESO A CLASES']);
  });

  it('deshabilita el botón con periodo inválido', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-09-01');
    await userEvent.type(screen.getByLabelText('Hasta'), '2026-01-01');
    expect(bulkBtn()).toBeDisabled();
  });

  it('deshabilita el botón cuando no hay resultados', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      'NO EXISTE',
    );
    await waitFor(() => expect(bulkBtn()).toBeDisabled());
  });

  it('muestra un error comprensible si la generación masiva falla', async () => {
    vi.mocked(buildCampaignReportBlob).mockRejectedValue(new Error('boom'));
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(bulkBtn());
    expect(
      await screen.findByText(/No se pudo generar el desglose Excel/i),
    ).toBeInTheDocument();
  });
});

describe('CampaignsPage — PPT de evidencias', () => {
  const pptBtn = (name: string) =>
    screen.getByRole('button', {
      name: `Descargar PPT de evidencias de ${name}`,
    });

  it('muestra un botón PPT accesible por campaña, con el nombre en el aria-label', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    expect(pptBtn('BUEN FIN')).toBeInTheDocument();
    expect(pptBtn('REGRESO A CLASES')).toBeInTheDocument();
    expect(pptBtn('BUEN FIN')).toHaveAttribute('title');
  });

  it('al pulsar, llama al plan con la campaña y el catálogo correctos', async () => {
    const scr = {
      id: 's1',
      original: {
        'TIPO DE pantallas': '',
        CENTROS: '',
        CIRCUITO: '',
        RESOLUCION: '',
        FORMATO: '',
        'Nombre en plataforma': '',
        'TIPO DE PASES': '',
        'Numero de Tienda': '1',
        'Nombre de tienda': 'T',
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
        calendarSupport: '',
      },
    };
    vi.mocked(listScreens).mockResolvedValue([scr]);
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(pptBtn('BUEN FIN'));
    await waitFor(() => expect(buildCampaignPpt).toHaveBeenCalledTimes(1));
    expect(buildCampaignPptPlan).toHaveBeenCalledTimes(1);
    expect(buildCampaignPptPlan).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'BUEN FIN' }),
      [scr],
    );
  });

  it('genera exclusivamente la campaña seleccionada', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(pptBtn('BUEN FIN'));
    await waitFor(() => expect(buildCampaignPpt).toHaveBeenCalledTimes(1));
    expect(vi.mocked(buildCampaignPptPlan).mock.calls[0]![0].name).toBe(
      'BUEN FIN',
    );
  });

  it('descarga el Blob con el nombre de archivo correcto', async () => {
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
      render(<CampaignsPage />);
      await screen.findByText('BUEN FIN');
      await userEvent.click(pptBtn('BUEN FIN'));
      await waitFor(() => expect(buildCampaignPpt).toHaveBeenCalledTimes(1));
      const anchor = anchors[anchors.length - 1]!;
      expect(anchor.download).toBe(
        'Evidencias_BUEN_FIN_10-05-2026_al_20-05-2026.pptx',
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('muestra estado de generación y evita dos generaciones simultáneas', async () => {
    let resolveFn: (b: Blob) => void = () => {};
    vi.mocked(buildCampaignPpt).mockImplementation(
      () =>
        new Promise<Blob>((res) => {
          resolveFn = res;
        }),
    );
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(pptBtn('BUEN FIN'));
    await waitFor(() =>
      expect(pptBtn('BUEN FIN')).toHaveAttribute('aria-busy', 'true'),
    );
    // Mientras genera, todos los botones PPT quedan deshabilitados.
    expect(pptBtn('REGRESO A CLASES')).toBeDisabled();
    resolveFn(new Blob(['pptx']));
    await waitFor(() =>
      expect(pptBtn('BUEN FIN')).toHaveAttribute('aria-busy', 'false'),
    );
  });

  it('muestra un error comprensible si la generación falla', async () => {
    vi.mocked(buildCampaignPpt).mockRejectedValue(new Error('boom'));
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(pptBtn('BUEN FIN'));
    expect(
      await screen.findByText(/No se pudo generar la PPT/i),
    ).toHaveTextContent(/BUEN FIN/);
  });

  it('no interfiere con el menú de CSV ni genera ZIP', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.click(pptBtn('BUEN FIN'));
    await waitFor(() => expect(buildCampaignPpt).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(buildZip).not.toHaveBeenCalled();
    // El menú de descargas sigue funcionando.
    await userEvent.click(
      screen.getByRole('button', { name: /Descargas de BUEN FIN/i }),
    );
    expect(
      screen.getByRole('menu', { name: /Descargas de BUEN FIN/i }),
    ).toBeInTheDocument();
  });
});

describe('CampaignsPage — advertencia de baja ocupación', () => {
  const today = todayIsoDate();

  function providerScreen(): AdmiraScreen {
    return {
      id: 'sc1',
      original: {
        ...emptyOriginal(),
        'Numero de Tienda': '1',
        RESOLUCION: 'R',
        ARTICULOS: 'A',
      },
      metadata: {
        ...newScreenMetadata({ uid: 'u', email: 'e@e.com' }, 0),
        active: true,
        calendarSupport: 'LED',
      },
    };
  }

  it('muestra la advertencia no bloqueante con enlace cuando hay baja ocupación hoy', async () => {
    vi.mocked(listCampaigns).mockResolvedValue([
      campaign({
        id: 'p1',
        name: 'PROVEEDOR HOY',
        nameKey: 'proveedor hoy',
        tipo: 'ISM/PROVEEDOR',
        fechaInicio: today,
        fechaFin: today,
        supports: [
          {
            support: 'LED',
            owner: 'liverpool',
            stores: [{ numero: '1', nombre: '' }],
          },
        ],
      }),
    ]);
    vi.mocked(listScreens).mockResolvedValue([providerScreen()]);

    render(
      <MemoryRouter>
        <CampaignsPage />
      </MemoryRouter>,
    );

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/baja ocupación para hoy/i);
    expect(status).toHaveTextContent(/La exportación puede continuar/i);
    const link = within(status).getByRole('link', {
      name: /Ver alertas de baja ocupación/i,
    });
    expect(link).toHaveAttribute('href', `/alertas-ocupacion?fecha=${today}`);
  });
});

describe('CampaignsPage — contadores', () => {
  it('sin filtros muestra los totales globales', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    expect(
      screen.getByText('2 campañas · 2 CSV · 3 incidencias'),
    ).toBeInTheDocument();
  });

  it('con filtro muestra "N de total" y los CSV/incidencias visibles', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      'buen',
    );
    expect(
      await screen.findByText('1 de 2 campañas · 2 CSV · 3 incidencias'),
    ).toBeInTheDocument();
  });

  it('con filtro sin coincidencias los conteos visibles son 0', async () => {
    render(<CampaignsPage />);
    await screen.findByText('BUEN FIN');
    await userEvent.type(
      screen.getByPlaceholderText(/Buscar por campaña o # Ekon/i),
      'zzz',
    );
    expect(
      await screen.findByText('0 de 2 campañas · 0 CSV · 0 incidencias'),
    ).toBeInTheDocument();
  });
});
