import type { Firestore } from 'firebase-admin/firestore';

export type EffectiveScopeSource =
  | 'calendar-selected'
  | 'calendar-all'
  | 'calendar-full-circuit'
  | 'ekon'
  | 'unresolved';

export interface CampaignStore {
  numero?: string;
  nombre?: string;
}

export interface CampaignSupport {
  support?: string;
  stores?: CampaignStore[];
  scope?: 'all' | 'selected' | 'invalid';
  scopeSource?:
    | 'no-comment'
    | 'comment-selected'
    | 'comment-explicit-all'
    | 'comment-ambiguous'
    | 'resolution-selected'
    | 'resolution-all';
}

export interface CampaignDoc {
  name?: string;
  nameKey?: string;
  fechaInicio?: string;
  fechaFin?: string;
  supports?: CampaignSupport[];
}

export interface ScreenDoc {
  id?: string;
  original?: {
    'Numero de Tienda'?: string;
    'Nombre de tienda'?: string;
  };
  metadata?: {
    active?: boolean;
    calendarSupport?: string;
    quividiLocationId?: number | null;
    quividiCameraName?: string;
    quividiLocationId2?: number | null;
    quividiCameraName2?: string;
  };
}

interface CampaignEkonLinkDoc {
  ekonCampaignNumber?: number;
}

export interface EkonAssignmentDoc {
  campaignNumber?: string;
  active?: boolean;
  conflict?: string | null;
  determinanteKey?: string;
  tienda?: string;
  circuito?: string;
  articulo?: string;
  inicioPeriodo?: string | null;
  finPeriodo?: string | null;
  centroAdministrativo?: boolean;
}

export interface EffectiveSupportPair {
  storeNumber: string;
  storeName: string;
  support: string;
  cameraNames: string[];
  /** IDs estables Quividi. Salud operativa los prioriza sobre alias legacy. */
  cameraLocationIds?: number[];
  source: EffectiveScopeSource;
  ekonNumber: number | null;
}

export interface EffectiveScopeOrigin {
  support: string;
  source: EffectiveScopeSource;
  pairCount: number;
  ekonNumber: number | null;
}

export interface EffectiveScopeResult {
  pairs: EffectiveSupportPair[];
  origins: EffectiveScopeOrigin[];
}

const FULL_CIRCUIT_WITHOUT_COMMENT = new Set([
  'VIDEO WALL CRIUS',
  'VIDEO WALL POSTER LED',
]);

/**
 * Alias exclusivos del reporte Quividi. El Calendario usa nombres comerciales
 * propios, mientras el catálogo y Ekon trabajan con NORMALIZACION LIVERPOOL.
 */
const CALENDAR_TO_QUIVIDI_SUPPORT: Record<string, string> = {
  MUPPIS: 'MEGA MUPI DIGITAL',
  PENDON: 'BANNER DIGITAL',
};

const SUPPORT_ALIASES: Record<string, string> = {
  'MEGAMUPI DIGITAL': 'MEGA MUPI DIGITAL',
};

const CIRCUIT_TO_SUPPORTS: Record<string, readonly string[]> = {
  'ESPECTACULAR IN STORE': [
    'LED ALTABRISA',
    'LED VALLARTA',
    'COLUMNA DIGITAL',
    'BANNER DIGITAL',
  ],
  'ESPECTACULAR OUT LIV': [
    'APARADOR INSURGENTES',
    'APARADOR POLANCO',
    'C&C MTY',
    'PANTALLAS LED ANTEA',
    'VIDEO WALL CRIUS',
  ],
  'MEGA MUPI': ['MEGA MUPI DIGITAL'],
  VIDEOWALL: [
    'PANTALLAS CUADRADAS',
    'VIDEO WALL CRIUS',
    'VIDEO WALL POSTER LED',
  ],
};

const ARTICLE_ALIASES: Record<string, string> = {
  'MEGA MUPI DIGITAL': 'MEGA MUPI',
};

