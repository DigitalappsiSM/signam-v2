import { describe, it, expect } from 'vitest';
import {
  buildTrackingRows,
  criticalAlerts,
  isFullyTracked,
  isOperationallyApplicable,
} from './trackingModel';
import { parseCampaignDate } from './businessDays';
import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking } from './types';
import type { AdmiraScreen } from '@/domain';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';

const today = parseCampaignDate('2026-03-10')!;

function screen(o: {
  id: string;
  numero: string;
  soporte: string;
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
      'Nombre de tienda': 'Tienda',
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
      calendarSupport: o.soporte,
    },
  };
}

function support(soporte: string, numero: string): CampaignSupport {
  return {
    support: soporte,
    owner: 'liverpool',
    stores: [{ numero, nombre: '' }],
  };
}

function campaign(over: Partial<StoredCampaign>): StoredCampaign {
  return {
    id: over.id ?? 'id',
    row: 1,
    name: over.name ?? 'CAMPAÑA',
    nameKey: over.nameKey ?? (over.name ?? 'campaña').toLowerCase(),
    signature: 'sig',
    tipo: over.tipo ?? '',
    vendidoPor: 'Liverpool',
    fechaInicio: over.fechaInicio ?? '2026-03-02',
    fechaFin: over.fechaFin ?? '2026-03-20',
    mes: 'Marzo',
    link: over.link ?? '',
    supports: [],
    ...over,
  };
}

describe('buildTrackingRows', () => {
  it('deriva clasificación del tipo cuando no hay seguimiento', () => {
    const rows = buildTrackingRows(
      [campaign({ tipo: 'INSTITUCIONAL', link: 'https://x.com/a.zip' })],
      [],
      [],
      today,
    );
    expect(rows[0]!.classification).toBe('institutional');
    expect(rows[0]!.linkStatus).toBe('valid');
    expect(rows[0]!.distinctStores).toBe(0);
    expect(rows[0]!.target).toBe(0);
  });

  it('usa la clasificación persistida por encima del tipo', () => {
    const c = campaign({ tipo: 'INSTITUCIONAL' });
    const tracking = {
      campaignNameKey: campaignIdentity(c),
      classification: 'provider',
    } as CampaignOperationalTracking;
    const rows = buildTrackingRows([c], [], [tracking], today);
    expect(rows[0]!.classification).toBe('provider');
  });

  it('clasifica el periodo (activa / futura / terminada)', () => {
    const rows = buildTrackingRows(
      [
        campaign({
          nameKey: 'a',
          fechaInicio: '2026-03-02',
          fechaFin: '2026-03-20',
        }),
        campaign({
          nameKey: 'b',
          fechaInicio: '2026-04-01',
          fechaFin: '2026-04-10',
        }),
        campaign({
          nameKey: 'c',
          fechaInicio: '2026-01-01',
          fechaFin: '2026-02-01',
        }),
      ],
      [],
      [],
      today,
    );
    expect(rows[0]!.timeframe).toBe('active');
    expect(rows[1]!.timeframe).toBe('upcoming');
    expect(rows[2]!.timeframe).toBe('finished');
  });

  it('el estado general toma el más urgente de los dos testigos', () => {
    // Proveedor activo sin seguimiento (los testigos solo aplican a Proveedor):
    // T Arranque ya vencido (límite 03-06), T Completos en tiempo (fin 03-20) →
    // overall = overdue.
    const rows = buildTrackingRows(
      [
        campaign({
          tipo: 'PROVEEDOR',
          fechaInicio: '2026-03-02',
          fechaFin: '2026-03-20',
        }),
      ],
      [],
      [],
      today,
    );
    expect(rows[0]!.startStatus).toBe('overdue');
    expect(rows[0]!.completeStatus).toBe('on-track');
    expect(rows[0]!.overall).toBe('overdue');
  });

  it('colapsa documentos idénticos (misma identidad) en una sola fila', () => {
    const rows = buildTrackingRows(
      [
        campaign({ id: 'a', name: 'HIPER X', nameKey: 'hiper x#h1' }),
        campaign({ id: 'b', name: 'HIPER X', nameKey: 'hiper x#h1' }),
      ],
      [],
      [],
      today,
    );
    expect(rows).toHaveLength(1);
  });

  it('dos "flights" del mismo nombre (identidad distinta) son dos filas', () => {
    const rows = buildTrackingRows(
      [
        campaign({
          id: 'a',
          name: 'HIPER X',
          nameKey: 'hiper x#jul',
          fechaInicio: '2026-03-01',
          fechaFin: '2026-03-10',
          supports: [support('APARADOR', '1')],
        }),
        campaign({
          id: 'b',
          name: 'HIPER X',
          nameKey: 'hiper x#ago',
          fechaInicio: '2026-03-15',
          fechaFin: '2026-03-25',
          supports: [support('VIDEO WALL', '2')],
        }),
      ],
      [
        screen({ id: 's1', numero: '1', soporte: 'APARADOR' }),
        screen({ id: 's2', numero: '2', soporte: 'VIDEO WALL' }),
      ],
      [],
      today,
    );
    // Dos filas independientes; cada una cuenta SOLO sus propias tiendas.
    expect(rows).toHaveLength(2);
    const byKey = new Map(rows.map((r) => [r.campaign.nameKey, r]));
    expect(byKey.get('hiper x#jul')!.distinctStores).toBe(1);
    expect(byKey.get('hiper x#ago')!.distinctStores).toBe(1);
  });

  it('asocia el seguimiento por identidad (cada flight su propio doc)', () => {
    const jul = campaign({
      id: 'a',
      name: 'HIPER X',
      fechaInicio: '2026-03-01',
      fechaFin: '2026-03-10',
    });
    const ago = campaign({
      id: 'b',
      name: 'HIPER X',
      fechaInicio: '2026-03-15',
      fechaFin: '2026-03-25',
    });
    const rows = buildTrackingRows(
      [jul, ago],
      [],
      [
        {
          campaignNameKey: campaignIdentity(ago),
          classification: 'provider',
        } as CampaignOperationalTracking,
      ],
      today,
    );
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((r) => [r.identity, r]));
    // Solo el flight con seguimiento (por identidad) toma esa clasificación.
    expect(byId.get(campaignIdentity(ago))!.classification).toBe('provider');
    expect(byId.get(campaignIdentity(jul))!.tracking).toBeNull();
  });

  it('marca link faltante e inválido', () => {
    const rows = buildTrackingRows(
      [
        campaign({ nameKey: 'a', link: '' }),
        campaign({ nameKey: 'b', link: 'pendiente' }),
      ],
      [],
      [],
      today,
    );
    expect(rows[0]!.linkStatus).toBe('missing');
    expect(rows[1]!.linkStatus).toBe('invalid');
  });
});

