import { describe, it, expect } from 'vitest';
import {
  campaignSignature,
  diffCampaigns,
  describeChanges,
  type StoredCampaign,
} from './campaignDiff';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

function camp(
  name: string,
  over: Partial<ParsedCampaign> = {},
): ParsedCampaign {
  return {
    row: 2,
    name,
    tipo: '',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '2/1/26',
    fechaFin: '2/16/26',
    mes: 'FEBRERO',
    link: '',
    supports: [
      {
        support: 'VIDEO WALL CRIUS',
        owner: 'liverpool',
        stores: [{ numero: '78', nombre: 'GDL' }],
      },
    ],
    ...over,
  };
}

function stored(c: ParsedCampaign, id = 'id1'): StoredCampaign {
  return {
    ...c,
    id,
    nameKey: c.name.trim().toLowerCase(),
    signature: campaignSignature(c),
  };
}

describe('campaignSignature', () => {
  it('es estable ante orden de tiendas y ceros a la izquierda', () => {
    const a = camp('X', {
      supports: [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '0078', nombre: '' },
            { numero: '2', nombre: '' },
          ],
        },
      ],
    });
    const b = camp('X', {
      supports: [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '2', nombre: '' },
            { numero: '78', nombre: '' },
          ],
        },
      ],
    });
    expect(campaignSignature(a)).toBe(campaignSignature(b));
  });

  it('cambia si cambia la vigencia', () => {
    expect(campaignSignature(camp('X'))).not.toBe(
      campaignSignature(camp('X', { fechaFin: '3/1/26' })),
    );
  });
});

describe('diffCampaigns', () => {
  it('detecta nuevas, sin cambios y sin reescribir', () => {
    const s = [stored(camp('Nike'))];
    const diff = diffCampaigns([camp('Nike'), camp('Adidas')], s);
    expect(diff.added.map((c) => c.name)).toEqual(['Adidas']);
    expect(diff.unchanged).toBe(1);
    expect(diff.modified).toHaveLength(0);
    expect(diff.hasChanges).toBe(true);
  });

  it('sin diferencias => hasChanges false', () => {
    const s = [stored(camp('Nike'))];
    const diff = diffCampaigns([camp('Nike')], s);
    expect(diff.hasChanges).toBe(false);
    expect(diff.unchanged).toBe(1);
  });

  it('detecta modificadas con el detalle del cambio', () => {
    const s = [stored(camp('Nike'))];
    const diff = diffCampaigns([camp('Nike', { fechaFin: '3/1/26' })], s);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]!.changes.join(' ')).toContain('Vigencia fin');
  });

  it('detecta eliminadas (en BD, ya no en el calendario)', () => {
    const s = [stored(camp('Nike')), stored(camp('Vieja'), 'id2')];
    const diff = diffCampaigns([camp('Nike')], s);
    expect(diff.removed.map((c) => c.name)).toEqual(['Vieja']);
  });
});

describe('describeChanges', () => {
  it('reporta cambios de tiendas por soporte', () => {
    const before = camp('X', {
      supports: [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '2', nombre: '' },
          ],
        },
      ],
    });
    const after = camp('X', {
      supports: [
        {
          support: 'LED',
          owner: 'liverpool',
          stores: [
            { numero: '1', nombre: '' },
            { numero: '3', nombre: '' },
          ],
        },
      ],
    });
    const changes = describeChanges(before, after);
    expect(changes.join(' ')).toContain('Tiendas de LED');
    expect(changes.join(' ')).toContain('+3');
    expect(changes.join(' ')).toContain('-2');
  });
});
