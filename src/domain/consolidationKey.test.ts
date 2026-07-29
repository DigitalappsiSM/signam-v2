import { describe, it, expect } from 'vitest';
import { buildConsolidationKey, normalizeResolution } from './consolidationKey';

describe('normalizeResolution', () => {
  it('colapsa espacios y pasa a mayúsculas', () => {
    expect(normalizeResolution('914 x 908')).toBe('914 X 908');
    expect(normalizeResolution('  900   X   900 ')).toBe('900 X 900');
  });
});

describe('buildConsolidationKey', () => {
  it('agrupa por campaña + resolución', () => {
    const a = buildConsolidationKey('Nike Verano', '914 x 908');
    const b = buildConsolidationKey('Nike Verano', '914 X 908');
    expect(a).toBe(b);
  });

  it('separa resoluciones distintas', () => {
    const a = buildConsolidationKey('Nike Verano', '914 x 908');
    const b = buildConsolidationKey('Nike Verano', '900 x 900');
    expect(a).not.toBe(b);
  });
});
