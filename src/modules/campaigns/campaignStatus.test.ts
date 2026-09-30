import { describe, it, expect } from 'vitest';
import {
  STATUS_EFFECTS,
  STATUS_REASONS,
  buildStatusReason,
  campaignsAllowedFor,
  duplicateCandidates,
  duplicatesOf,
  effectiveCampaignStatus,
  formatStatusReason,
  importStatusNotices,
  needsAdmiraWithdrawal,
  statusAllows,
  statusByCampaignId,
  validateStatusChange,
  type StatusChangeInput,
} from './campaignStatus';
import { campaignIdentity, type StoredCampaign } from './campaignDiff';
import type {
  CampaignOperationalTracking,
  TrackingLifecycleStatus,
} from '@/modules/operational-tracking/types';

function camp(
  id: string,
  name: string,
  over: Partial<StoredCampaign> = {},
): StoredCampaign {
  return {
    row: 2,
    name,
    tipo: 'PROVEEDOR',
    vendidoPor: 'LIVERPOOL',
    fechaInicio: '1/8/26',
    fechaFin: '30/8/26',
    mes: 'AGOSTO',
    link: '',
    supports: [],
    id,
    nameKey: name.toUpperCase(),
    signature: id,
    ...over,
  } as StoredCampaign;
}

function track(
  campaignId: string,
  lifecycleStatus: TrackingLifecycleStatus,
  over: Partial<CampaignOperationalTracking> = {},
): CampaignOperationalTracking {
  return {
    id: campaignId,
    campaignId,
    campaignNameKey: '',
    classification: 'provider',
    lifecycleStatus,
    ...over,
  } as CampaignOperationalTracking;
}

describe('matriz de efectos aprobada', () => {
  it('Activa participa en todo', () => {
    expect(Object.values(STATUS_EFFECTS.active).every(Boolean)).toBe(true);
  });

  it('En pausa: sigue en CSV y Quividi; sale de alertas, resumen, carga y baja ocupación', () => {
    expect(statusAllows('paused', 'consolidationCsv')).toBe(true);
    expect(statusAllows('paused', 'quividiReport')).toBe(true);
    expect(statusAllows('paused', 'trackingChecks')).toBe(true);
    expect(statusAllows('paused', 'operationalAlerts')).toBe(false);
    expect(statusAllows('paused', 'dashboardSummary')).toBe(false);
    expect(statusAllows('paused', 'dashboardLoad')).toBe(false);
    expect(statusAllows('paused', 'lowOccupancy')).toBe(false);
  });

  it.each(['cancelled', 'duplicate', 'withdrawn'] as const)(
    '%s sale de todo (incluidos CSV y Quividi)',
    (status) => {
      expect(Object.values(STATUS_EFFECTS[status]).some(Boolean)).toBe(false);
    },
  );
});

describe('estado efectivo', () => {
  it('sin seguimiento o legacy ⇒ Activa', () => {
    expect(effectiveCampaignStatus(camp('a', 'A'), null)).toBe('active');
    expect(
      effectiveCampaignStatus(camp('a', 'A'), {
        lifecycleStatus: undefined as never,
      }),
    ).toBe('active');
  });

  it('la baja del calendario domina sobre el estado manual', () => {
    expect(
      effectiveCampaignStatus(camp('a', 'A', { active: false }), {
        lifecycleStatus: 'paused',
      }),
    ).toBe('withdrawn');
  });

  it('resuelve seguimiento por campaignId y por huella legacy', () => {
    const a = camp('a', 'A');
    const b = camp('b', 'B');
    const statuses = statusByCampaignId(
      [a, b],
      [
        track('a', 'cancelled'),
        {
          campaignNameKey: campaignIdentity(b),
          classification: 'provider',
          lifecycleStatus: 'paused',
        } as CampaignOperationalTracking,
      ],
    );
    expect(statuses.get('a')).toBe('cancelled');
    expect(statuses.get('b')).toBe('paused');
  });

  it('campaignsAllowedFor filtra según el área', () => {
    const list = [camp('a', 'A'), camp('p', 'P'), camp('c', 'C')];
    const tracking = [track('p', 'paused'), track('c', 'cancelled')];
    expect(
      campaignsAllowedFor('consolidationCsv', list, tracking).map((c) => c.id),
    ).toEqual(['a', 'p']);
    expect(
      campaignsAllowedFor('lowOccupancy', list, tracking).map((c) => c.id),
    ).toEqual(['a']);
  });
});

describe('motivos', () => {
  it('cada estado (incluida la reactivación) ofrece «Otro»', () => {
    for (const options of Object.values(STATUS_REASONS)) {
      expect(options[options.length - 1]).toEqual({
        code: 'other',
        label: 'Otro',
      });
    }
  });

  it('buildStatusReason guarda etiqueta y detalle recortado', () => {
    expect(buildStatusReason('cancelled', 'capture-error', '  x  ')).toEqual({
      code: 'capture-error',
      label: 'Error de captura',
      detail: 'x',
    });
    expect(buildStatusReason('cancelled', 'no-existe', '')).toBeNull();
  });

  it('formatStatusReason muestra el texto libre de «Otro» tal cual', () => {
    expect(
      formatStatusReason({ code: 'other', label: 'Otro', detail: 'Libre' }),
    ).toBe('Libre');
    expect(
      formatStatusReason({
        code: 'resumed',
        label: 'Se reanuda la campaña',
        detail: 'desde el lunes',
      }),
    ).toBe('Se reanuda la campaña · desde el lunes');
    expect(formatStatusReason(null)).toBe('');
  });
});

