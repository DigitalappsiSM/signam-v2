import { describe, it, expect } from 'vitest';
import {
  campaignToManualInput,
  hasMarkedWitnesses,
  manualEditBlocker,
  manualEditChanges,
  manualEditComment,
} from './manualCampaignEdit';
import { buildManualCampaign, validateManualCampaign } from './manualCampaign';
import type { StoredCampaign } from './campaignDiff';

function stored(over: Partial<StoredCampaign> = {}): StoredCampaign {
  const base = buildManualCampaign({
    name: 'Nike Sampling',
    tipo: 'Sampling',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-15',
    supports: [
      {
        support: 'VIDEO WALL CRIUS',
        scope: 'selected',
        stores: [
          { numero: '78', nombre: 'GDL' },
          { numero: '2', nombre: 'MTY' },
        ],
      },
      { support: 'LED', scope: 'all', stores: [] },
    ],
  });
  return {
    ...base,
    id: 'm1',
    nameKey: 'nike sampling',
    signature: 'x',
    origin: 'manual',
    ...over,
  };
}

describe('manualEditBlocker', () => {
  it('permite editar una manual activa', () => {
    expect(manualEditBlocker(stored())).toBeNull();
  });
  it('no permite editar una ya adoptada por Liverpool', () => {
    expect(manualEditBlocker(stored({ origin: 'liverpool' }))).toContain(
      'Corregir',
    );
  });
  it('no permite editar una inactiva', () => {
    expect(manualEditBlocker(stored({ active: false }))).not.toBeNull();
  });
});

describe('campaignToManualInput', () => {
  it('precarga un formulario válido y sin cambios', () => {
    const c = stored();
    const input = campaignToManualInput(c);
    expect(validateManualCampaign(input)).toEqual([]);
    expect(input.supports.map((s) => s.scope)).toEqual(['selected', 'all']);
    expect(
      manualEditChanges(c, { ...buildManualCampaign(input), row: c.row }),
    ).toEqual([]);
  });

  it('normaliza fechas guardadas con otro formato a ISO', () => {
    const input = campaignToManualInput(
      stored({ fechaInicio: '01/10/2026', fechaFin: '15/10/2026' }),
    );
    expect(input.fechaInicio).toBe('2026-10-01');
    expect(input.fechaFin).toBe('2026-10-15');
  });
});

describe('manualEditChanges', () => {
  it('detecta tiendas quitadas/agregadas y cambio de vigencia', () => {
    const c = stored();
    const input = campaignToManualInput(c);
    input.fechaFin = '2026-10-20';
    input.supports[0]!.stores = [{ numero: '2', nombre: 'MTY' }];
    const changes = manualEditChanges(c, buildManualCampaign(input));
    expect(changes.some((x) => x.startsWith('Vigencia fin'))).toBe(true);
    expect(changes.some((x) => x.includes('Tiendas de'))).toBe(true);
  });
});

describe('utilidades', () => {
  it('el comentario del historial incluye cambios, motivo y autor', () => {
    const text = manualEditComment(['A → B'], ' error ', 'a@b.c', 0);
    expect(text).toContain('A → B');
    expect(text).toContain('Motivo: error');
    expect(text).toContain('a@b.c');
  });

  it('detecta testigos marcados', () => {
    expect(hasMarkedWitnesses(null)).toBe(false);
    expect(
      hasMarkedWitnesses({
        witnessStart: { completed: true },
        witnessComplete: { completed: false },
      }),
    ).toBe(true);
    expect(
      hasMarkedWitnesses({
        witnessStart: { completed: false },
        witnessComplete: { completed: false },
      }),
    ).toBe(false);
  });
});

describe('edición de Mupi/Pendón sin detalle', () => {
  it('reabre como «tiendas de Ekon» y no marca cambios', () => {
    const c = stored({
      supports: [
        {
          support: "MUPPI'S",
          owner: 'instore-media',
          stores: [],
          scope: 'all',
          scopeSource: 'no-comment',
        },
      ],
    });
    const input = campaignToManualInput(c);
    expect(input.supports[0]!.scope).toBe('ekon');
    expect(
      manualEditChanges(c, { ...buildManualCampaign(input), row: c.row }),
    ).toEqual([]);
  });
});
