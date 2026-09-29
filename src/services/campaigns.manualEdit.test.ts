import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regla de Firestore que el SDK hace cumplir: en una transacción todas las
 * lecturas deben ir ANTES de la primera escritura. Este doble de prueba lanza el
 * mismo error que el SDK real para que una regresión no pase desapercibida.
 */
const h = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const log: string[] = [];
  return { docs, log };
});

vi.mock('./firebase', () => ({ getFirebase: () => ({ db: {} }) }));

vi.mock('firebase/firestore', () => {
  const path = (...parts: unknown[]) =>
    parts.filter((p) => typeof p === 'string').join('/');
  return {
    collection: (_db: unknown, ...p: string[]) => ({ path: path(...p) }),
    doc: (target: unknown, ...p: string[]) => {
      const base = (target as { path?: string }).path;
      const full = base ? [base, ...p].join('/') : path(...p);
      const parts = full.split('/');
      // `doc(collection(...))` sin id => id automático.
      const isCollection = parts.length % 2 === 1;
      const id = isCollection
        ? `auto${h.docs.size}`
        : (parts[parts.length - 1] ?? '');
      return { path: isCollection ? `${full}/${id}` : full, id };
    },
    deleteField: () => '__delete__',
    getDocs: async () => ({
      docs: [...h.docs]
        .filter(([k]) => /^campaigns\/[^/]+$/.test(k))
        .map(([k, v]) => ({ id: k.split('/')[1], data: () => v })),
    }),
    writeBatch: () => ({ set: vi.fn(), commit: vi.fn() }),
    runTransaction: async (
      _db: unknown,
      fn: (tx: unknown) => Promise<unknown>,
    ) => {
      let wrote = false;
      const tx = {
        get: async (ref: { path: string }) => {
          if (wrote) {
            throw new Error(
              'Firestore transactions require all reads to be executed before all writes.',
            );
          }
          h.log.push(`get ${ref.path}`);
          const data = h.docs.get(ref.path);
          return { exists: () => data !== undefined, data: () => data };
        },
        set: (ref: { path: string }, data: Record<string, unknown>) => {
          wrote = true;
          h.log.push(`set ${ref.path}`);
          h.docs.set(ref.path, { ...(h.docs.get(ref.path) ?? {}), ...data });
        },
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          wrote = true;
          h.log.push(`update ${ref.path}`);
          h.docs.set(ref.path, { ...(h.docs.get(ref.path) ?? {}), ...data });
        },
      };
      return fn(tx);
    },
  };
});

import { updateManualCampaign } from './campaigns';
import { buildManualCampaign } from '@/modules/campaigns/manualCampaign';

const actor = { uid: 'u1', email: 'a@b.c' };

function manualDoc() {
  const c = buildManualCampaign({
    name: 'Nike Sampling',
    tipo: 'Sampling',
    fechaInicio: '2026-10-01',
    fechaFin: '2026-10-15',
    supports: [
      {
        support: 'LED',
        scope: 'selected',
        stores: [{ numero: '1', nombre: 'A' }],
      },
    ],
  });
  return { ...c, nameKey: 'nike sampling', signature: 's', origin: 'manual' };
}

describe('updateManualCampaign — orden de la transacción', () => {
  beforeEach(() => {
    h.docs.clear();
    h.log.length = 0;
    h.docs.set('campaigns/m1', manualDoc());
    h.docs.set('campaignOperationalTracking/m1', {
      campaignName: 'Nike Sampling',
    });
  });

  it('lee campaña y seguimiento antes de escribir, y sincroniza el nombre', async () => {
    const edited = buildManualCampaign({
      name: 'Nike Sampling Otoño',
      tipo: 'Sampling',
      fechaInicio: '2026-10-01',
      fechaFin: '2026-10-20',
      supports: [
        {
          support: 'LED',
          scope: 'selected',
          stores: [
            { numero: '1', nombre: 'A' },
            { numero: '2', nombre: 'B' },
          ],
        },
      ],
    });
    const r = await updateManualCampaign({
      campaignId: 'm1',
      campaign: edited,
      reason: 'Se corrigieron tiendas',
      actor,
    });
    expect(r.changes.length).toBeGreaterThan(0);

    const firstWrite = h.log.findIndex((l) => /^(set|update) /.test(l));
    const lastRead = h.log.map((l) => l.startsWith('get ')).lastIndexOf(true);
    expect(lastRead).toBeLessThan(firstWrite);
    expect(h.docs.get('campaignOperationalTracking/m1')).toMatchObject({
      campaignName: 'Nike Sampling Otoño',
    });
    expect(h.docs.get('campaigns/m1')).toMatchObject({
      name: 'Nike Sampling Otoño',
    });
  });

  it('exige motivo y rechaza campañas ya adoptadas', async () => {
    const edited = {
      ...buildManualCampaign({
        name: 'X',
        tipo: 'Sampling',
        fechaInicio: '2026-10-01',
        fechaFin: '2026-10-02',
        supports: [{ support: 'LED', scope: 'all', stores: [] }],
      }),
    };
    await expect(
      updateManualCampaign({
        campaignId: 'm1',
        campaign: edited,
        reason: ' ',
        actor,
      }),
    ).rejects.toThrow('motivo');

    h.docs.set('campaigns/m1', { ...manualDoc(), origin: 'liverpool' });
    await expect(
      updateManualCampaign({
        campaignId: 'm1',
        campaign: edited,
        reason: 'x',
        actor,
      }),
    ).rejects.toThrow('Corregir');
  });
});
