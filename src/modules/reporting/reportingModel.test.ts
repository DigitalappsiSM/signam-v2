import { describe, expect, it } from 'vitest';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import {
  cancelTracking,
  initialTracking,
} from '@/modules/operational-tracking/trackingFactory';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import type { CampaignEkonLink } from '@/services/campaignEkonLinks';
import { buildReportingModel, type ReportingInput } from './reportingModel';

const actor = { uid: 'operator', email: 'operator@example.com' };

function campaign(
  id: string,
  type: string,
  start = '01/09/2026',
  end = '10/09/2026',
): StoredCampaign {
  return {
    id,
    row: 2,
    name: `Campaña ${id}`,
    nameKey: `campaña ${id}`,
    signature: id,
    tipo: type,
    vendidoPor: 'ISM',
    fechaInicio: start,
    fechaFin: end,
    mes: 'SEPTIEMBRE',
    link: 'https://example.com/material',
    supports: [],
    active: true,
  };
}

function tracking(
  item: StoredCampaign,
  classification: 'provider' | 'institutional',
  completedAt: number,
): CampaignOperationalTracking {
  const base = initialTracking(
    {
      campaignId: item.id,
      campaignNameKey: item.nameKey,
      campaignName: item.name,
      classification,
      classificationSource: 'tracking-user',
      linkValid: true,
    },
    actor,
    Date.UTC(2026, 8, 1),
  );
  const completed = {
    completed: true,
    completedAt,
    completedByUid: actor.uid,
    completedByEmail: actor.email,
    source: 'manual' as const,
    updatedAt: completedAt,
    updatedByUid: actor.uid,
    updatedByEmail: actor.email,
  };
  return {
    ...base,
    csmProgramming: completed,
    witnessStart: completed,
    witnessComplete: completed,
  };
}

function input(
  campaigns: StoredCampaign[],
  trackingRows: CampaignOperationalTracking[],
  links: CampaignEkonLink[] = [],
): ReportingInput {
  return {
    campaigns,
    screens: [],
    tracking: trackingRows,
    digitalItems: [],
    digitalTracking: [],
    ekonLinks: links,
    assignmentsByNumber: new Map(),
    ekonBatches: [],
    range: {
      start: new Date(Date.UTC(2026, 8, 1)),
      end: new Date(Date.UTC(2026, 8, 30)),
    },
    today: new Date(Date.UTC(2026, 8, 20)),
  };
}

describe('buildReportingModel', () => {
  it('excluye canceladas del cumplimiento e institucionales del SLA', () => {
    const provider = campaign('provider', 'Proveedor');
    const institutional = campaign('institutional', 'Institucional');
    const cancelledCampaign = campaign('cancelled', 'Proveedor');
    const completedAt = Date.UTC(2026, 8, 3);
    const cancelled = cancelTracking(
      tracking(cancelledCampaign, 'provider', completedAt),
      'Cancelación comercial',
      actor,
      Date.UTC(2026, 8, 4),
    );

    const model = buildReportingModel(
      input(
        [provider, institutional, cancelledCampaign],
        [
          tracking(provider, 'provider', completedAt),
          tracking(institutional, 'institutional', completedAt),
          cancelled,
        ],
      ),
    );

    expect(model.executive.campaigns).toBe(2);
    expect(model.executive.cancelled).toBe(1);
    expect(model.sla.start.applicable).toBe(1);
    expect(model.sla.complete.applicable).toBe(1);
  });

  it('separa entregas en tiempo y tardías usando las reglas existentes', () => {
    const onTime = campaign('on-time', 'Proveedor');
    const late = campaign('late', 'Proveedor');
    const model = buildReportingModel(
      input(
        [onTime, late],
        [
          tracking(onTime, 'provider', Date.UTC(2026, 8, 3)),
          tracking(late, 'provider', Date.UTC(2026, 8, 20)),
        ],
      ),
    );

    expect(model.sla.start.onTime).toBe(1);
    expect(model.sla.start.late).toBe(1);
    expect(model.sla.complete.onTime).toBe(1);
    expect(model.sla.complete.late).toBe(1);
    expect(model.sla.start.compliance).toBe(50);
    expect(model.executive.complete).toBe(2);
  });

  it('reporta campañas vinculadas sin asignaciones como conciliación bloqueada', () => {
    const linked = campaign('linked', 'Proveedor');
    const link: CampaignEkonLink = {
      id: linked.id,
      campaignId: linked.id,
      campaignNameKey: linked.nameKey,
      campaignName: linked.name,
      ekonCampaignNumber: 1234,
      createdAt: 1,
      createdBy: actor.email,
      updatedAt: 1,
      updatedBy: actor.email,
    };
    const model = buildReportingModel(
      input(
        [linked],
        [tracking(linked, 'provider', Date.UTC(2026, 8, 3))],
        [link],
      ),
    );

    expect(model.reconciliation.linked).toBe(1);
    expect(model.reconciliation.unlinked).toBe(0);
    expect(model.reconciliation.blocked).toBe(1);
    expect(model.executive.reconciliationPct).toBe(0);
  });

  it('mantiene fechas inválidas visibles en el reporte de calidad', () => {
    const invalid = campaign('invalid', 'Institucional', 'no-fecha', '');
    const model = buildReportingModel(
      input(
        [invalid],
        [tracking(invalid, 'institutional', Date.UTC(2026, 8, 3))],
      ),
    );

    expect(model.executive.campaigns).toBe(1);
    expect(model.quality.invalidDates).toBe(1);
  });
});
