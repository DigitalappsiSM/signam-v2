import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPage } from './ImportPage';
import { analyzeCalendar } from './calendarImport';
import { parseCampaigns } from './campaignParse';
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

vi.mock('@/app/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.mx', role: 'admin' },
    loading: false,
    configured: true,
  }),
}));
vi.mock('./readCalendarWorkbook', () => ({ readCalendarWorkbook: vi.fn() }));
vi.mock('./calendarImport', () => ({ analyzeCalendar: vi.fn() }));
vi.mock('./campaignParse', () => ({ parseCampaigns: vi.fn() }));
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

function parseResultWith(fechaInicio: string) {
  return {
    operativeSheet: 'Hoja1',
    headerRow: 1,
    totalCampaigns: 1,
    liverpoolSupports: ['VIDEO WALL'],
    instoreSupports: [],
    campaigns: [
      {
        row: 2,
        name: 'HIPER X',
        tipo: 'PROVEEDOR',
        vendidoPor: 'LIVERPOOL',
        fechaInicio,
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
      },
    ],
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
  });
  vi.mocked(listDateResolutions).mockResolvedValue(new Map());
  vi.mocked(saveDateResolutions).mockResolvedValue(undefined);
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
