import { describe, it, expect } from 'vitest';
import {
  campaignSignature,
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

  it('deduplica el calendario entrante: la campaña repetida se agrega una vez', () => {
    const diff = diffCampaigns([camp('Nike'), camp('Nike')], []);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]!.name).toBe('Nike');
  });

  it('autolimpia duplicados en BD: conserva uno y elimina el resto', () => {
    const s = [
      stored(camp('Nike'), 'id1'),
      stored(camp('Nike'), 'id2'), // duplicado redundante (mismo nameKey)
    ];
    const diff = diffCampaigns([camp('Nike')], s);
    // Un documento se conserva (unchanged) y el duplicado se marca para borrar.
    expect(diff.removed.map((c) => c.id)).toEqual(['id2']);
    expect(diff.unchanged).toBe(1);
    expect(diff.hasChanges).toBe(true);
  });
});

describe('dedupeIncoming', () => {
  it('une soportes/tiendas, toma el span más amplio y el mejor link', () => {
    const a = camp('HIPER X', {
      fechaInicio: '3/5/26',
      fechaFin: '3/15/26',
      link: '',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [{ numero: '1', nombre: 'A' }],
        },
      ],
    });
    const b = camp('hiper  x', {
      fechaInicio: '3/1/26',
      fechaFin: '3/20/26',
      link: 'https://x.com/a.zip',
      supports: [
        {
          support: 'VIDEO WALL',
          owner: 'liverpool',
          stores: [{ numero: '2', nombre: 'B' }],
        },
      ],
    });
    const [merged, ...rest] = dedupeIncoming([a, b]);
    expect(rest).toHaveLength(0); // una sola campaña
    expect(merged!.fechaInicio).toBe('3/1/26');
    expect(merged!.fechaFin).toBe('3/20/26');
    expect(merged!.link).toBe('https://x.com/a.zip');
    // Tiendas unidas bajo el mismo soporte.
    expect(merged!.supports).toHaveLength(1);
    expect(merged!.supports[0]!.stores.map((s) => s.numero).sort()).toEqual([
      '1',
      '2',
    ]);
  });

  it('deja el tipo vacío (Pendiente) si las copias discrepan', () => {
    const a = camp('X', { tipo: 'INSTITUCIONAL' });
    const b = camp('X', { tipo: 'PROVEEDOR' });
    expect(dedupeIncoming([a, b])[0]!.tipo).toBe('');
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