describe('validateStatusChange', () => {
  const base = (over: Partial<StatusChangeInput> = {}): StatusChangeInput => ({
    campaign: camp('a', 'A'),
    current: 'active',
    to: 'cancelled',
    reasonCode: 'liverpool-request',
    reasonDetail: '',
    duplicateOfCampaignId: null,
    candidates: [camp('o', 'ORIGINAL')],
    referencedBy: [],
    ...over,
  });

  it('acepta un cambio con motivo del catálogo', () => {
    expect(validateStatusChange(base())).toBeNull();
  });

  it('exige motivo, también al reactivar', () => {
    expect(validateStatusChange(base({ reasonCode: '' }))).toMatch(/motivo/);
    expect(
      validateStatusChange(
        base({ current: 'cancelled', to: 'active', reasonCode: '' }),
      ),
    ).toMatch(/motivo/);
    expect(
      validateStatusChange(
        base({ current: 'cancelled', to: 'active', reasonCode: 'resumed' }),
      ),
    ).toBeNull();
  });

  it('un motivo de otro estado no es válido', () => {
    expect(
      validateStatusChange(base({ to: 'paused', reasonCode: 'capture-error' })),
    ).toMatch(/motivo/);
  });

  it('«Otro» exige texto libre', () => {
    expect(validateStatusChange(base({ reasonCode: 'other' }))).toMatch(/Otro/);
    expect(
      validateStatusChange(base({ reasonCode: 'other', reasonDetail: 'x' })),
    ).toBeNull();
  });

  it('no permite repetir el estado actual ni editar una retirada', () => {
    expect(validateStatusChange(base({ current: 'cancelled' }))).toMatch(
      /ya está/,
    );
    expect(
      validateStatusChange(
        base({ campaign: camp('a', 'A', { active: false }) }),
      ),
    ).toMatch(/retirada/);
  });

  it('Duplicada exige una original válida y distinta', () => {
    const dup = (over: Partial<StatusChangeInput>) =>
      validateStatusChange(
        base({ to: 'duplicate', reasonCode: 'calendar-duplicate', ...over }),
      );
    expect(dup({})).toMatch(/original/);
    expect(dup({ duplicateOfCampaignId: 'a' })).toMatch(/sí misma/);
    expect(dup({ duplicateOfCampaignId: 'zzz' })).toMatch(/no es válida/);
    expect(dup({ duplicateOfCampaignId: 'o' })).toBeNull();
    expect(dup({ duplicateOfCampaignId: 'o', referencedBy: ['x'] })).toMatch(
      /duplicadas de esta/,
    );
  });
});

describe('duplicados', () => {
  it('candidatas: vigentes, no la propia ni duplicadas; homónimas primero', () => {
    const self = camp('s', 'Nike');
    const list = [
      self,
      camp('z', 'Adidas'),
      camp('n', 'NIKE'),
      camp('d', 'Dup'),
      camp('w', 'Retirada', { active: false }),
    ];
    const statuses = statusByCampaignId(list, [track('d', 'duplicate')]);
    expect(duplicateCandidates(self, list, statuses).map((c) => c.id)).toEqual([
      'n',
      'z',
    ]);
  });

  it('duplicatesOf lista las campañas que apuntan a una original', () => {
    expect(
      duplicatesOf('o', [
        track('x', 'duplicate', { duplicateOfCampaignId: 'o' }),
        track('y', 'cancelled'),
      ]),
    ).toEqual(['x']);
  });
});

describe('aviso de retiro manual en Admira', () => {
  const programmed = {
    csmProgramming: { completed: true },
  } as CampaignOperationalTracking;
  const notProgrammed = {
    csmProgramming: { completed: false },
  } as CampaignOperationalTracking;

  it('avisa al sacar del CSV una campaña ya programada en CSM', () => {
    expect(needsAdmiraWithdrawal('active', 'cancelled', programmed)).toBe(true);
    expect(needsAdmiraWithdrawal('paused', 'duplicate', programmed)).toBe(true);
  });

  it('no avisa si no estaba programada o si sigue en el CSV', () => {
    expect(needsAdmiraWithdrawal('active', 'cancelled', notProgrammed)).toBe(
      false,
    );
    expect(needsAdmiraWithdrawal('active', 'paused', programmed)).toBe(false);
    expect(needsAdmiraWithdrawal('cancelled', 'duplicate', programmed)).toBe(
      false,
    );
  });
});

describe('importStatusNotices', () => {
  it('avisa de las campañas modificadas con estado manual (sin cambiarlo)', () => {
    const notices = importStatusNotices(
      [{ stored: camp('a', 'A') }, { stored: camp('c', 'C') }],
      [
        track('c', 'cancelled', {
          statusReason: {
            code: 'capture-error',
            label: 'Error de captura',
            detail: null,
          },
        }),
      ],
    );
    expect(notices).toEqual([
      {
        campaignId: 'c',
        campaignName: 'C',
        status: 'cancelled',
        reason: 'Error de captura',
      },
    ]);
  });
});
