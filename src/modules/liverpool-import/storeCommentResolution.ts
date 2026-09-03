import {
  normalizeSupport,
  type AdmiraScreen,
  type ValidationIssue,
} from '@/domain';
import type {
  AmbiguousStoreComment,
  ParsedCampaign,
  StoreRef,
} from './campaignParse';

export type StoreCommentResolution =
  { kind: 'all' } | { kind: 'selected'; stores: StoreRef[] };

export type StoreCommentResolutions = Map<string, StoreCommentResolution>;

export interface StoreOption extends StoreRef {
  label: string;
}

function normalizeStoreNumber(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed.replace(/^0+(?=\d)/, '') : trimmed;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Clave estable aunque la fila/celda cambie en otra versión del calendario. */
export function storeCommentResolutionKey(
  issue: Pick<AmbiguousStoreComment, 'support' | 'comment'>,
): string {
  return `${normalizeSupport(issue.support)}\u0000${normalizeText(issue.comment)}`;
}

export function storeOptionMatchesComment(
  issue: AmbiguousStoreComment,
  option: Pick<StoreOption, 'nombre'>,
): boolean {
  const comment = normalizeText(issue.comment);
  const name = normalizeText(option.nombre).replace(/^l\s+/, '');
  return name !== '' && comment.includes(name);
}

/** Una selección vacía sigue pendiente; `all` requiere confirmación explícita. */
export function isStoreCommentResolutionComplete(
  resolution: StoreCommentResolution | undefined,
): boolean {
  return (
    resolution?.kind === 'all' ||
    (resolution?.kind === 'selected' && resolution.stores.length > 0)
  );
}

/** Opciones activas del catálogo que realmente disponen del soporte afectado. */
export function storeOptionsForComment(
  issue: AmbiguousStoreComment,
  screens: readonly AdmiraScreen[],
): StoreOption[] {
  const supportKey = normalizeSupport(issue.support);
  const byNumber = new Map<string, StoreOption>();

  for (const screen of screens) {
    if (!screen.metadata.active) continue;
    if (normalizeSupport(screen.metadata.calendarSupport) !== supportKey) {
      continue;
    }
    const numero = normalizeStoreNumber(screen.original['Numero de Tienda']);
    if (numero === '' || byNumber.has(numero)) continue;
    const nombre = screen.original['Nombre de tienda'].trim();
    byNumber.set(numero, {
      numero,
      nombre,
      label: nombre ? `${numero} · ${nombre}` : numero,
    });
  }

  return [...byNumber.values()].sort((a, b) => {
    const aSuggested = storeOptionMatchesComment(issue, a) ? 0 : 1;
    const bSuggested = storeOptionMatchesComment(issue, b) ? 0 : 1;
    return (
      aSuggested - bSuggested ||
      a.numero.localeCompare(b.numero, 'es', { numeric: true })
    );
  });
}

/**
 * Recupera decisiones previas solo si siguen siendo válidas contra el catálogo
 * actual. Una tienda retirada o remapeada obliga a confirmar de nuevo.
 */
export function hydrateStoreCommentResolutions(
  issues: readonly AmbiguousStoreComment[],
  saved: ReadonlyMap<string, StoreCommentResolution>,
  screens: readonly AdmiraScreen[],
): StoreCommentResolutions {
  const hydrated: StoreCommentResolutions = new Map();
  for (const issue of issues) {
    const resolution = saved.get(storeCommentResolutionKey(issue));
    if (!resolution) continue;
    if (resolution.kind === 'all') {
      hydrated.set(issue.id, resolution);
      continue;
    }
    const validNumbers = new Set(
      storeOptionsForComment(issue, screens).map((option) => option.numero),
    );
    if (
      resolution.stores.length > 0 &&
      resolution.stores.every((store) =>
        validNumbers.has(normalizeStoreNumber(store.numero)),
      )
    ) {
      hydrated.set(issue.id, {
        kind: 'selected',
        stores: resolution.stores.map((store) => ({
          numero: normalizeStoreNumber(store.numero),
          nombre: store.nombre.trim(),
        })),
      });
    }
  }
  return hydrated;
}

/**
 * Sustituye únicamente los soportes ambiguos resueltos en esta importación.
 * Los pendientes conservan `scope: invalid` para que ningún consumidor pueda
 * interpretarlos como circuito completo, incluso si se invoca fuera de la UI.
 */
export function applyStoreCommentResolutions(
  campaigns: readonly ParsedCampaign[],
  issues: readonly AmbiguousStoreComment[],
  resolutions: StoreCommentResolutions,
): ParsedCampaign[] {
  const issueByRowAndSupport = new Map(
    issues.map((issue) => [`${issue.row}\u0000${issue.support}`, issue]),
  );

  return campaigns.map((campaign) => ({
    ...campaign,
    supports: campaign.supports.map((support) => {
      const issue = issueByRowAndSupport.get(
        `${campaign.row}\u0000${support.support}`,
      );
      if (!issue) return support;
      const resolution = resolutions.get(issue.id);
      if (!isStoreCommentResolutionComplete(resolution)) {
        return { ...support, stores: [], scope: 'invalid' };
      }
      if (resolution?.kind === 'all') {
        return { ...support, stores: [], scope: 'all' };
      }
      const stores = Array.from(
        new Map(
          resolution!.stores.map((store) => [
            normalizeStoreNumber(store.numero),
            {
              numero: normalizeStoreNumber(store.numero),
              nombre: store.nombre.trim(),
            },
          ]),
        ).values(),
      );
      return { ...support, stores, scope: 'selected' };
    }),
  }));
}

/** Errores bloqueantes dinámicos: desaparecen al resolver cada comentario. */
export function unresolvedStoreCommentIssues(
  issues: readonly AmbiguousStoreComment[],
  resolutions: StoreCommentResolutions,
): ValidationIssue[] {
  return issues
    .filter(
      (issue) => !isStoreCommentResolutionComplete(resolutions.get(issue.id)),
    )
    .map((issue) => ({
      severity: 'blocking',
      code: 'ambiguous-store-comment',
      message: `La celda ${issue.address} de “${issue.campaignName}” contiene “${issue.comment.replace(/\s+/g, ' ').trim()}”, pero no incluye números de tienda. Resuelve el alcance antes de guardar.`,
      location: {
        sheet: issue.sheet,
        row: issue.row,
        column: issue.address,
      },
    }));
}
