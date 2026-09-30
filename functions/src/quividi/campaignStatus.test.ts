import { describe, expect, it } from 'vitest';
import { quividiBlockedReason } from './campaignStatus';

describe('quividiBlockedReason', () => {
  it('permite campañas activas, en pausa y legacy sin estado', () => {
    expect(quividiBlockedReason({}, undefined)).toBeNull();
    expect(
      quividiBlockedReason({ active: true }, { lifecycleStatus: 'active' }),
    ).toBeNull();
    expect(
      quividiBlockedReason({ active: true }, { lifecycleStatus: 'paused' }),
    ).toBeNull();
  });

  it('bloquea canceladas, duplicadas y retiradas del calendario', () => {
    expect(quividiBlockedReason({}, { lifecycleStatus: 'cancelled' })).toMatch(
      /cancelada/,
    );
    expect(quividiBlockedReason({}, { lifecycleStatus: 'duplicate' })).toMatch(
      /duplicada/,
    );
    expect(quividiBlockedReason({ active: false }, undefined)).toMatch(
      /retirada/,
    );
  });
});