describe('criticalAlerts / isFullyTracked', () => {
  it('detecta T Arranque vencido, sin link y proveedor sin validación', () => {
    const rows = buildTrackingRows(
      [
        campaign({
          tipo: 'PROVEEDOR',
          link: '',
          fechaInicio: '2026-03-02',
          fechaFin: '2026-03-20',
        }),
      ],
      [],
      [],
      today,
    );
    const kinds = criticalAlerts(rows[0]!).map((a) => a.kind);
    expect(kinds).toContain('start-overdue');
    expect(kinds).toContain('no-link');
    expect(kinds).toContain('active-no-csm');
    expect(kinds).toContain('provider-no-validation');
  });

  it('marca clasificación pendiente cuando el tipo es desconocido', () => {
    const rows = buildTrackingRows(
      [campaign({ tipo: 'Digital' })],
      [],
      [],
      today,
    );
    expect(criticalAlerts(rows[0]!).map((a) => a.kind)).toContain(
      'classification-pending',
    );
  });

  it('isFullyTracked requiere link válido y los cuatro checks', () => {
    const c = campaign({ link: 'https://x.com/a.zip' });
    const tracking = {
      campaignNameKey: campaignIdentity(c),
      classification: 'institutional',
      liverpoolValidation: { completed: true },
      csmProgramming: { completed: true },
      witnessStart: { completed: true },
      witnessComplete: { completed: true },
    } as unknown as CampaignOperationalTracking;
    const rows = buildTrackingRows([c], [], [tracking], today);
    expect(isFullyTracked(rows[0]!)).toBe(true);
  });
});

describe('testigos no aplicables para institucional', () => {
  // Institucional activa que, de aplicar testigos, tendría T Arranque vencido.
  const inst = campaign({
    tipo: 'INSTITUCIONAL',
    link: 'https://x.com/a.zip',
    fechaInicio: '2026-03-02',
    fechaFin: '2026-03-20',
  });

  it('ambos estados de testigos quedan como not-applicable', () => {
    const rows = buildTrackingRows([inst], [], [], today);
    expect(rows[0]!.startStatus).toBe('not-applicable');
    expect(rows[0]!.completeStatus).toBe('not-applicable');
    expect(rows[0]!.overall).toBe('not-applicable');
  });

  it('no tiene próximo vencimiento derivado de testigos', () => {
    const rows = buildTrackingRows([inst], [], [], today);
    expect(rows[0]!.nextDeadline).toBeNull();
  });

  it('no genera alertas start-overdue ni complete-overdue', () => {
    const rows = buildTrackingRows([inst], [], [], today);
    const kinds = criticalAlerts(rows[0]!).map((a) => a.kind);
    expect(kinds).not.toContain('start-overdue');
    expect(kinds).not.toContain('complete-overdue');
  });

  it('puede quedar completamente seguida sin testigos (link + validación + CSM)', () => {
    const tracking = {
      campaignNameKey: campaignIdentity(inst),
      classification: 'institutional',
      linkDownload: { completed: true, source: 'automatic' },
      liverpoolValidation: { completed: true },
      csmProgramming: { completed: true },
      witnessStart: { completed: false },
      witnessComplete: { completed: false },
    } as unknown as CampaignOperationalTracking;
    const rows = buildTrackingRows([inst], [], [tracking], today);
    expect(isFullyTracked(rows[0]!)).toBe(true);
  });

  it('un proveedor conserva los vencimientos de testigos', () => {
    const prov = campaign({
      tipo: 'PROVEEDOR',
      link: 'https://x.com/a.zip',
      fechaInicio: '2026-03-02',
      fechaFin: '2026-03-20',
    });
    const rows = buildTrackingRows([prov], [], [], today);
    expect(rows[0]!.startStatus).toBe('overdue');
    expect(rows[0]!.nextDeadline).not.toBeNull();
  });
});

