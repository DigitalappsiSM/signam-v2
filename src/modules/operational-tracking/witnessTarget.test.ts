import { describe, it, expect } from 'vitest';
import { witnessStartTarget } from './witnessTarget';

describe('witnessStartTarget', () => {
  it('aplica ceil(n * 0.10) con los casos de la especificación', () => {
    expect(witnessStartTarget(0)).toBe(0);
    expect(witnessStartTarget(1)).toBe(1);
    expect(witnessStartTarget(2)).toBe(1);
    expect(witnessStartTarget(10)).toBe(1);
    expect(witnessStartTarget(11)).toBe(2);
    expect(witnessStartTarget(85)).toBe(9);
  });

  it('trata valores inválidos como 0', () => {
    expect(witnessStartTarget(-5)).toBe(0);
    expect(witnessStartTarget(Number.NaN)).toBe(0);
  });
});
