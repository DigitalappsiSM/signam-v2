import { describe, expect, it } from 'vitest';
import {
  classifyCampaign,
  parseCampaignType,
  ratioForType,
  requiresTestigos,
} from './campaignType';

describe('clasificación por tipo de campaña Ekon', () => {
  it('normaliza los cuatro tipos', () => {
    expect(parseCampaignType('Campaña Institucionales')).toBe(
      'institucionales',
    );
    expect(parseCampaignType('Campaña Liverpesos')).toBe('liverpesos');
    expect(parseCampaignType('Campaña Liverpool')).toBe('liverpool');
    expect(parseCampaignType('General')).toBe('general');
    expect(parseCampaignType('otro')).toBeNull();
  });

  it('Institucionales y Liverpesos: Ratio 3, sin testigos', () => {
    for (const t of ['institucionales', 'liverpesos'] as const) {
      expect(ratioForType(t)).toBe('ratio3');
      expect(requiresTestigos(t)).toBe(false);
    }
  });

  it('Liverpool y General: Ratio 1, con testigos', () => {
    for (const t of ['liverpool', 'general'] as const) {
      expect(ratioForType(t)).toBe('ratio1');
      expect(requiresTestigos(t)).toBe(true);
    }
  });

  it('campaña mixta con al menos una línea Ratio 1 → Ratio 1 global', () => {
    const res = classifyCampaign(['institucionales', 'liverpesos', 'general']);
    expect(res.ratio).toBe('ratio1');
    expect(res.requiresTestigos).toBe(true);
  });

  it('todas Ratio 3 → Ratio 3 global sin testigos', () => {
    const res = classifyCampaign(['institucionales', 'liverpesos']);
    expect(res.ratio).toBe('ratio3');
    expect(res.requiresTestigos).toBe(false);
  });
});
