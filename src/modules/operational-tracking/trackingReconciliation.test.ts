import { describe, expect, it } from 'vitest';
import {
  campaignIdentity,
  type StoredCampaign,
} from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking } from './types';
import { campaignsMissingOperationalTracking } from './trackingReconciliation';

function stored(id: string, name: string, active = true): StoredCampaign {
  return {
    id,
    row: 2,
    name,
    nameKey: name.toLowerCase(),
    signature: `sig-${id}`,
    tipo: 'PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '2026-08-17',
    fechaFin: '2026-08-31',
    mes: 'Agosto',
    link: '',
    supports: [],
    active,
  };
}

describe('campaignsMissingOperationalTracking', () => {
  it('reporta solo campañas activas sin seguimiento', () => {
    const tramontina = stored('c1', 'TRAMONTINA');
    const magfesa = stored('c2', 'MAGFESA');
    const inactive = stored('c3', 'ANTERIOR', false);
    const tracking = [
      { campaignId: 'c2', campaignNameKey: 'magfesa' },
    ] as CampaignOperationalTracking[];

    expect(
      campaignsMissingOperationalTracking(
        [tramontina, magfesa, inactive],
        tracking,
      ),
    ).toEqual([tramontina]);
  });

  it('reconoce un seguimiento legacy por identidad', () => {
    const tramontina = stored('c1', 'TRAMONTINA');
    const tracking = [
      { campaignNameKey: campaignIdentity(tramontina) },
    ] as CampaignOperationalTracking[];

    expect(campaignsMissingOperationalTracking([tramontina], tracking)).toEqual(
      [],
    );
  });
});
