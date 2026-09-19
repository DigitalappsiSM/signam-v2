import { describe, it, expect } from 'vitest';
import type {
  QuividiCampaignReport,
  QuividiSupportDay,
  QuividiSupportHour,
} from '@/domain';
import {
  brandDayParts,
  brandFindings,
  brandHeader,
  brandHours,
  brandKpis,
  brandRecommendations,
  brandStoreRows,
  brandWeekdays,
  displayWindowFor,
  extendedWindowStores,
  hoursInDisplayWindow,
  medianOf,
  periodDays,
} from './quividiBrandReport';

function day(
  overrides: Partial<QuividiSupportDay> & { date: string },
): QuividiSupportDay {
  return {
    storeNumber: '3',
    storeName: 'POLANCO',
    support: 'MUPI DIGITAL',
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete',
    ots: 1000,
    effectiveOts: 800,
    watchers: 150,
    attentionSeconds: 3,
    dwellSeconds: 20,
    ...overrides,
  };
}

function hour(
  overrides: Partial<QuividiSupportHour> & { date: string; hour: number },
): QuividiSupportHour {
  return {
    storeNumber: '3',
    storeName: 'POLANCO',
    support: 'MUPI DIGITAL',
    configuredCameras: 1,
    measuredCameras: 1,
    status: 'complete',
    ots: 100,
    effectiveOts: 80,
    watchers: 15,
    attentionSeconds: 3,
    dwellSeconds: 20,
    ...overrides,
  };
}

function report(
  overrides: Partial<QuividiCampaignReport> = {},
): QuividiCampaignReport {
  return {
    schemaVersion: 3,
    campaignId: 'c1',
    campaignName: 'VENTA PERFUMERÍA',
    startDate: '2026-08-11',
    endDate: '2026-08-24',
    generatedAt: 0,
    scopeOrigins: [],
    coverage: { totalPairs: 0, mappedPairs: 0, percent: 0, bySupport: [] },
    cameraDays: [],
    supportDays: [],
    supportHours: [],
    demographics: [],
    incidents: [],
    unmappedCameraNames: [],
    ...overrides,
  };
}

describe('ventana de exhibición', () => {
  it('comunica de 10 a 22 h en una tienda normal', () => {
    expect(displayWindowFor('SANTA FE')).toEqual({ start: 10, end: 22 });
  });

  it('amplía a las 08:00 en Polanco, cuya pantalla está en restaurante', () => {
    expect(displayWindowFor('POLANCO')).toEqual({ start: 8, end: 22 });
    expect(displayWindowFor('l polanco derecho')).toEqual({
      start: 8,
      end: 22,
    });
  });

  it('descarta horas fuera de la ventana de cada tienda', () => {
    const rows = hoursInDisplayWindow(
      report({
        supportHours: [
          hour({ date: '2026-08-11', hour: 6 }),
          hour({ date: '2026-08-11', hour: 8 }),
          hour({ date: '2026-08-11', hour: 15 }),
          hour({ date: '2026-08-11', hour: 22 }),
          hour({
            date: '2026-08-11',
            hour: 8,
            storeNumber: '7',
            storeName: 'SANTA FE',
          }),
          hour({
            date: '2026-08-11',
            hour: 15,
            storeNumber: '7',
            storeName: 'SANTA FE',
          }),
        ],
      }),
    );
    expect(rows.map((row) => `${row.storeName}:${row.hour}`).sort()).toEqual([
      'POLANCO:15',
      'POLANCO:8',
      'SANTA FE:15',
    ]);
  });

  it('nombra las tiendas con ventana ampliada para la nota al pie', () => {
    expect(
      extendedWindowStores(
        report({
          supportDays: [
            day({ date: '2026-08-11' }),
            day({
              date: '2026-08-11',
              storeNumber: '7',
              storeName: 'SANTA FE',
            }),
          ],
        }),
      ),
    ).toEqual(['POLANCO']);
  });
});

describe('periodo y encabezado', () => {
  it('cuenta los días de vigencia con ambos extremos', () => {
    expect(periodDays(report())).toBe(14);
  });

  it('resume tiendas, pantallas y soporte sin hablar de cámaras', () => {
    const header = brandHeader(
      report({
        supportDays: [
          day({ date: '2026-08-11' }),
          day({
            date: '2026-08-11',
            storeNumber: '7',
            storeName: 'SANTA FE',
          }),
          day({
            date: '2026-08-12',
            storeNumber: '9',
            storeName: 'OAXACA',
            status: 'missing',
          }),
        ],
      }),
    );
    expect(header.stores).toBe(2);
    expect(header.supports).toEqual(['MUPI DIGITAL']);
    expect(header.windowLabel).toBe('10:00 – 22:00 h');
    expect(header.periodLabel).toBe('11/08/2026 – 24/08/2026');
  });
});

describe('KPIs de portada', () => {
  const kpis = brandKpis(
    report({
      supportDays: [
        day({ date: '2026-08-11', ots: 1000, watchers: 150 }),
        day({ date: '2026-08-12', ots: 1000, watchers: 250 }),
      ],
    }),
  );

  it('usa los términos con los que ya se habla al cliente', () => {
    expect(kpis.map((kpi) => kpi.label)).toEqual([
      'OTS',
      'Watchers',
      'Conversion ratio',
      'Attention time',
      'Dwell time',
      'OTS diario promedio',
    ]);
  });

  it('calcula el conversion ratio sobre el total del periodo', () => {
    expect(kpis[2]?.value).toBe('20.0%');
  });

  it('acompaña cada cifra con su definición, sin glosario aparte', () => {
    expect(kpis.every((kpi) => kpi.meaning.length > 0)).toBe(true);
  });

  it('no publica comparativos contra otros periodos', () => {
    const texto = kpis.map((kpi) => `${kpi.unit} ${kpi.meaning}`).join(' ');
    expect(texto).not.toMatch(/anterior|vs\.|▲|▼|%\s*(más|menos)/i);
  });
});