function normalized(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase('es-MX')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function normalizeStore(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return String(Number.parseInt(trimmed, 10));
  return normalized(trimmed);
}

export function normalizeSupport(value: string): string {
  const support = normalized(value)
    .replace(/['’´`ʼ]/g, '')
    .toUpperCase();
  return SUPPORT_ALIASES[support] ?? support;
}

function quividiSupport(value: string): string {
  const support = normalizeSupport(value);
  return CALENDAR_TO_QUIVIDI_SUPPORT[support] ?? support;
}

function canonicalCircuit(value: string): string | null {
  const normalizedValue = normalizeSupport(value);
  const alias = ARTICLE_ALIASES[normalizedValue];
  if (alias) return alias;
  return Object.prototype.hasOwnProperty.call(
    CIRCUIT_TO_SUPPORTS,
    normalizedValue,
  )
    ? normalizedValue
    : null;
}

function isCompatibleSupport(
  circuitOrArticle: string,
  support: string,
): boolean {
  const circuit = canonicalCircuit(circuitOrArticle);
  if (!circuit) return false;
  return (CIRCUIT_TO_SUPPORTS[circuit] ?? []).some(
    (candidate) => normalizeSupport(candidate) === normalizeSupport(support),
  );
}

function toIsoCivilDate(value: string | null | undefined): string | null {
  const text = value?.trim() ?? '';
  if (!text) return null;

  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date.toISOString().slice(0, 10);
    }
    return null;
  }

  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!parts) return null;
  const first = Number(parts[1]);
  const second = Number(parts[2]);
  let year = Number(parts[3]);
  if (parts[3]!.length <= 2) year += 2000;

  let day: number;
  let month: number;
  if (first > 12) {
    day = first;
    month = second;
  } else if (second > 12) {
    month = first;
    day = second;
  } else {
    day = first;
    month = second;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function overlaps(
  campaignStart: string,
  campaignEnd: string,
  assignmentStart: string | null | undefined,
  assignmentEnd: string | null | undefined,
): boolean {
  const campaignStartIso = toIsoCivilDate(campaignStart);
  const campaignEndIso = toIsoCivilDate(campaignEnd);
  const assignmentStartIso = toIsoCivilDate(assignmentStart);
  const assignmentEndIso = toIsoCivilDate(assignmentEnd);
  if (
    !campaignStartIso ||
    !campaignEndIso ||
    !assignmentStartIso ||
    !assignmentEndIso
  ) {
    return false;
  }
  return (
    assignmentStartIso <= campaignEndIso && assignmentEndIso >= campaignStartIso
  );
}

function activeScreens(screens: readonly ScreenDoc[]): ScreenDoc[] {
  return screens.filter((screen) => screen.metadata?.active !== false);
}

function screensByPair(
  screens: readonly ScreenDoc[],
): Map<string, ScreenDoc[]> {
  const result = new Map<string, ScreenDoc[]>();
  for (const screen of activeScreens(screens)) {
    const store = normalizeStore(screen.original?.['Numero de Tienda'] ?? '');
    const support = normalizeSupport(screen.metadata?.calendarSupport ?? '');
    if (!store || !support) continue;
    const key = store + '|' + support;
    const bucket = result.get(key) ?? [];
    bucket.push(screen);
    result.set(key, bucket);
  }
  return result;
}

function allStoresForSupport(
  support: string,
  screens: readonly ScreenDoc[],
): string[] {
  return Array.from(
    new Set(
      activeScreens(screens)
        .filter(
          (screen) =>
            normalizeSupport(screen.metadata?.calendarSupport ?? '') ===
            support,
        )
        .map((screen) =>
          normalizeStore(screen.original?.['Numero de Tienda'] ?? ''),
        )
        .filter(Boolean),
    ),
  );
}

function pairFromStore(
  storeNumber: string,
  support: string,
  selectedName: string,
  source: EffectiveScopeSource,
  ekonNumber: number | null,
  byPair: ReadonlyMap<string, ScreenDoc[]>,
): EffectiveSupportPair {
  const matching = byPair.get(storeNumber + '|' + support) ?? [];
  const storeName =
    matching
      .map((screen) => screen.original?.['Nombre de tienda']?.trim() ?? '')
      .find(Boolean) ?? selectedName.trim();
  const cameraNames = Array.from(
    new Set(
      matching
        .flatMap((screen) => [
          screen.metadata?.quividiCameraName?.trim() ?? '',
          screen.metadata?.quividiCameraName2?.trim() ?? '',
        ])
        .filter(Boolean),
    ),
  );
  return {
    storeNumber,
    storeName,
    support,
    cameraNames,
    source,
    ekonNumber,
  };
}

async function ekonNumberForCampaign(
  db: Firestore,
  campaignId: string,
  campaign: CampaignDoc,
): Promise<number | null> {
  const exact = await db.collection('campaignEkonLinks').doc(campaignId).get();
  const exactData = exact.data() as CampaignEkonLinkDoc | undefined;
  if (
    exact.exists &&
    typeof exactData?.ekonCampaignNumber === 'number' &&
    Number.isFinite(exactData.ekonCampaignNumber)
  ) {
    return exactData.ekonCampaignNumber;
  }

  const nameKey = campaign.nameKey?.trim();
  if (!nameKey) return null;
  const legacy = await db
    .collection('campaignEkonLinks')
    .where('campaignNameKey', '==', nameKey)
    .limit(1)
    .get();
  const data = legacy.docs[0]?.data() as CampaignEkonLinkDoc | undefined;
  return typeof data?.ekonCampaignNumber === 'number' &&
    Number.isFinite(data.ekonCampaignNumber)
    ? data.ekonCampaignNumber
    : null;
}

async function assignmentsForEkon(
  db: Firestore,
  ekonNumber: number,
  cache: Map<number, EkonAssignmentDoc[]>,
): Promise<EkonAssignmentDoc[]> {
  const cached = cache.get(ekonNumber);
  if (cached) return cached;
  const snapshot = await db
    .collection('ekonAssignments')
    .where('campaignNumber', '==', String(ekonNumber))
    .where('active', '==', true)
    .get();
  const rows = snapshot.docs
    .map((doc) => doc.data() as EkonAssignmentDoc)
    .filter((assignment) => !assignment.conflict);
  cache.set(ekonNumber, rows);
  return rows;
}

function noCommentFullCircuitSupport(support: string): boolean {
  return FULL_CIRCUIT_WITHOUT_COMMENT.has(normalizeSupport(support));
}

export async function buildEffectiveSupportPairs(
  db: Firestore,
  campaignId: string,
  campaign: CampaignDoc,
  screens: readonly ScreenDoc[],
  assignmentCache: Map<number, EkonAssignmentDoc[]> = new Map(),
): Promise<EffectiveScopeResult> {
  const campaignStart = campaign.fechaInicio?.trim() ?? '';
  const campaignEnd = campaign.fechaFin?.trim() ?? '';
  const byPair = screensByPair(screens);
  const result = new Map<string, EffectiveSupportPair>();
  const origins: EffectiveScopeOrigin[] = [];
  let resolvedEkonNumber: number | null | undefined;

  const getEkonNumber = async (): Promise<number | null> => {
    if (resolvedEkonNumber !== undefined) return resolvedEkonNumber;
    resolvedEkonNumber = await ekonNumberForCampaign(db, campaignId, campaign);
    return resolvedEkonNumber;
  };

  for (const item of campaign.supports ?? []) {
    const support = quividiSupport(item.support ?? '');
    if (!support) continue;
    const stores = item.stores ?? [];
    const scope = item.scope ?? (stores.length === 0 ? 'all' : 'selected');
    if (scope === 'invalid') {
      origins.push({
        support,
        source: 'unresolved',
        pairCount: 0,
        ekonNumber: null,
      });
      continue;
    }

    let source: EffectiveScopeSource = 'unresolved';
    let ekonNumber: number | null = null;
    let targetStores: Array<{ numero: string; nombre: string }> = [];

    if (stores.length > 0) {
      source = 'calendar-selected';
      targetStores = stores
        .map((store) => ({
          numero: normalizeStore(store.numero ?? ''),
          nombre: store.nombre?.trim() ?? '',
        }))
        .filter((store) => Boolean(store.numero));
    } else if (
      item.scopeSource === 'comment-explicit-all' ||
      item.scopeSource === 'resolution-all'
    ) {
      source = 'calendar-all';
      targetStores = allStoresForSupport(support, screens).map((numero) => ({
        numero,
        nombre: '',
      }));
    } else if (noCommentFullCircuitSupport(support)) {
      source = 'calendar-full-circuit';
      targetStores = allStoresForSupport(support, screens).map((numero) => ({
        numero,
        nombre: '',
      }));
    } else {
      ekonNumber = await getEkonNumber();
      if (ekonNumber != null && campaignStart && campaignEnd) {
        const assignments = await assignmentsForEkon(
          db,
          ekonNumber,
          assignmentCache,
        );
        const byStore = new Map<string, string>();
        for (const assignment of assignments) {
          if (assignment.centroAdministrativo) continue;
          if (
            !overlaps(
              campaignStart,
              campaignEnd,
              assignment.inicioPeriodo,
              assignment.finPeriodo,
            )
          ) {
            continue;
          }
          if (
            !isCompatibleSupport(
              assignment.circuito ?? assignment.articulo ?? '',
              support,
            )
          ) {
            continue;
          }
          const storeNumber = normalizeStore(assignment.determinanteKey ?? '');
          if (!storeNumber) continue;
          if (!byStore.has(storeNumber)) {
            byStore.set(storeNumber, assignment.tienda?.trim() ?? '');
          }
        }
        if (byStore.size > 0) {
          source = 'ekon';
          targetStores = Array.from(byStore, ([numero, nombre]) => ({
            numero,
            nombre,
          }));
        }
      }
    }

    for (const store of targetStores) {
      const key = store.numero + '|' + support;
      result.set(
        key,
        pairFromStore(
          store.numero,
          support,
          store.nombre,
          source,
          ekonNumber,
          byPair,
        ),
      );
    }
    origins.push({
      support,
      source,
      pairCount: targetStores.length,
      ekonNumber,
    });
  }

  return {
    pairs: Array.from(result.values()),
    origins,
  };
}
