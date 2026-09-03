import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from './ImportPage';
import { analyzeCalendar } from './calendarImport';
import { parseCampaigns, type CampaignParseResult } from './campaignParse';
import { readCalendarWorkbook } from './readCalendarWorkbook';
import { listCampaigns, applyCampaignChanges } from '@/services/campaigns';
import { campaignIdentity } from '@/modules/campaigns/campaignDiff';
import {
  initializeTrackingForImport,
  listOperationalTracking,
  migrateLegacyOperationalTracking,
} from '@/services/campaignOperationalTracking';
import {
  listEkonLinks,
  migrateLegacyEkonLinks,
} from '@/services/campaignEkonLinks';
import {
  listDateResolutions,
  saveDateResolutions,
} from '@/services/dateResolutions';
import { listScreens } from '@/services/screens';
import {
  listStoreCommentResolutions,
  saveStoreCommentResolutions,
} from '@/services/storeCommentResolutions';

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.mx', role: 'admin' },
    loading: false,
    configured: true,
  }),
}));
vi.mock('./readCalendarWorkbook', () => ({ readCalendarWorkbook: vi.fn() }));
vi.mock('./calendarImport', () => ({ analyzeCalendar: vi.fn() }));
vi.mock('./campaignParse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./campaignParse')>();
  return { ...actual, parseCampaigns: vi.fn() };
});
vi.mock('@/services/campaigns', () => ({
  listCampaigns: vi.fn(),
  applyCampaignChanges: vi.fn(),
}));
vi.mock('@/services/campaignOperationalTracking', () => ({
  listOperationalTracking: vi.fn(),
  initializeTrackingForImport: vi.fn(),
  migrateLegacyOperationalTracking: vi.fn(),
}));
vi.mock('@/services/campaignEkonLinks', () => ({
  listEkonLinks: vi.fn(),
  migrateLegacyEkonLinks: vi.fn(),
}));
vi.mock('@/services/dateResolutions', () => ({
  listDateResolutions: vi.fn(),
  saveDateResolutions: vi.fn(),
}));
vi.mock('@/services/screens', () => ({ listScreens: vi.fn() }));
vi.mock('@/services/storeCommentResolutions', () => ({
  listStoreCommentResolutions: vi.fn(),
  saveStoreCommentResolutions: vi.fn(),
}));

const analysis = {
  operativeSheet: 'Hoja1',
  headerRow: 1,
  headers: [],
  previewRows: [],
  comments: [],
  sheets: [],
  instoreSupports: [],
  dataRowCount: 1,
  issues: [],
};

function parseResultWith(
  fechaInicio: string,
  fechaFin = '2026-11-01',
  name = 'HIPER X',
): CampaignParseResult {
  return {
    operativeSheet: 'Hoja1',
    headerRow: 1,
    totalCampaigns: 1,
    liverpoolSupports: ['VIDEO WALL'],
    instoreSupports: [],
    campaigns: [
      {
        row: 2,
        name,
        tipo: 'PROVEEDOR',
        vendidoPor: 'LIVERPOOL',
        fechaInicio,
        fechaFin,
        mes: 'Octubre',
        link: '',
        supports: [
          {
            support: 'VIDEO WALL',
            owner: 'liverpool',
            stores: [{ numero: '1', nombre: '' }],
          },
        ],
      },
    ],
    issues: [],
    ambiguousStoreComments: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readCalendarWorkbook).mockResolvedValue({
    sheets: [],
    comments: [],
  } as never);
  vi.mocked(analyzeCalendar).mockReturnValue(analysis as never);
  vi.mocked(listCampaigns).mockResolvedValue([]);
  vi.mocked(listOperationalTracking).mockResolvedValue([]);
  vi.mocked(listEkonLinks).mockResolvedValue([]);
  vi.mocked(migrateLegacyEkonLinks).mockResolvedValue(0);
  vi.mocked(migrateLegacyOperationalTracking).mockResolvedValue(0);
  vi.mocked(applyCampaignChanges).mockResolvedValue({
    added: 1,
    modified: 0,
    removed: 0,
    addedCampaignIds: {},
  });
  vi.mocked(initializeTrackingForImport).mockResolvedValue({
    created: 0,
    reclassified: 0,
    failures: [],
  });
  vi.mocked(listDateResolutions).mockResolvedValue(new Map());
  vi.mocked(saveDateResolutions).mockResolvedValue(undefined);
  vi.mocked(listScreens).mockResolvedValue([]);
  vi.mocked(listStoreCommentResolutions).mockResolvedValue(new Map());
  vi.mocked(saveStoreCommentResolutions).mockResolvedValue(undefined);
});

