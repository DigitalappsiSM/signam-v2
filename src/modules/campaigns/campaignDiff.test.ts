import { describe, it, expect } from 'vitest';
import {
  campaignSignature,
  campaignIdentity,
  diffCampaigns,
  dedupeIncoming,
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
    // La identidad (todos los datos) es la llave persistida, igual que en prod.
    nameKey: campaignIdentity(c),
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

  it('un cambio de datos se refleja como alta + baja (identidad = todos los datos)', () => {
    const s = [stored(camp('Nike'))];
    const diff = diffCampaigns([camp('Nike', { fechaFin: '3/1/26' })], s);
    // La versión nueva es alta; la anterior, baja. No hay "modificadas".
    expect(diff.added).toHaveLength(1);
    expect(diff.removed.map((c) => c.id)).toEqual(['id1']);
    expect(diff.modified).toHaveLength(0);
  });

  it('detecta eliminadas (en BD, ya no en el calendario)', () => {
    const s = [stored(camp('Nike')), stored(camp('Vieja'), 'id2')];
    const diff = diffCampaigns([camp('Nike')], s);
    expect(diff.removed.map((c) => c.name)).toEqual(['Vieja']);
  });

  it('dos "flights" del mismo nombre (distinta vigencia) son dos altas', () => {
    const jul = camp('HIPER X', {
      fechaInicio: '7/15/26',
      fechaFin: '7/31/26',
    });
    const ago = camp('HIPER X', { fechaInicio: '8/11/26', fechaFin: '9/7/26' });
    const diff = diffCampaigns([jul, ago], []);
    expect(diff.added).toHaveLength(2);
    // Identidades distintas: no se colapsan.
    expect(campaignIdentity(jul)).not.toBe(campaignIdentity(ago));
  });

  it('autolimpia solo documentos IDÉNTICOS en BD (misma identidad)', () => {
    const s = [
      stored(camp('Nike'), 'id1'),
      stored(camp('Nike'), 'id2'), // idéntico → misma identidad → redundante
    ];
    const diff = diffCampaigns([camp('Nike')], s);
    expect(diff.removed.map((c) => c.id)).toEqual(['id2']);
    expect(diff.unchanged).toBe(1);
  });
});

describe('dedupeIncoming', () => {
  it('colapsa solo filas idénticas (misma identidad)', () => {
    const out = dedupeIncoming([camp('Nike'), camp('Nike')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('Nike');
  });

  it('conserva flights distintos: mismo nombre, distinta vigencia/tiendas', () => {
    const jul = camp('HIPER X', {
      fechaInicio: '7/15/26',
      fechaFin: '7/31/26',
      supports: [
        {
          support: 'APARADOR',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: '' }],
        },
      ],
    });
    const ago = camp('HIPER X', {
      fechaInicio: '8/11/26',
      fechaFin: '9/7/26',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [{ numero: '2', nombre: '' }],
        },
      ],
    });
    expect(dedupeIncoming([jul, ago])).toHaveLength(2);
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
