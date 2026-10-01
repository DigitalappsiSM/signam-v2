import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

// Solo el proyecto demo del emulador; nunca usa credenciales ni datos reales.
const projectId = 'demo-signam-tracking';
const actor = { uid: 'admin', email: 'admin@example.test' };
const event = (id) => ({
  id,
  from: 'paused',
  to: 'active',
  reason: { code: 'other', label: 'Otro', detail: 'Reactivada' },
  duplicateOfCampaignId: null,
  duplicateOfCampaignName: null,
  at: 1,
  byUid: actor.uid,
  byEmail: actor.email,
});
const base = {
  campaignId: 'krups',
  campaignNameKey: 'krups',
  campaignName: 'KRUPS',
  classification: 'provider',
  createdAt: 1,
  createdByUid: actor.uid,
  createdByEmail: actor.email,
  updatedAt: 1,
  lifecycleStatus: 'active',
  lifecycleUpdatedAt: 1,
  lifecycleUpdatedByUid: actor.uid,
  lifecycleUpdatedByEmail: actor.email,
  cancellationReason: null,
  statusHistory: [],
  passesEvidence: { completed: true },
};

test('seguimiento: historial vacío, migración y protección del prefijo', async (t) => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(
        new URL('../firestore.rules', import.meta.url),
        'utf8',
      ),
    },
  });
  const ref = (role, id) =>
    doc(
      env.authenticatedContext(role, { role }).firestore(),
      'campaignOperationalTracking',
      id,
    );
  const seed = (id, data) =>
    env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'campaignOperationalTracking', id), data),
    );
  try {
    await t.test(
      'admin y operator pueden marcar/desmarcar con historial vacío',
      async () => {
        for (const role of ['admin', 'operator']) {
          const id = `empty-${role}`;
          await seed(id, base);
          for (const completed of [false, true, false]) {
            await assertSucceeds(
              updateDoc(ref(role, id), {
                passesEvidence: { completed },
                csmProgramming: { completed },
                updatedAt: 2,
              }),
            );
          }
        }
      },
    );
    await t.test(
      'el primer guardado legacy no bloquea los siguientes',
      async () => {
        const legacy = { ...base };
        delete legacy.statusHistory;
        await seed('legacy', legacy);
        await assertSucceeds(
          updateDoc(ref('admin', 'legacy'), {
            statusHistory: [],
            passesEvidence: { completed: false },
          }),
        );
        await assertSucceeds(
          updateDoc(ref('admin', 'legacy'), {
            csmProgramming: { completed: false },
          }),
        );
        await assertSucceeds(
          updateDoc(ref('admin', 'legacy'), {
            passesEvidence: { completed: true },
          }),
        );
      },
    );
    await t.test(
      'conserva historial y permite agregar eventos al final',
      async () => {
        await seed('history', { ...base, statusHistory: [event('a')] });
        await assertSucceeds(
          updateDoc(ref('admin', 'history'), {
            passesEvidence: { completed: false },
          }),
        );
        await assertSucceeds(
          updateDoc(ref('admin', 'history'), {
            statusHistory: [event('a'), event('b')],
          }),
        );
      },
    );
    await t.test(
      'rechaza borrar, modificar o reordenar el historial',
      async () => {
        await seed('immutable', {
          ...base,
          statusHistory: [event('a'), event('b')],
        });
        for (const statusHistory of [
          [],
          [event('a')],
          [event('changed'), event('b')],
          [event('b'), event('a')],
        ]) {
          await assertFails(
            updateDoc(ref('admin', 'immutable'), { statusHistory }),
          );
        }
        await assertFails(setDoc(ref('admin', 'immutable'), { ...base }));
      },
    );
    await t.test(
      'viewer y commercial siguen sin permiso de escritura',
      async () => {
        await seed('readonly', base);
        for (const role of ['viewer', 'commercial']) {
          await assertFails(
            updateDoc(ref(role, 'readonly'), {
              passesEvidence: { completed: false },
            }),
          );
        }
      },
    );
  } finally {
    await env.cleanup();
  }
});
