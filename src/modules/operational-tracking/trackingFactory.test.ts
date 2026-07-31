import { describe, it, expect } from 'vitest';
import {
  initialTracking,
  applyCheckChange,
  setClassification,
  campaignKeyId,
} from './trackingFactory';
import { campaignKeyId as ekonKeyId } from '@/modules/campaigns/ekon';

const actor = { uid: 'u1', email: 'a@b.mx' };
const actor2 = { uid: 'u2', email: 'c@d.mx' };

function institutional() {
  return initialTracking(
    {
      campaignNameKey: 'buen fin',
      campaignName: 'BUEN FIN',
      classification: 'institutional',
      classificationSource: 'import-user',
      linkValid: false,
    },
    actor,
    1000,
  );
}

describe('initialTracking', () => {
  it('reutiliza el mismo id determinístico que Ekon (campaignKeyId)', () => {
    expect(campaignKeyId('buen fin')).toBe(ekonKeyId('buen fin'));
    expect(institutional().id).toBe(ekonKeyId('buen fin'));
  });

  it('institucional arranca con Validación Liverpool marcada (automatic)', () => {
    const t = institutional();
    expect(t.liverpoolValidation.completed).toBe(true);
    expect(t.liverpoolValidation.source).toBe('automatic');
    expect(t.csmProgramming.completed).toBe(false);
    expect(t.witnessStart.completed).toBe(false);
  });

  it('proveedor sin link arranca con Validación Liverpool pendiente', () => {
    const t = initialTracking(
      {
        campaignNameKey: 'x',
        campaignName: 'X',
        classification: 'provider',
        classificationSource: 'calendar',
        linkValid: false,
      },
      actor,
      1000,
    );
    expect(t.liverpoolValidation.completed).toBe(false);
    expect(t.linkDownload.completed).toBe(false);
  });

  it('un link válido marca Link y Validación por defecto (incluso proveedor)', () => {
    const t = initialTracking(
      {
        campaignNameKey: 'x',
        campaignName: 'X',
        classification: 'provider',
        classificationSource: 'calendar',
        linkValid: true,
      },
      actor,
      1000,
    );
    expect(t.linkDownload.completed).toBe(true);
    expect(t.linkDownload.source).toBe('automatic');
    expect(t.liverpoolValidation.completed).toBe(true);
  });

  it('el Link es un check editable: al cambiarlo queda source manual', () => {
    const t = institutional();
    const r = applyCheckChange(t, 'linkDownload', true, actor2, 4000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tracking.linkDownload.completed).toBe(true);
    expect(r.tracking.linkDownload.source).toBe('manual');
  });
});

describe('applyCheckChange — CSM y trazabilidad', () => {
  it('marcar guarda quién y cuándo; desmarcar limpia completado', () => {
    const t = institutional();
    const marked = applyCheckChange(t, 'csmProgramming', true, actor2, 2000);
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    expect(marked.tracking.csmProgramming.completed).toBe(true);
    expect(marked.tracking.csmProgramming.completedAt).toBe(2000);
    expect(marked.tracking.csmProgramming.completedByEmail).toBe('c@d.mx');
    expect(marked.tracking.csmProgramming.source).toBe('manual');

    const unmarked = applyCheckChange(
      marked.tracking,
      'csmProgramming',
      false,
      actor,
      3000,
    );
    expect(unmarked.ok).toBe(true);
    if (!unmarked.ok) return;
    expect(unmarked.tracking.csmProgramming.completed).toBe(false);
    expect(unmarked.tracking.csmProgramming.completedAt).toBeNull();
    expect(unmarked.tracking.csmProgramming.completedByUid).toBeNull();
    // Metadatos de última modificación se conservan.
    expect(unmarked.tracking.csmProgramming.updatedByEmail).toBe('a@b.mx');
    expect(unmarked.tracking.csmProgramming.updatedAt).toBe(3000);
  });
});

describe('applyCheckChange — relación de testigos', () => {
  it('marcar T Completos marca también T Arranque con el mismo usuario y fecha', () => {
    const t = institutional();
    const res = applyCheckChange(t, 'witnessComplete', true, actor2, 5000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tracking.witnessComplete.completed).toBe(true);
    expect(res.tracking.witnessStart.completed).toBe(true);
    expect(res.tracking.witnessStart.completedAt).toBe(5000);
    expect(res.tracking.witnessStart.completedByUid).toBe('u2');
  });

  it('no arrastra fecha si T Arranque ya estaba completado', () => {
    const t = institutional();
    const started = applyCheckChange(t, 'witnessStart', true, actor, 4000);
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const completed = applyCheckChange(
      started.tracking,
      'witnessComplete',
      true,
      actor2,
      6000,
    );
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.tracking.witnessStart.completedAt).toBe(4000);
    expect(completed.tracking.witnessStart.completedByUid).toBe('u1');
  });

  it('no permite desmarcar T Arranque mientras T Completos siga marcado', () => {
    const t = institutional();
    const c = applyCheckChange(t, 'witnessComplete', true, actor, 5000);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const bad = applyCheckChange(
      c.tracking,
      'witnessStart',
      false,
      actor,
      6000,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.reason).toMatch(/T Completos/i);
  });

  it('desmarcar T Completos no desmarca T Arranque automáticamente', () => {
    const t = institutional();
    const c = applyCheckChange(t, 'witnessComplete', true, actor, 5000);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const uncompleted = applyCheckChange(
      c.tracking,
      'witnessComplete',
      false,
      actor,
      7000,
    );
    expect(uncompleted.ok).toBe(true);
    if (!uncompleted.ok) return;
    expect(uncompleted.tracking.witnessComplete.completed).toBe(false);
    expect(uncompleted.tracking.witnessStart.completed).toBe(true);
  });
});

describe('setClassification', () => {
  it('cambia clasificación y trazabilidad sin tocar los checks', () => {
    const t = institutional();
    const changed = setClassification(
      t,
      'provider',
      'tracking-user',
      actor2,
      9000,
    );
    expect(changed.classification).toBe('provider');
    expect(changed.classificationSource).toBe('tracking-user');
    expect(changed.classificationUpdatedByEmail).toBe('c@d.mx');
    // Validación Liverpool NO se sobrescribe.
    expect(changed.liverpoolValidation.completed).toBe(
      t.liverpoolValidation.completed,
    );
  });
});
