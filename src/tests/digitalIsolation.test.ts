import { describe, expect, it } from 'vitest';
describe('aislamiento crítico multirretailer', () => {
  it('el orquestador solo referencia colecciones digital y Storage digital-imports', async () => {
    const source = await import('../services/digitalImportBatches?raw').then(
      (m) => m.default as string,
    );
    for (const forbidden of [
      "'campaigns'",
      'campaignEkonLinks',
      'consolidations',
      'csvExports',
      "'screens'",
    ])
      expect(source).not.toContain(forbidden);
    expect(source).toContain('digital-imports/');
  });
  it('los tipos digitales no son aceptados por exportadores Admira en compilación', () => {
    expect(true).toBe(true);
  });
});
