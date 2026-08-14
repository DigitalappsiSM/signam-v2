import { describe, expect, it } from 'vitest';
import {
  buildReconciliationRows,
  filterReconciliationRows,
  summarizeReconciliation,
} from './reconciliationView';
import { assignmentsFromSpecs } from '@/domain/ekon/fixtures';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { CampaignEkonLink } from '@/services/campaignEkonLinks';

const P32 = {
  'ID Periodo': '32',
  'Inicio periodo': 46231,
  'Fin periodo': 46237,
};

function campaign(id: string, name: string): StoredCampaign {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    signature: 's',
    tipo: 'Institucional',
    vendidoPor: '',
    fechaInicio: '2026-07-28',
    fechaFin: '2026-08-03',
    mes: 'Agosto',
    link: '',
    row: 1,
    supports: [
      {
        support: 'MEGA MUPI DIGITAL',
        owner: 'liverpool',
        stores: [{ numero: '10', nombre: '' }],
      },
    ],
  };
}

function link(campaignId: string, number: number): CampaignEkonLink {
  return {
    id: campaignId,
    campaignId,
    campaignNameKey: 'k',
    campaignName: 'n',
    ekonCampaignNumber: number,
    createdAt: 0,
    createdBy: 'x',
    updatedAt: 0,
    updatedBy: 'x',
  };
}

describe('vista de conciliación', () => {
  it('solo aparecen campañas con vínculo manual', () => {
    const campaigns = [campaign('c1', 'Uno'), campaign('c2', 'Dos')];
    const links = [link('c1', 30001)];
    const rows = buildReconciliationRows(campaigns, links, new Map());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.campaign.id).toBe('c1');
  });

  it('un mismo número Ekon puede conciliar varias campañas independientes', () => {
    const campaigns = [campaign('c1', 'Uno'), campaign('c2', 'Dos')];
    const links = [link('c1', 30001), link('c2', 30001)];
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Campaña: '30001',
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '10',
      },
    ]);
    const rows = buildReconciliationRows(
      campaigns,
      links,
      new Map([['30001', assignments]]),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.result.ekonExists)).toBe(true);
  });

  it('número asociado inexistente muestra error y no se reasigna', () => {
    const campaigns = [campaign('c1', 'Uno')];
    const links = [link('c1', 99999)];
    const rows = buildReconciliationRows(campaigns, links, new Map());
    expect(rows[0]!.result.status).toBe('sin-campana-ekon');
  });

  it('filtra por texto y estado, y resume por categoría', () => {
    const campaigns = [campaign('c1', 'Alfa'), campaign('c2', 'Beta')];
    const links = [link('c1', 30001), link('c2', 40001)];
    const assignments = assignmentsFromSpecs([
      {
        ...P32,
        Campaña: '30001',
        Artículo: 'MEGA MUPI DIGITAL',
        Determinante: '10',
      },
    ]);
    const rows = buildReconciliationRows(
      campaigns,
      links,
      new Map([['30001', assignments]]),
    );
    expect(
      filterReconciliationRows(rows, {
        text: 'alfa',
        status: 'all',
        onlyIssues: false,
      }),
    ).toHaveLength(1);
    const summary = summarizeReconciliation(rows);
    expect(summary.conciliadas + summary.advertencias + summary.error).toBe(2);
  });
});