async function upload() {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  await userEvent.upload(input, new File(['x'], 'cal.xlsx'));
}

describe('ImportPage — fechas ambiguas', () => {
  it('bloquea el guardado hasta confirmar la fecha ambigua y persiste la elección', async () => {
    // "10/05/2026" es ambigua (día/mes vs mes/día).
    vi.mocked(parseCampaigns).mockReturnValue(
      parseResultWith('10/05/2026') as never,
    );
    render(<ImportPage />);
    await upload();

    // Aparece el panel de fechas por confirmar y el guardado queda deshabilitado.
    await screen.findByText(/Fechas por confirmar/i);
    const saveBtn = await screen.findByRole('button', {
      name: /Aceptar y guardar/i,
    });
    expect(saveBtn).toBeDisabled();

    // Elegir "Mes/día" (→ 5 de octubre) habilita el guardado.
    await userEvent.selectOptions(
      screen.getByLabelText('Interpretación de la fecha 10/05/2026'),
      'MDY',
    );
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    await userEvent.click(saveBtn);
    await waitFor(() => expect(saveDateResolutions).toHaveBeenCalledTimes(1));
    const [resolutions] = vi.mocked(saveDateResolutions).mock.calls[0]!;
    expect(resolutions).toEqual([
      { raw: '10/05/2026', order: 'MDY', iso: '2026-10-05' },
    ]);
  });

  it('persiste la confirmación aunque la fecha ya coincida con la BD (sin cambios)', async () => {
    // Campaña ya guardada con la fecha ISO que corresponde a "10/05/2026" (MDY),
    // y ya con seguimiento: no hay cambios de campaña ni clasificación pendiente,
    // pero confirmar la fecha debe poder guardarse para recordar la resolución.
    const resolved = {
      row: 2,
      name: 'HIPER X',
      tipo: 'PROVEEDOR',
      vendidoPor: 'LIVERPOOL',
      fechaInicio: '2026-10-05',
      fechaFin: '2026-11-01',
      mes: 'Octubre',
      link: '',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    };
    const identity = campaignIdentity(resolved as never);
    vi.mocked(listCampaigns).mockResolvedValue([
      { ...resolved, id: 's1', nameKey: identity, signature: 'sig' },
    ] as never);
    vi.mocked(listOperationalTracking).mockResolvedValue([
      { campaignNameKey: identity, classification: 'provider' },
    ] as never);
    vi.mocked(parseCampaigns).mockReturnValue(
      parseResultWith('10/05/2026') as never,
    );

    render(<ImportPage />);
    await upload();
    const saveBtn = await screen.findByRole('button', {
      name: /Aceptar y guardar/i,
    });
    expect(saveBtn).toBeDisabled();
    await userEvent.selectOptions(
      screen.getByLabelText('Interpretación de la fecha 10/05/2026'),
      'MDY',
    );
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await userEvent.click(saveBtn);
    await waitFor(() => expect(saveDateResolutions).toHaveBeenCalledTimes(1));
    // No hubo cambios de campaña que aplicar.
    expect(applyCampaignChanges).not.toHaveBeenCalled();
  });

  it('no pide confirmación para fechas ISO (no ambiguas)', async () => {
    vi.mocked(parseCampaigns).mockReturnValue(
      parseResultWith('2026-10-05') as never,
    );
    render(<ImportPage />);
    await upload();
    await screen.findByRole('button', { name: /Aceptar y guardar/i });
    expect(screen.queryByText(/Fechas por confirmar/i)).not.toBeInTheDocument();
  });
});

