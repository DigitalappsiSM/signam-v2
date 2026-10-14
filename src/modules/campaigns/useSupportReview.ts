import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StoredEkonAssignment } from '@/domain/ekon';
import { listActiveAssignmentsByEkonNumber } from '@/services/ekonAssignments';
import {
  ekonNumberForCampaign,
  listEkonLinks,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';
import { listSupportOverrides } from '@/services/campaignSupportOverrides';
import type { StoredCampaign } from './campaignDiff';
import {
  supportReviewState,
  type CampaignSupportOverride,
  type SupportReviewState,
} from './supportOverride';

export interface SupportReview {
  /** Confirmaciones vigentes por `campaignId`. */
  overrides: ReadonlyMap<string, CampaignSupportOverride>;
  /** Asignaciones Ekon vigentes ya leídas, por número Ekon. */
  assignmentsByNumber: ReadonlyMap<string, StoredEkonAssignment[]>;
  /** Número Ekon vinculado de la campaña (o null). */
  ekonNumberOf: (campaign: StoredCampaign) => number | null;
  /** Estado del aviso Calendario ↔ Ekon (sobre los soportes del CALENDARIO). */
  stateOf: (campaign: StoredCampaign) => SupportReviewState;
  /** Relee confirmaciones y asignaciones (tras guardar una decisión). */
  reload: () => Promise<void>;
}

/**
 * Carga lo necesario para el aviso Calendario ↔ Ekon de las campañas dadas
 * (normalmente la página visible). Lee las confirmaciones (colección pequeña)
 * y solo las asignaciones Ekon de los números vinculados de esas campañas, en
 * tandas de 8 y con caché por número mientras el módulo está montado.
 *
 * `links` = null: el hook lee los vínculos por su cuenta. Sin permiso de lectura
 * Ekon no consulta asignaciones y nunca levanta avisos (no se sabe).
 */
export function useSupportReview(
  campaigns: readonly StoredCampaign[],
  links: readonly CampaignEkonLink[] | null,
  canReadEkon: boolean,
): SupportReview {
  const [overrides, setOverrides] = useState<
    ReadonlyMap<string, CampaignSupportOverride>
  >(new Map());
  const [ownLinks, setOwnLinks] = useState<CampaignEkonLink[] | null>(null);
  const [assignments, setAssignments] = useState<
    ReadonlyMap<string, StoredEkonAssignment[]>
  >(new Map());
  const requested = useRef(new Set<string>());
  const effectiveLinks = useMemo(
    () => links ?? ownLinks ?? [],
    [links, ownLinks],
  );
  // Sin vínculos cargados no se sabe el número vigente: no se marca «Revisar».
  const linksKnown = links !== null || ownLinks !== null;

  const loadOverrides = useCallback(async () => {
    try {
      const list = await listSupportOverrides();
      setOverrides(new Map(list.map((o) => [o.campaignId, o])));
    } catch {
      // Sin confirmaciones legibles no se aplica nada: queda el calendario.
    }
  }, []);

  useEffect(() => {
    void loadOverrides();
  }, [loadOverrides]);

  useEffect(() => {
    if (links || !canReadEkon) return;
    let cancelled = false;
    listEkonLinks()
      .then((list) => {
        if (!cancelled) setOwnLinks(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [links, canReadEkon]);

  const ekonNumberOf = useCallback(
    (campaign: StoredCampaign) =>
      ekonNumberForCampaign(campaign, effectiveLinks),
    [effectiveLinks],
  );

  const loadAssignments = useCallback(async (numbers: string[]) => {
    for (let i = 0; i < numbers.length; i += 8) {
      const chunk = numbers.slice(i, i + 8);
      const rows = await Promise.all(
        chunk.map((n) =>
          listActiveAssignmentsByEkonNumber(n).catch(() => null),
        ),
      );
      setAssignments((prev) => {
        const next = new Map(prev);
        chunk.forEach((n, k) => {
          const r = rows[k];
          if (r) next.set(n, r);
          else requested.current.delete(n);
        });
        return next;
      });
    }
  }, []);

  useEffect(() => {
    if (!canReadEkon) return;
    const numbers = new Set<string>();
    for (const campaign of campaigns) {
      const n = ekonNumberOf(campaign);
      if (n != null && !requested.current.has(String(n))) {
        numbers.add(String(n));
      }
    }
    if (numbers.size === 0) return;
    for (const n of numbers) requested.current.add(n);
    void loadAssignments([...numbers]);
  }, [campaigns, ekonNumberOf, canReadEkon, loadAssignments]);

  const reload = useCallback(async () => {
    const numbers = [...requested.current];
    await Promise.all([loadOverrides(), loadAssignments(numbers)]);
  }, [loadOverrides, loadAssignments]);

  const stateOf = useCallback(
    (campaign: StoredCampaign): SupportReviewState => {
      const n = ekonNumberOf(campaign);
      const rows = n != null ? assignments.get(String(n)) : undefined;
      return supportReviewState(
        campaign,
        canReadEkon ? rows : undefined,
        overrides.get(campaign.id),
        linksKnown ? n : undefined,
      );
    },
    [ekonNumberOf, assignments, overrides, canReadEkon, linksKnown],
  );

  return useMemo(
    () => ({
      overrides,
      assignmentsByNumber: assignments,
      ekonNumberOf,
      stateOf,
      reload,
    }),
    [overrides, assignments, ekonNumberOf, stateOf, reload],
  );
}
