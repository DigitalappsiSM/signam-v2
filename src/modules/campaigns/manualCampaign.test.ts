import { describe, it, expect } from 'vitest';
import {
  buildManualCampaign,
  campaignOrigin,
  datesRelation,
  nameRelation,
  scoreManualMatch,
  validateManualCampaign,
  type ManualCampaignInput,
} from './manualCampaign';
import type { ParsedCampaign } from '@/modules/liverpool-import/campaignParse';

function input(over: Partial<ManualCampaignInput> = {}): ManualCampaignInput {
  return {
    name: 'Nike Sampling',
    tipo: 'Sampling',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-15',
    supports: [
      {
        support: 'VIDEO WALL CRIUS',
        scope: 'selected',
        stores: [{ numero: '78', nombre: 'GDL' }],
      },
    ],
    ...over,
  };
}

function camp(over: Partial<ParsedCampaign> = {}): ParsedCampaign {
  return { ...buildManualCampaign(input()), row: 5, ...over };
}

describe('validateManualCampaign', () => {
  it('acepta una campaña completa', () => {
    expect(validateManualCampaign(input())).toEqual([]);
  });

  it('exige nombre, tipo de la lista, fechas coherentes y soportes', () => {
    const errors = validateManualCampaign(
      input({
        name: ' ',
        tipo: 'Otro',
        fechaInicio: '2026-10-20',
        fechaFin: '2026-10-01',
        supports: [],
      }),
    );
    expect(errors).toHaveLength(4);
  });

  it('rechaza soportes repetidos o con alcance seleccionado sin tiendas', () => {
    const errors = validateManualCampaign(
      input({
        supports: [
          { support: 'LED', scope: 'selected', stores: [] },
          { support: 'led', scope: 'all', stores: [] },
        ],
      }),
    );
    expect(
      errors.some(
        (e) => e.includes('sin tiendas') || e.includes('no tiene tiendas'),
      ),
    ).toBe(true);
    expect(errors.some((e) => e.includes('repetido'))).toBe(true);
  });
});

describe('buildManualCampaign', () => {
  it('produce la misma forma que una campaña importada', () => {
    const c = buildManualCampaign(input());
    expect(c.mes).toBe('OCTUBRE');
    expect(c.row).toBe(0);
    expect(c.supports[0]).toMatchObject({
      support: 'VIDEO WALL CRIUS',
      owner: 'liverpool',
      scope: 'selected',
    });
  });

  it('alcance "todas" no guarda tiendas', () => {
    const c = buildManualCampaign(
      input({ supports: [{ support: 'LED', scope: 'all', stores: [] }] }),
    );
    expect(c.supports[0]).toMatchObject({ scope: 'all', stores: [] });
  });
});

describe('origen', () => {
  it('los documentos legacy son de Liverpool', () => {
    expect(campaignOrigin({})).toBe('liverpool');
    expect(campaignOrigin({ origin: 'manual' })).toBe('manual');
  });
});

describe('relaciones', () => {
  it('nombres: igual sin acentos, similar por contención', () => {
    expect(nameRelation('Nike Verano', ' nike  verano ')).toBe('equal');
    expect(nameRelation('Nikë Verano', 'Nike verano')).toBe('equal');
    expect(nameRelation('Nike Verano Sampling', 'Nike Verano')).toBe('similar');
    expect(nameRelation('Adidas', 'Nike')).toBe('none');
  });

  it('fechas: exactas, traslapadas o ajenas', () => {
    const a = { fechaInicio: '2026-10-01', fechaFin: '2026-10-15' };
    expect(datesRelation(a, a)).toBe('exact');
    expect(
      datesRelation(a, { fechaInicio: '10/10/2026', fechaFin: '2026-10-30' }),
    ).toBe('overlap');
    expect(
      datesRelation(a, { fechaInicio: '2026-11-01', fechaFin: '2026-11-30' }),
    ).toBe('none');
  });
});

describe('scoreManualMatch', () => {
  const manual = camp();

  it('nombre igual + fechas idénticas = sugerida', () => {
    const r = scoreManualMatch(camp({ name: 'NIKE SAMPLING' }), manual);
    expect(r?.level).toBe('strong');
  });

  it('mismo nombre con otras fechas traslapadas = posible duplicado', () => {
    const r = scoreManualMatch(
      camp({ fechaInicio: '2026-10-05', fechaFin: '2026-10-25' }),
      manual,
    );
    expect(r?.level).toBe('partial');
  });

  it('mismo nombre exacto sin traslape = solo aviso, nunca sugerida', () => {
    const r = scoreManualMatch(
      camp({ fechaInicio: '2027-01-01', fechaFin: '2027-01-10' }),
      manual,
    );
    expect(r?.level).toBe('partial');
  });

  it('nombre distinto y fechas ajenas = sin relación', () => {
    const r = scoreManualMatch(
      camp({
        name: 'Adidas',
        fechaInicio: '2027-01-01',
        fechaFin: '2027-01-10',
      }),
      manual,
    );
    expect(r).toBeNull();
  });

  it('mismas fechas y tiendas con otro nombre = posible duplicado', () => {
    const r = scoreManualMatch(camp({ name: 'Promo Zapatos' }), manual);
    expect(r?.level).toBe('partial');
  });
});

describe('findManualDuplicates / manualSupportOptions', () => {
  it('bloquea una igual (nombre + fechas) y avisa de las parecidas', async () => {
    const { findManualDuplicates } = await import('./manualCampaign');
    const existing = [
      { ...camp({ name: 'Nike Sampling' }), id: 'a' },
      { ...camp({ name: 'Nike', fechaInicio: '2026-10-05' }), id: 'b' },
      {
        ...camp({
          name: 'Otra',
          fechaInicio: '2030-01-01',
          fechaFin: '2030-01-02',
        }),
        id: 'c',
      },
      { ...camp({ name: 'Nike Sampling' }), id: 'd', active: false },
    ];
    const r = findManualDuplicates(camp(), existing);
    expect(r.blocking.map((x) => x.campaign.id)).toEqual(['a']);
    expect(r.warnings.map((x) => x.campaign.id)).toEqual(['b']);
  });

  it('opciones: solo soportes con pantallas activas, tiendas sin ceros', async () => {
    const { manualSupportOptions } = await import('./manualCampaign');
    const screen = (
      id: string,
      support: string,
      store: string,
      active = true,
    ) =>
      ({
        id,
        original: {
          'Numero de Tienda': store,
          'Nombre de tienda': `T${store}`,
        },
        metadata: { calendarSupport: support, active },
      }) as never;
    const opts = manualSupportOptions([
      screen('1', 'LED', '0078'),
      screen('2', 'LED', '78'),
      screen('3', 'LED', '2'),
      screen('4', 'PANTALLA', '9', false),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]!.stores.map((s) => s.numero)).toEqual(['2', '78']);
  });
});
