import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { loadCampaignAvailability } from './campaignAvailability';

function fixture(count: number, fallback = true, legacy = false) {
  let concurrent = 0;
  let maximum = 0;
  const assignmentRead = vi.fn(async () => {
    await Promise.resolve();
    return {
      docs: [
        {
          data: () => ({
            active: true,
            campaignNumber: '42',
            determinanteKey: '7',
            circuito: 'MEGA MUPI',
            inicioPeriodo: '2026-01-01',
            finPeriodo: '2026-12-31',
          }),
        },
      ],
    };
  });
  const legacyRead = vi.fn(async () => {
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 1));
    concurrent--;
    return { docs: [{ data: () => ({ ekonCampaignNumber: 42 }) }] };
  });
  const screensRead = vi.fn(async () => ({
    docs: [
      {
        data: () => ({
          original: { 'Numero de Tienda': '7' },
          metadata: {
            active: true,
            calendarSupport: 'MEGA MUPI DIGITAL',
            quividiCameraName: 'CAM-7',
          },
        }),
      },
    ],
  }));
  const collection = (name: string) => ({
    doc: (id: string) => ({ collection: name, id }),
    get: screensRead,
    where: (_field: string, _operator: string, value: string) => ({
      limit: () => ({ get: legacyRead }),
      where: () => ({ get: assignmentRead }),
      value,
    }),
  });
  const getAll = vi.fn(
    async (...refs: Array<{ collection: string; id: string }>) =>
      refs.map((ref) => ({
        id: ref.id,
        exists: ref.collection === 'campaigns' || !legacy,
        data: () =>
          ref.collection === 'campaigns'
            ? {
                name: ref.id,
                nameKey: legacy ? ref.id : 'same-name',
                fechaInicio: '2026-03-01',
                fechaFin: '2026-03-31',
                supports: [
                  {
                    support: 'MEGA MUPI DIGITAL',
                    scope: fallback ? 'all' : 'selected',
                    stores: fallback ? [] : [{ numero: '7' }],
                  },
                ],
              }
            : legacy
              ? undefined
              : { ekonCampaignNumber: 42 },
      })),
  );
  const db = { collection, getAll } as unknown as Firestore;
  return {
    db,
    ids: Array.from({ length: count }, (_, i) => `campaign-${i}`),
    getAll,
    assignmentRead,
    legacyRead,
    screensRead,
    maximum: () => maximum,
  };
}

describe('disponibilidad Quividi agrupada', () => {
  it('agrupa campañas/enlaces y comparte asignaciones entre campañas concurrentes', async () => {
    const f = fixture(20);
    const items = await loadCampaignAvailability(f.db, f.ids);
    expect(items.map((item) => item.campaignId)).toEqual(f.ids);
    expect(
      items.every(
        (item) =>
          item.available &&
          item.mappedPairs === 1 &&
          item.scopeOrigins[0]?.source === 'ekon',
      ),
    ).toBe(true);
    expect(f.getAll).toHaveBeenCalledTimes(2);
    expect(f.screensRead).toHaveBeenCalledTimes(1);
    expect(f.assignmentRead).toHaveBeenCalledTimes(1);
    expect(f.legacyRead).not.toHaveBeenCalled();
  });

  it('el calendario explícito no paga lecturas de enlaces ni asignaciones', async () => {
    const f = fixture(12, false);
    const items = await loadCampaignAvailability(f.db, f.ids);
    expect(
      items.every(
        (item) =>
          item.available &&
          item.scopeOrigins[0]?.source === 'calendar-selected',
      ),
    ).toBe(true);
    expect(f.getAll).toHaveBeenCalledTimes(1);
    expect(f.assignmentRead).not.toHaveBeenCalled();
  });

  it('limita la concurrencia del fallback legacy y mantiene el orden', async () => {
    const f = fixture(19, true, true);
    const items = await loadCampaignAvailability(f.db, f.ids);
    expect(items.map((item) => item.campaignId)).toEqual(f.ids);
    expect(f.maximum()).toBe(8);
    expect(f.assignmentRead).toHaveBeenCalledTimes(1);
  });

  it('no consulta Firestore si no hay campañas', async () => {
    const f = fixture(0);
    expect(await loadCampaignAvailability(f.db, [])).toEqual([]);
    expect(f.getAll).not.toHaveBeenCalled();
    expect(f.screensRead).not.toHaveBeenCalled();
  });
});
