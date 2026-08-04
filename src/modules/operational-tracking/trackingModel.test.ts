import { describe, it, expect } from 'vitest';
import {
  buildTrackingRows,
  criticalAlerts,
  isFullyTracked,
} from './trackingModel';
import { parseCampaignDate } from './businessDays';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
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
    const tracking = {
      campaignNameKey: 'campaña',
      classification: 'provider',
    } as CampaignOperationalTracking;
    const rows = buildTrackingRows(
      [campaign({ tipo: 'INSTITUCIONAL' })],
      [],
      [tracking],
      today,
    );
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
    // Campaña activa sin seguimiento: T Arranque ya vencido (límite 03-06),
    // T Completos en tiempo (fin 03-20) → overall = overdue.
    const rows = buildTrackingRows(
      [campaign({ fechaInicio: '2026-03-02', fechaFin: '2026-03-20' })],
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
    const rows = buildTrackingRows(
      [
        campaign({ id: 'a', name: 'HIPER X', nameKey: 'hiper x#jul' }),
        campaign({ id: 'b', name: 'HIPER X', nameKey: 'hiper x#ago' }),
      ],
      [],
      [
        {
          campaignNameKey: 'hiper x#ago',
          classification: 'provider',
        } as CampaignOperationalTracking,
      ],
      today,
    );
    const byKey = new Map(rows.map((r) => [r.campaign.nameKey, r]));
    // Solo el flight con seguimiento toma esa clasificación.
    expect(byKey.get('hiper x#ago')!.classification).toBe('provider');
    expect(byKey.get('hiper x#jul')!.tracking).toBeNull();
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
    const tracking = {
      campaignNameKey: 'campaña',
      classification: 'institutional',
      liverpoolValidation: { completed: true },
      csmProgramming: { completed: true },
      witnessStart: { completed: true },
      witnessComplete: { completed: true },
    } as unknown as CampaignOperationalTracking;
    const rows = buildTrackingRows(
      [campaign({ link: 'https://x.com/a.zip' })],
      [],
      [tracking],
      today,
    );
    expect(isFullyTracked(rows[0]!)).toBe(true);
  });
});
