import { describe, expect, it } from 'vitest';
import type { AdmiraScreen } from '@/domain';
import {
  emptyOriginal,
  newScreenMetadata,
} from '@/modules/admira-catalog/screenFactory';
import type { AmbiguousStoreComment, ParsedCampaign } from './campaignParse';
import {
  applyStoreCommentResolutions,
  hydrateStoreCommentResolutions,
  storeCommentResolutionKey,
  storeOptionsForComment,
  unresolvedStoreCommentIssues,
} from './storeCommentResolution';

const issue: AmbiguousStoreComment = {
  id: 'Hoja 2:199:9',
  sheet: 'Hoja 2',
  row: 199,
  col: 9,
  address: 'I199',
  campaignName: 'HIPER X',
  support: 'VIDEO WALL CRIUS',
  comment: 'INSURGENTES',
};

const campaign: ParsedCampaign = {
  row: 199,
  name: 'HIPER X',
  tipo: 'ISM/PROVEEDOR',
  vendidoPor: '',
  fechaInicio: '2026-08-11',
  fechaFin: '2026-09-07',
  mes: 'AGOSTO',
  link: 'ISM',
  supports: [
    {
      support: 'VIDEO WALL CRIUS',
      owner: 'liverpool',
      stores: [],
      scope: 'invalid',
    },
  ],
};

function screen(
  id: string,
  numero: string,
  nombre: string,
  support = 'VIDEO WALL CRIUS',
  active = true,
): AdmiraScreen {
  return {
    id,
    original: {
      ...emptyOriginal(),
      'Numero de Tienda': numero,
      'Nombre de tienda': nombre,
    },
    metadata: {
      ...newScreenMetadata({ uid: 'u', email: 'u@ism.mx' }, 1),
      calendarSupport: support,
      active,
    },
  };
}

describe('resolución de comentarios de tienda', () => {
  it('ofrece únicamente tiendas activas con el soporte afectado', () => {
    const options = storeOptionsForComment(issue, [
      screen('ins', '002', 'L INSURGENTES'),
      screen('pol', '3', 'L POLANCO', 'APARADOR POLANCO'),
      screen('old', '4', 'L SATELITE', 'VIDEO WALL CRIUS', false),
    ]);

    expect(options).toEqual([
      { numero: '2', nombre: 'L INSURGENTES', label: '2 · L INSURGENTES' },
    ]);
  });

  it('mantiene el alcance inválido sin pantallas mientras siga pendiente', () => {
    const resolved = applyStoreCommentResolutions(
      [campaign],
      [issue],
      new Map(),
    );
    expect(resolved[0]!.supports[0]).toMatchObject({
      scope: 'invalid',
      stores: [],
    });
    expect(unresolvedStoreCommentIssues([issue], new Map())).toHaveLength(1);
  });

  it('aplica la tienda elegida y elimina el bloqueo', () => {
    const resolutions = new Map([
      [
        issue.id,
        {
          kind: 'selected' as const,
          stores: [{ numero: '2', nombre: 'L INSURGENTES' }],
        },
      ],
    ]);
    const resolved = applyStoreCommentResolutions(
      [campaign],
      [issue],
      resolutions,
    );

    expect(resolved[0]!.supports[0]).toMatchObject({
      scope: 'selected',
      stores: [{ numero: '2', nombre: 'L INSURGENTES' }],
    });
    expect(unresolvedStoreCommentIssues([issue], resolutions)).toHaveLength(0);
  });

  it('recupera una decisión previa solo si la tienda sigue vigente en el soporte', () => {
    const saved = new Map([
      [
        storeCommentResolutionKey(issue),
        {
          kind: 'selected' as const,
          stores: [{ numero: '2', nombre: 'L INSURGENTES' }],
        },
      ],
    ]);
    expect(
      hydrateStoreCommentResolutions([issue], saved, [
        screen('ins', '2', 'L INSURGENTES'),
      ]).get(issue.id),
    ).toEqual(saved.get(storeCommentResolutionKey(issue)));

    expect(
      hydrateStoreCommentResolutions([issue], saved, [
        screen('ins', '2', 'L INSURGENTES', 'APARADOR INSURGENTES'),
      ]).has(issue.id),
    ).toBe(false);
  });
});