describe('testigos pendientes de clasificar (unknown)', () => {
  const unk = campaign({
    tipo: '', // clasificación desconocida
    link: 'https://x.com/a.zip',
    fechaInicio: '2026-03-02',
    fechaFin: '2026-03-20',
  });

  it('no computa vencimientos de testigos hasta clasificar', () => {
    const rows = buildTrackingRows([unk], [], [], today);
    expect(rows[0]!.classification).toBe('unknown');
    expect(rows[0]!.startStatus).toBe('not-applicable');
    expect(rows[0]!.completeStatus).toBe('not-applicable');
    expect(rows[0]!.nextDeadline).toBeNull();
  });

  it('no genera alertas de testigo vencido, pero sí clasificación pendiente', () => {
    const kinds = criticalAlerts(
      buildTrackingRows([unk], [], [], today)[0]!,
    ).map((a) => a.kind);
    expect(kinds).not.toContain('start-overdue');
    expect(kinds).not.toContain('complete-overdue');
    expect(kinds).toContain('classification-pending');
  });
});

describe('terminadas con pendientes (indicadores aplicables)', () => {
  // Terminada respecto a `today` (2026-03-10).
  const inst = campaign({
    tipo: 'INSTITUCIONAL',
    link: 'https://x.com/a.zip',
    fechaInicio: '2026-01-02',
    fechaFin: '2026-02-01',
  });

  it('institucional terminada con CSM pendiente genera finished-pending', () => {
    const rows = buildTrackingRows([inst], [], [], today);
    expect(rows[0]!.timeframe).toBe('finished');
    expect(criticalAlerts(rows[0]!).map((a) => a.kind)).toContain(
      'finished-pending',
    );
  });

  it('institucional terminada con sus aplicables completos no queda pendiente', () => {
    const tracking = {
      campaignNameKey: campaignIdentity(inst),
      classification: 'institutional',
      linkDownload: { completed: true, source: 'automatic' },
      liverpoolValidation: { completed: true },
      csmProgramming: { completed: true },
      witnessStart: { completed: false },
      witnessComplete: { completed: false },
    } as unknown as CampaignOperationalTracking;
    const rows = buildTrackingRows([inst], [], [tracking], today);
    expect(criticalAlerts(rows[0]!)).toEqual([]);
    expect(isFullyTracked(rows[0]!)).toBe(true);
  });
});

describe('ciclo de vida en el modelo de vista', () => {
  // Campaña que, activa, dispararía alertas (proveedor vencido, sin link, etc.).
  function riskyProvider(cancelled: boolean): CampaignOperationalTracking {
    const c = campaign({
      tipo: 'PROVEEDOR',
      link: '',
      fechaInicio: '2026-03-02',
      fechaFin: '2026-03-20',
    });
    return {
      campaignNameKey: campaignIdentity(c),
      classification: 'provider',
      lifecycleStatus: cancelled ? 'cancelled' : 'active',
      liverpoolValidation: { completed: false },
      csmProgramming: { completed: false },
      witnessStart: { completed: false },
      witnessComplete: { completed: false },
    } as unknown as CampaignOperationalTracking;
  }

  const riskyCampaign = campaign({
    tipo: 'PROVEEDOR',
    link: '',
    fechaInicio: '2026-03-02',
    fechaFin: '2026-03-20',
  });

  it('el estado se refleja en la fila; legacy sin estado = active', () => {
    const rows = buildTrackingRows([riskyCampaign], [], [], today);
    expect(rows[0]!.lifecycleStatus).toBe('active');
    expect(isOperationallyApplicable(rows[0]!)).toBe(true);
  });

  it('una cancelada no genera criticalAlerts y no es isFullyTracked', () => {
    const rows = buildTrackingRows(
      [riskyCampaign],
      [],
      [riskyProvider(true)],
      today,
    );
    expect(rows[0]!.lifecycleStatus).toBe('cancelled');
    expect(criticalAlerts(rows[0]!)).toEqual([]);
    expect(isFullyTracked(rows[0]!)).toBe(false);
    expect(isOperationallyApplicable(rows[0]!)).toBe(false);
  });

  it('una cancelada no tiene próximo vencimiento aplicable', () => {
    const rows = buildTrackingRows(
      [riskyCampaign],
      [],
      [riskyProvider(true)],
      today,
    );
    expect(rows[0]!.nextDeadline).toBeNull();
  });

  it('la misma campaña activa SÍ genera alertas (contraste)', () => {
    const rows = buildTrackingRows(
      [riskyCampaign],
      [],
      [riskyProvider(false)],
      today,
    );
    expect(criticalAlerts(rows[0]!).length).toBeGreaterThan(0);
    expect(rows[0]!.nextDeadline).not.toBeNull();
  });
});
