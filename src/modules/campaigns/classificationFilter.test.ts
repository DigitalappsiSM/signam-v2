import { describe, it, expect } from 'vitest';
import {
  matchesClassification,
  resolveClassifications,
} from './classificationFilter';
import { campaignIdentity, type StoredCampaign } from './campaignDiff';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';

function camp(id: string, name: string, tipo: string): StoredCampaign {
  return {
    row: 2,
    name,
    tipo,
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '1/8/26',
    fechaFin: '30/8/26',
    mes: 'AGOSTO',
    link: '',
    supports: [],
    id,
    nameKey: name.toUpperCase(),
    signature: id,
  } as StoredCampaign;
}

function tracking(
  over: Partial<CampaignOperationalTracking>,
): CampaignOperationalTracking {
  return {
    campaignNameKey: '',
    classification: 'provider',
    ...over,
  } as CampaignOperationalTracking;
}

describe('resolveClassifications', () => {
  it('sin seguimiento deduce desde "Tipo de Campaña"', () => {
    const m = resolveClassifications(
      [
        camp('a', 'A', 'ISM/INSTITUCIONAL 1'),
        camp('b', 'B', 'ISM/PROVEEDOR'),
        camp('c', 'C', ''),
      ],
      [],
    );
    expect(m.get('a')).toBe('institutional');
    expect(m.get('b')).toBe('provider');
    expect(m.get('c')).toBe('unknown');
  });

  it('la clasificación guardada en Seguimiento operativo manda sobre tipo', () => {
    const m = resolveClassifications(
      [camp('a', 'A', 'ISM/INSTITUCIONAL 1'), camp('c', 'C', '')],
      [
        tracking({ campaignId: 'a', classification: 'provider' }),
        tracking({ campaignId: 'c', classification: 'institutional' }),
      ],
    );
    expect(m.get('a')).toBe('provider');
    expect(m.get('c')).toBe('institutional');
  });

  it('respeta documentos legacy por identidad', () => {
    const c = camp('a', 'A', 'ISM/PROVEEDOR');
    const m = resolveClassifications(
      [c],
      [
        tracking({
          campaignNameKey: campaignIdentity(c),
          classification: 'institutional',
        }),
      ],
    );
    expect(m.get('a')).toBe('institutional');
  });
});

describe('matchesClassification', () => {
  it('"all" deja pasar todo; lo demás exige coincidencia exacta', () => {
    expect(matchesClassification('provider', 'all')).toBe(true);
    expect(matchesClassification('provider', 'provider')).toBe(true);
    expect(matchesClassification('institutional', 'provider')).toBe(false);
    expect(matchesClassification(undefined, 'unknown')).toBe(true);
    expect(matchesClassification('unknown', 'provider')).toBe(false);
  });
});
