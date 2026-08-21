import { describe, it, expect } from 'vitest';
import {
  initialTracking,
  applyCheckChange,
  setClassification,
  markAllComplete,
  addComment,
  campaignKeyId,
  cancelTracking,
  reactivateTracking,
  isCancelled,
  normalizeTracking,
  CANCELLED_CHECK_MESSAGE,
  INSTITUTIONAL_WITNESS_MESSAGE,
} from './trackingFactory';
import type { CampaignOperationalTracking } from './types';
import { campaignKeyId as ekonKeyId } from '@/modules/campaigns/ekon';

const actor = { uid: 'u1', email: 'a@b.mx' };
const actor2 = { uid: 'u2', email: 'c@d.mx' };

function institutional() {
  return initialTracking(
    {
      campaignId: 'campaign-buen-fin',
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
  it('usa campaignId como id canónico y conserva campaignKeyId para legacy', () => {
    expect(campaignKeyId('buen fin')).toBe(ekonKeyId('buen fin'));
    expect(institutional().id).toBe('campaign-buen-fin');
    expect(institutional().campaignId).toBe('campaign-buen-fin');
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
    const t = provider();
    const res = applyCheckChange(t, 'witnessComplete', true, actor2, 5000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tracking.witnessComplete.completed).toBe(true);
    expect(res.tracking.witnessStart.completed).toBe(true);
    expect(res.tracking.witnessStart.completedAt).toBe(5000);
    expect(res.tracking.witnessStart.completedByUid).toBe('u2');
  });

  it('no arrastra fecha si T Arranque ya estaba completado', () => {
    const t = provider();
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
    const t = provider();
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
    const t = provider();
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

function provider() {
  return initialTracking(
    {
      campaignId: 'campaign-proveedor',
      campaignNameKey: 'proveedor',
      campaignName: 'PROVEEDOR',
      classification: 'provider',
      classificationSource: 'import-user',
      linkValid: false,
    },
    actor,
    1000,
  );
}

describe('applyCheckChange — testigos no aplican a institucional', () => {
  it('rechaza marcar T Arranque en una campaña institucional', () => {
    const res = applyCheckChange(
      institutional(),
      'witnessStart',
      true,
      actor,
      2000,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(INSTITUTIONAL_WITNESS_MESSAGE);
  });

  it('rechaza marcar T Completos en una campaña institucional', () => {
    const res = applyCheckChange(
      institutional(),
      'witnessComplete',
      true,
      actor,
      2000,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(INSTITUTIONAL_WITNESS_MESSAGE);
  });

  it('los demás indicadores siguen siendo editables en institucional', () => {
    const res = applyCheckChange(
      institutional(),
      'csmProgramming',
      true,
      actor,
      2000,
    );
    expect(res.ok).toBe(true);
  });

  it('un proveedor sí puede marcar los testigos', () => {
    const res = applyCheckChange(provider(), 'witnessStart', true, actor, 2000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tracking.witnessStart.completed).toBe(true);
  });
});

describe('markAllComplete', () => {
  it('proveedor marca los cinco indicadores como completados (source manual)', () => {
    const res = markAllComplete(provider(), actor2, 8000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = res.tracking;
    expect(t.linkDownload.completed).toBe(true);
    expect(t.liverpoolValidation.completed).toBe(true);
    expect(t.csmProgramming.completed).toBe(true);
    expect(t.witnessStart.completed).toBe(true);
    expect(t.witnessComplete.completed).toBe(true);
    expect(t.csmProgramming.source).toBe('manual');
    expect(t.csmProgramming.completedByUid).toBe('u2');
    expect(t.updatedAt).toBe(8000);
  });

  it('institucional sólo marca los indicadores aplicables (no los testigos)', () => {
    const res = markAllComplete(institutional(), actor2, 8000);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = res.tracking;
    expect(t.linkDownload.completed).toBe(true);
    expect(t.liverpoolValidation.completed).toBe(true);
    expect(t.csmProgramming.completed).toBe(true);
    // Los testigos NO se marcan ni se tocan (conservan su valor previo).
    expect(t.witnessStart.completed).toBe(false);
    expect(t.witnessComplete.completed).toBe(false);
    expect(t.witnessStart.source).toBe('automatic');
  });
});

describe('ciclo de vida — cancelar / reactivar', () => {
  it('un seguimiento nuevo comienza activo', () => {
    const t = institutional();
    expect(t.lifecycleStatus).toBe('active');
    expect(t.cancellationReason).toBeNull();
    expect(t.lifecycleUpdatedAt).toBe(1000);
    expect(isCancelled(t)).toBe(false);
  });

  it('un documento legacy sin estado se interpreta como activo', () => {
    // Documento sin campos de ciclo de vida (creado antes de la funcionalidad).
    const legacy = {
      id: 'x',
      campaignNameKey: 'x',
      campaignName: 'X',
      classification: 'institutional',
      createdAt: 500,
      createdByUid: 'u9',
      createdByEmail: 'z@z.mx',
    } as unknown as CampaignOperationalTracking;
    expect(isCancelled(legacy)).toBe(false);
    const norm = normalizeTracking(legacy);
    expect(norm.lifecycleStatus).toBe('active');
    expect(norm.cancellationReason).toBeNull();
    // Metadatos de transición faltantes se derivan de la creación.
    expect(norm.lifecycleUpdatedAt).toBe(500);
    expect(norm.lifecycleUpdatedByUid).toBe('u9');
  });

  it('cancelar conserva los cinco checks y registra usuario/fecha/motivo', () => {
    const marked = applyCheckChange(
      institutional(),
      'csmProgramming',
      true,
      actor,
      2000,
    );
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    const cancelled = cancelTracking(
      marked.tracking,
      '  Sin presupuesto  ',
      actor2,
      5000,
    );
    expect(cancelled.lifecycleStatus).toBe('cancelled');
    expect(cancelled.cancellationReason).toBe('Sin presupuesto');
    expect(cancelled.lifecycleUpdatedByEmail).toBe('c@d.mx');
    expect(cancelled.lifecycleUpdatedAt).toBe(5000);
    // Los checks NO se tocan.
    expect(cancelled.csmProgramming.completed).toBe(true);
    expect(cancelled.liverpoolValidation.completed).toBe(true);
  });

  it('cancelar sin motivo guarda null', () => {
    const cancelled = cancelTracking(institutional(), '   ', actor, 5000);
    expect(cancelled.cancellationReason).toBeNull();
  });

  it('cancelar conserva clasificación y comentarios', () => {
    const withComment = addComment(institutional(), 'c1', 'Nota', actor, 3000);
    const cancelled = cancelTracking(withComment, 'motivo', actor, 5000);
    expect(cancelled.classification).toBe('institutional');
    expect(cancelled.comments).toHaveLength(1);
    expect(cancelled.comments[0]!.text).toBe('Nota');
  });

  it('no se puede modificar un check mientras está cancelada', () => {
    const cancelled = cancelTracking(institutional(), '', actor, 5000);
    const res = applyCheckChange(
      cancelled,
      'csmProgramming',
      true,
      actor,
      6000,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(CANCELLED_CHECK_MESSAGE);
  });

  it('no se puede ejecutar "Marcar todas" mientras está cancelada', () => {
    const cancelled = cancelTracking(institutional(), '', actor, 5000);
    const res = markAllComplete(cancelled, actor, 6000);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe(CANCELLED_CHECK_MESSAGE);
  });

  it('reactivar restaura la aplicabilidad sin alterar los checks y limpia el motivo', () => {
    const marked = applyCheckChange(
      institutional(),
      'csmProgramming',
      true,
      actor,
      2000,
    );
    expect(marked.ok).toBe(true);
    if (!marked.ok) return;
    const cancelled = cancelTracking(marked.tracking, 'motivo', actor, 5000);
    const reactivated = reactivateTracking(cancelled, actor2, 7000);
    expect(reactivated.lifecycleStatus).toBe('active');
    expect(reactivated.cancellationReason).toBeNull();
    expect(reactivated.lifecycleUpdatedByEmail).toBe('c@d.mx');
    expect(reactivated.lifecycleUpdatedAt).toBe(7000);
    // El check conserva exactamente su valor previo.
    expect(reactivated.csmProgramming.completed).toBe(true);
    // Y ahora vuelve a aceptar cambios.
    const res = applyCheckChange(
      reactivated,
      'csmProgramming',
      false,
      actor,
      8000,
    );
    expect(res.ok).toBe(true);
  });
});

describe('addComment', () => {
  it('agrega un comentario a la bitácora con autor y fecha', () => {
    const t = addComment(institutional(), 'c1', '  Todo listo  ', actor2, 9000);
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0]).toMatchObject({
      id: 'c1',
      text: 'Todo listo',
      createdAt: 9000,
      createdByEmail: 'c@d.mx',
    });
    expect(t.updatedAt).toBe(9000);
  });

  it('conserva el orden cronológico al agregar varios', () => {
    const t1 = addComment(institutional(), 'c1', 'Primero', actor, 1000);
    const t2 = addComment(t1, 'c2', 'Segundo', actor2, 2000);
    expect(t2.comments.map((c) => c.text)).toEqual(['Primero', 'Segundo']);
  });

  it('ignora comentarios vacíos (devuelve el documento sin cambios)', () => {
    const base = institutional();
    const t = addComment(base, 'c1', '   ', actor, 1000);
    expect(t.comments).toHaveLength(0);
    expect(t).toBe(base);
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
