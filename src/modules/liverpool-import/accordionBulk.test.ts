import { describe, it, expect } from 'vitest';
import { nextBulk } from './accordionBulk';

describe('nextBulk', () => {
  it('arranca en nonce 1 desde null', () => {
    expect(nextBulk(null, true)).toEqual({ open: true, nonce: 1 });
    expect(nextBulk(null, false)).toEqual({ open: false, nonce: 1 });
  });

  it('incrementa el nonce en cada pulsación aunque open no cambie', () => {
    const a = nextBulk(null, false);
    const b = nextBulk(a, false);
    const c = nextBulk(b, false);
    expect([a.nonce, b.nonce, c.nonce]).toEqual([1, 2, 3]);
    expect(c.open).toBe(false);
  });

  it('conserva el open pedido', () => {
    expect(nextBulk({ open: false, nonce: 5 }, true)).toEqual({
      open: true,
      nonce: 6,
    });
  });
});