describe('ImportPage — integridad campañas y seguimiento', () => {
  it('bloquea HIPER X y permite resolver INSURGENTES desde el catálogo', async () => {
    const parsed = parseResultWith('2026-08-11', '2026-09-07', 'HIPER X');
    parsed.campaigns[0]!.row = 199;
    parsed.campaigns[0]!.supports[0] = {
      support: 'VIDEO WALL',
      owner: 'liverpool',
      stores: [],
      scope: 'invalid',
    };
    parsed.ambiguousStoreComments = [
      {
        id: 'Hoja1:199:9',
        sheet: 'Hoja1',
        row: 199,
        col: 9,
        address: 'I199',
        campaignName: 'HIPER X',
        support: 'VIDEO WALL',
        comment: 'INSURGENTES',
      },
    ];
    vi.mocked(parseCampaigns).mockReturnValue(parsed as never);
    vi.mocked(listScreens).mockResolvedValue([
      {
        id: 'screen-2',
        original: {
          'Numero de Tienda': '2',
          'Nombre de tienda': 'L INSURGENTES',
        },
        metadata: { active: true, calendarSupport: 'VIDEO WALL' },
      },
    ] as never);

    render(<ImportPage />);
    await upload();

    expect(
      await screen.findByText(/Asignaciones de tienda por resolver/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/I199.*HIPER X.*INSURGENTES/i)).toBeInTheDocument();
    const saveButton = screen.getByRole('button', {
      name: /Aceptar y guardar/i,
    });
    expect(saveButton).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByLabelText('Resolver comentario I199 de HIPER X'),
      'selected',
    );
    await userEvent.click(screen.getByLabelText('2 · L INSURGENTES para I199'));
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    await userEvent.click(saveButton);
    await waitFor(() =>
      expect(saveStoreCommentResolutions).toHaveBeenCalledTimes(1),
    );
    expect(applyCampaignChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        added: [
          expect.objectContaining({
            name: 'HIPER X',
            supports: [
              expect.objectContaining({
                scope: 'selected',
                stores: [{ numero: '2', nombre: 'L INSURGENTES' }],
              }),
            ],
          }),
        ],
      }),
      expect.anything(),
      expect.any(Map),
    );
  });

  it('bloquea MAGFESA cuando el calendario contiene el año 0266', async () => {
    vi.mocked(parseCampaigns).mockReturnValue(
      parseResultWith('8/17/2026', '8/31/0266', 'MAGFESA') as never,
    );

    render(<ImportPage />);
    await upload();

    expect(
      await screen.findByText(/MAGFESA.*año 266.*fuera del rango/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Aceptar y guardar/i }),
    ).toBeDisabled();
  });

  it('nombra la campaña si la verificación detecta seguimiento faltante', async () => {
    const incoming = parseResultWith('2026-08-17', '2026-08-31', 'TRAMONTINA')
      .campaigns[0]!;
    const identity = campaignIdentity(incoming);
    vi.mocked(parseCampaigns).mockReturnValue({
      ...parseResultWith('2026-08-17', '2026-08-31', 'TRAMONTINA'),
      campaigns: [incoming],
    } as never);
    vi.mocked(listCampaigns).mockResolvedValue([
      {
        ...incoming,
        id: 'tramontina-id',
        nameKey: identity,
        signature: 'sig',
        active: true,
      },
    ] as never);
    vi.mocked(initializeTrackingForImport).mockResolvedValue({
      created: 0,
      reclassified: 0,
      failures: [
        {
          campaignId: 'tramontina-id',
          campaignName: 'TRAMONTINA',
          message: 'permission-denied',
        },
      ],
    });

    render(<ImportPage />);
    await upload();
    const saveButton = await screen.findByRole('button', {
      name: /Aceptar y guardar/i,
    });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
    await userEvent.click(saveButton);

    expect(
      await screen.findByText(
        /Inconsistencia detectada.*sin seguimiento operativo: TRAMONTINA/i,
      ),
    ).toBeInTheDocument();
  });
});