describe('jornada', () => {
  const base = report({
    supportHours: [
      hour({ date: '2026-08-11', hour: 9, ots: 500 }),
      hour({ date: '2026-08-11', hour: 11, ots: 100, watchers: 20 }),
      hour({ date: '2026-08-11', hour: 17, ots: 300, watchers: 30 }),
      hour({ date: '2026-08-15', hour: 17, ots: 200, watchers: 20 }),
    ],
  });

  it('agrega por hora dentro de la ventana', () => {
    const hours = brandHours(base);
    expect(hours.map((point) => point.hour)).toEqual([9, 11, 17]);
    expect(hours[2]?.ots).toBe(500);
  });

  it('reparte la jornada en momentos con share sobre el total visible', () => {
    const parts = brandDayParts(base);
    const total = parts.reduce((sum, part) => sum + part.share, 0);
    expect(Math.round(total)).toBe(100);
    expect(parts.find((part) => part.label === 'Tarde')?.ots).toBe(500);
  });

  it('marca sábado y domingo como fin de semana', () => {
    const weekend = brandWeekdays(base).filter((entry) => entry.weekend);
    expect(weekend.map((entry) => entry.label)).toEqual(['Sáb', 'Dom']);
    expect(weekend.find((entry) => entry.label === 'Sáb')?.ots).toBe(200);
  });
});

describe('tienda + soporte', () => {
  const rows = brandStoreRows(
    report({
      startDate: '2026-08-11',
      endDate: '2026-08-12',
      supportDays: [
        day({ date: '2026-08-11', ots: 900, watchers: 90 }),
        day({ date: '2026-08-12', ots: 900, watchers: 90 }),
        day({
          date: '2026-08-11',
          storeNumber: '7',
          storeName: 'SANTA FE',
          configuredCameras: 2,
          ots: 300,
          watchers: 60,
        }),
      ],
      supportHours: [
        hour({ date: '2026-08-11', hour: 17, ots: 400 }),
        hour({ date: '2026-08-11', hour: 11, ots: 100 }),
      ],
    }),
  );

  it('agrupa por tienda y soporte, nunca por cámara', () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]?.store).toBe('POLANCO');
    expect(rows[0]?.ots).toBe(1800);
  });

  it('reporta el número de pantallas de la tienda', () => {
    expect(rows.find((row) => row.store === 'SANTA FE')?.screens).toBe(2);
  });

  it('indexa contra la mediana del circuito en el mismo periodo', () => {
    expect(rows[0]?.index).toBe(171);
    expect(rows.find((row) => row.store === 'SANTA FE')?.index).toBe(29);
  });

  it('señala día y hora pico como referencia de promotoría', () => {
    expect(rows[0]?.peakHour).toBe('17–18 h');
  });

  it('calcula la mediana con número par de elementos', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25);
    expect(medianOf([])).toBe(0);
  });
});

describe('lecturas del informe', () => {
  const base = report({
    supportDays: [
      day({ date: '2026-08-11', ots: 1000, watchers: 200 }),
      day({ date: '2026-08-12', ots: 1000, watchers: 200 }),
    ],
    supportHours: [
      hour({ date: '2026-08-15', hour: 17, ots: 600, watchers: 90 }),
      hour({ date: '2026-08-11', hour: 11, ots: 400, watchers: 40 }),
    ],
    demographics: [
      {
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        gender: 2,
        age: 3,
        watchers: 300,
      },
      {
        date: '2026-08-11',
        storeNumber: '3',
        storeName: 'POLANCO',
        support: 'MUPI DIGITAL',
        gender: 1,
        age: 3,
        watchers: 100,
      },
    ],
  });

  it('redacta hallazgos sin comparar contra otros periodos', () => {
    const texto = brandFindings(base)
      .map((note) => `${note.title} ${note.body}`)
      .join(' ');
    expect(texto).toContain('OTS');
    expect(texto).not.toMatch(/periodo anterior|campaña previa|flight previo/i);
  });

  it('propone reforzar promotoría, nunca comprar franjas', () => {
    const texto = brandRecommendations(base)
      .map((note) => `${note.title} ${note.body}`)
      .join(' ');
    expect(texto).toContain('promotoría');
    expect(texto).not.toMatch(/pesar la pauta|segmentar|reservar la franja/i);
  });

  it('no nombra al proveedor de medición en ningún texto', () => {
    const texto = [
      ...brandFindings(base),
      ...brandRecommendations(base),
      ...brandKpis(base).map((kpi) => ({
        title: kpi.label,
        body: `${kpi.unit} ${kpi.meaning}`,
      })),
    ]
      .map((note) => `${note.title} ${note.body}`)
      .join(' ');
    expect(texto.toLowerCase()).not.toContain('quividi');
    expect(texto.toLowerCase()).not.toContain('vidicenter');
  });
});
