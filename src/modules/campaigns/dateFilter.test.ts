import { describe, it, expect } from 'vitest';
import {
  parseCampaignDate,
  campaignIntersectsPeriod,
  periodError,
  hasPeriodFilter,
} from './dateFilter';

const iso = (s: string) => parseCampaignDate(s);

describe('parseCampaignDate', () => {
  it('parsea ISO YYYY-MM-DD en medianoche UTC', () => {
    const d = parseCampaignDate('2026-03-15');
    expect(d?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('parsea un ISO completo (Date.toISOString)', () => {
    const d = parseCampaignDate('2026-03-15T00:00:00.000Z');
    expect(d?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('parsea día-primero D/M/AAAA (locale MX)', () => {
    expect(parseCampaignDate('15/03/2026')?.toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
    expect(parseCampaignDate('01/12/2026')?.toISOString()).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('acepta año de dos dígitos y separador guion', () => {
    expect(parseCampaignDate('15-03-26')?.toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it('desambigua mes-primero cuando el segundo componente > 12', () => {
    // 03/15/2026 → 15 no puede ser mes: es día.
    expect(parseCampaignDate('03/15/2026')?.toISOString()).toBe(
      '2026-03-15T00:00:00.000Z',
    );
  });

  it('devuelve null para vacío o formato desconocido', () => {
    expect(parseCampaignDate('')).toBeNull();
    expect(parseCampaignDate('   ')).toBeNull();
    expect(parseCampaignDate('marzo 2026')).toBeNull();
    expect(parseCampaignDate('32/01/2026')).toBeNull(); // día inválido
    expect(parseCampaignDate('15/13/2026')).toBeNull(); // mes inválido
  });

  it('respeta años bisiestos', () => {
    expect(parseCampaignDate('2024-02-29')?.toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
    expect(parseCampaignDate('2026-02-29')).toBeNull();
  });
});

describe('periodError / hasPeriodFilter', () => {
  it('detecta el rango invertido', () => {
    expect(periodError('2026-05-10', '2026-05-01')).not.toBeNull();
  });

  it('acepta rangos válidos, límites iguales y extremos vacíos', () => {
    expect(periodError('2026-05-01', '2026-05-10')).toBeNull();
    expect(periodError('2026-05-01', '2026-05-01')).toBeNull();
    expect(periodError('', '2026-05-10')).toBeNull();
    expect(periodError('2026-05-01', '')).toBeNull();
    expect(periodError('', '')).toBeNull();
  });

  it('hasPeriodFilter refleja si hay algún extremo activo', () => {
    expect(hasPeriodFilter('', '')).toBe(false);
    expect(hasPeriodFilter('2026-05-01', '')).toBe(true);
    expect(hasPeriodFilter('', '2026-05-10')).toBe(true);
  });
});

describe('campaignIntersectsPeriod', () => {
  const start = '2026-05-10';
  const end = '2026-05-20';

  it('sin filtro (ambos null) siempre incluye', () => {
    expect(campaignIntersectsPeriod(start, end, null, null)).toBe(true);
  });

  it('ambos extremos: incluye si intersecta', () => {
    // periodo que solapa el final
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-05-15'),
        iso('2026-05-25'),
      ),
    ).toBe(true);
    // periodo que abarca por completo la campaña
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-05-01'),
        iso('2026-05-31'),
      ),
    ).toBe(true);
    // campaña que abarca por completo el periodo
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-05-12'),
        iso('2026-05-14'),
      ),
    ).toBe(true);
  });

  it('ambos extremos: excluye si no intersecta', () => {
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-06-01'),
        iso('2026-06-30'),
      ),
    ).toBe(false);
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-04-01'),
        iso('2026-04-30'),
      ),
    ).toBe(false);
  });

  it('coincidencia exacta en los límites es inclusiva', () => {
    // hasta == inicio de campaña
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-05-01'),
        iso('2026-05-10'),
      ),
    ).toBe(true);
    // desde == fin de campaña
    expect(
      campaignIntersectsPeriod(
        start,
        end,
        iso('2026-05-20'),
        iso('2026-05-31'),
      ),
    ).toBe(true);
  });

  it('solo Desde: incluye si el fin es posterior o igual', () => {
    expect(campaignIntersectsPeriod(start, end, iso('2026-05-20'), null)).toBe(
      true,
    );
    expect(campaignIntersectsPeriod(start, end, iso('2026-05-21'), null)).toBe(
      false,
    );
  });

  it('solo Hasta: incluye si el inicio es anterior o igual', () => {
    expect(campaignIntersectsPeriod(start, end, null, iso('2026-05-10'))).toBe(
      true,
    );
    expect(campaignIntersectsPeriod(start, end, null, iso('2026-05-09'))).toBe(
      false,
    );
  });

  it('usa la única fecha conocida si falta inicio o fin', () => {
    expect(campaignIntersectsPeriod('', end, iso('2026-05-20'), null)).toBe(
      true,
    );
    expect(campaignIntersectsPeriod(start, '', null, iso('2026-05-10'))).toBe(
      true,
    );
  });

  it('excluye campañas sin fechas cuando hay filtro activo', () => {
    expect(campaignIntersectsPeriod('', '', iso('2026-05-01'), null)).toBe(
      false,
    );
    expect(
      campaignIntersectsPeriod('sin fecha', 'x', null, iso('2026-05-01')),
    ).toBe(false);
  });
});
