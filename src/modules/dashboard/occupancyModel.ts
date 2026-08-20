import {
  normalizeSupport,
  GUADALAJARA_GALERIAS_EXCEPTION,
  type AdmiraScreen,
} from '@/domain';
import { normalizeStore } from '@/modules/consolidation/consolidate';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import {
  parseCampaignDate,
  addDays,
} from '@/modules/operational-tracking/businessDays';
import type { CampaignSupport } from '@/modules/liverpool-import/campaignParse';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';

/**
 * Modelo de **carga operativa** del Dashboard (puro, determinista, sin React ni
 * Firebase). Cruza calendario ↔ catálogo y agrega la demanda por tienda y por
 * soporte dentro de un periodo.
 *
 * Métrica principal: **pico de campañas simultáneas** (`peakConcurrentCampaigns`)
 * = máximo, para cualquier día civil del periodo, del número de campañas
 * distintas que usan esa tienda/soporte ese día. No es un porcentaje de
 * capacidad: el sistema aún no modela capacidad máxima por pantalla.
 *
 * No reutiliza `consolidate()` (excluye InStore Media y agrupa por resolución);
 * hace su propio cruce reutilizando `normalizeStore`/`normalizeSupport` y la
 * excepción de Guadalajara. No modifica pantallas ni persiste agregados.
 */

export type OccupancyClassification = 'institutional' | 'provider' | 'unknown';
export type Owner = 'liverpool' | 'instore-media';

export interface OccupancyCampaign {
  campaignId: string;
  campaignName: string;
  campaignNameKey: string;
  classification: OccupancyClassification;
  startDate: Date | null;
  endDate: Date | null;
}

export interface ClassificationBreakdown {
  institutional: number;
  provider: number;
  unknown: number;
}

export interface SupportOccupancy {
  supportKey: string;
  supportName: string;
  owner: Owner;
  peakConcurrentCampaigns: number;
  distinctCampaigns: number;
  campaignDays: number;
  classification: ClassificationBreakdown;
  distinctStores: number;
  physicalScreens: number;
  campaigns: OccupancyCampaign[];
}

export interface StoreOccupancy {
  storeNumber: string;
  storeName: string;
  peakConcurrentCampaigns: number;
  distinctCampaigns: number;
  campaignDays: number;
  classification: ClassificationBreakdown;
  distinctSupports: number;
  physicalScreens: number;
  campaigns: OccupancyCampaign[];
}

export interface StoreSupportOccupancy {
  storeNumber: string;
  storeName: string;
  supportKey: string;
  supportName: string;
  owner: Owner;
  peakConcurrentCampaigns: number;
  distinctCampaigns: number;
  campaignDays: number;
  classification: ClassificationBreakdown;
  screenIds: string[];
  campaigns: OccupancyCampaign[];
}

export type OccupancyIssueCode =
  | 'invalid-date'
  | 'store-not-in-catalog'
  | 'store-support-mismatch'
  | 'screen-inactive'
  | 'support-not-in-catalog'
  | 'instore-without-stores';

export interface OccupancyIssue {
  code: OccupancyIssueCode;
  campaignName: string;
  storeNumber?: string;
  support: string;
  message: string;
}

export interface OccupancyTotals {
  peakConcurrentCampaigns: number;
  distinctCampaigns: number;
  campaignDays: number;
  distinctStores: number;
  distinctSupports: number;
  physicalScreens: number;
}

/** Punto diario de carga: campañas activas ese día por clasificación. */
export interface DailyLoadPoint {
  /** Fecha civil (medianoche UTC). */
  date: Date;
  institutional: number;
  provider: number;
  unknown: number;
  total: number;
}

export interface OccupancyDashboard {
  supports: SupportOccupancy[];
  stores: StoreOccupancy[];
  matrix: StoreSupportOccupancy[];
  issues: OccupancyIssue[];
  totals: OccupancyTotals;
  /** Serie diaria de campañas simultáneas dentro del periodo. */
  series: DailyLoadPoint[];
  /** Campañas distintas del periodo por clasificación (para la dona). */
  classificationTotals: ClassificationBreakdown;
  /**
   * Ids (`OccupancyCampaign.campaignNameKey` = `campaign.id`) de las campañas
   * que participan tras aplicar el periodo y los filtros (incluidas las
   * colocaciones resueltas contra el catálogo). Es la fuente única para que el
   * resumen operativo (KPIs/alertas) se recorte igual que la carga cuando hay
   * filtro de propietario/soporte/tienda activo.
   */
  campaignIds: string[];
}

/** Periodo civil (medianoche UTC, ambos extremos inclusivos). */
export interface DateRange {
  start: Date;
  end: Date;
}

export interface OccupancyFilters {
  classification?: OccupancyClassification | 'all';
  owner?: Owner | 'all';
  /** Número de tienda (se normaliza internamente). */
  store?: string | null;
  /** Soporte (se normaliza internamente). */
  support?: string | null;
  /** Búsqueda por nombre de campaña. */
  search?: string;
}

export interface OccupancyInput {
  campaigns: readonly OccupancyCampaignInput[];
  screens: readonly AdmiraScreen[];
  tracking: readonly CampaignOperationalTracking[];
  range: DateRange;
  filters?: OccupancyFilters;
}

/** Entrada mínima de campaña (compatible con `StoredCampaign`). */
export interface OccupancyCampaignInput {
  id: string;
  name: string;
  nameKey: string;
  tipo: string;
  fechaInicio: string;
  fechaFin: string;
  supports: readonly CampaignSupport[];
}

const norm = normalizeSupport;
const G = GUADALAJARA_GALERIAS_EXCEPTION;

// --- Índices de catálogo -----------------------------------------------------

interface CatalogIndex {
  activeByStoreSupport: Map<string, AdmiraScreen[]>;
  inactiveByStoreSupport: Map<string, AdmiraScreen[]>;
  activeBySupport: Map<string, AdmiraScreen[]>;
  activeByStore: Map<string, AdmiraScreen[]>;
  nameByStore: Map<string, string>;
  allStores: Set<string>;
}

function pushMap(m: Map<string, AdmiraScreen[]>, k: string, s: AdmiraScreen) {
  const list = m.get(k);
  if (list) list.push(s);
  else m.set(k, [s]);
}

function buildCatalogIndex(screens: readonly AdmiraScreen[]): CatalogIndex {
  const idx: CatalogIndex = {
    activeByStoreSupport: new Map(),
    inactiveByStoreSupport: new Map(),
    activeBySupport: new Map(),
    activeByStore: new Map(),
    nameByStore: new Map(),
    allStores: new Set(),
  };
  for (const s of screens) {
    const store = normalizeStore(s.original['Numero de Tienda']);
    idx.allStores.add(store);
    const name = (s.original['Nombre de tienda'] ?? '').trim();
    if (name && !idx.nameByStore.has(store)) idx.nameByStore.set(store, name);

    const support = s.metadata.calendarSupport;
    if (!support) continue;
    const key = `${norm(support)}|${store}`;
    if (s.metadata.active) {
      pushMap(idx.activeByStoreSupport, key, s);
      pushMap(idx.activeByStore, store, s);
      pushMap(idx.activeBySupport, norm(support), s);
    } else {
      pushMap(idx.inactiveByStoreSupport, key, s);
    }
  }
  return idx;
}

/** Pantallas CUADRADA activas de la tienda 78 (excepción Guadalajara). */
function guadalajaraCuadrada(idx: CatalogIndex): AdmiraScreen[] {
  const store = idx.activeByStore.get(normalizeStore(G.storeNumber)) ?? [];
  const participates = store.some(
    (s) => norm(s.metadata.calendarSupport) === norm(G.requestedSupport),
  );
  if (!participates) return [];
  return store.filter((s) => norm(s.original.Modelo) === 'CUADRADA');
}

// --- Colocaciones (campaña × combinación tienda-soporte) ---------------------

const MS_DAY = 86_400_000;
const dayNum = (d: Date) => Math.round(d.getTime() / MS_DAY);

interface Placement {
  campaign: OccupancyCampaign;
  startDay: number;
  endDay: number;
  days: number;
  store: string;
  storeName: string;
  support: string;
  supportName: string;
  owner: Owner;
  screenIds: string[];
}

interface PeriodCampaign {
  campaign: OccupancyCampaign;
  startDay: number;
  endDay: number;
  days: number;
}

function classify(
  c: OccupancyCampaignInput,
  trackingByKey: Map<string, CampaignOperationalTracking>,
): OccupancyClassification {
  const t = trackingByKey.get(c.id) ?? trackingByKey.get(c.nameKey);
  if (t) return t.classification;
  return classifyFromTipo(c.tipo);
}

/** Máxima superposición (pico simultáneo) de un conjunto de intervalos [s,e]. */
function maxOverlap(intervals: { s: number; e: number }[]): number {
  const events: { day: number; delta: number }[] = [];
  for (const it of intervals) {
    events.push({ day: it.s, delta: 1 });
    events.push({ day: it.e + 1, delta: -1 });
  }
  events.sort((a, b) => a.day - b.day || a.delta - b.delta);
  let cur = 0;
  let peak = 0;
  for (const ev of events) {
    cur += ev.delta;
    if (cur > peak) peak = cur;
  }
  return peak;
}

/**
 * Resuelve las colocaciones y las incidencias de una campaña dentro del periodo.
 * Devuelve `null` si la campaña no intersecta el periodo (sin incidencia).
 */
function resolveCampaign(
  c: OccupancyCampaignInput,
  classification: OccupancyClassification,
  idx: CatalogIndex,
  range: DateRange,
  issues: OccupancyIssue[],
): { period: PeriodCampaign; placements: Placement[] } | null {
  const es = parseCampaignDate(c.fechaInicio);
  const ee = parseCampaignDate(c.fechaFin);
  const effStart = es ?? ee;
  const effEnd = ee ?? es;
  const oc: OccupancyCampaign = {
    campaignId: c.id,
    campaignName: c.name,
    // Las agregaciones y deep links deben distinguir flights homónimos.
    campaignNameKey: c.id,
    classification,
    startDate: effStart,
    endDate: effEnd,
  };

  if (!effStart || !effEnd) {
    issues.push({
      code: 'invalid-date',
      campaignName: c.name,
      support: '',
      message: `La campaña "${c.name}" no tiene fechas válidas; se excluye de la carga.`,
    });
    return null;
  }

  // Intersección con el periodo (recortado).
  const clipStart =
    effStart.getTime() > range.start.getTime() ? effStart : range.start;
  const clipEnd = effEnd.getTime() < range.end.getTime() ? effEnd : range.end;
  if (clipStart.getTime() > clipEnd.getTime()) return null; // fuera del periodo

  const startDay = dayNum(clipStart);
  const endDay = dayNum(clipEnd);
  const days = endDay - startDay + 1;
  const period: PeriodCampaign = { campaign: oc, startDay, endDay, days };

  // Combos (tienda|soporte) deduplicados por campaña; se unen las pantallas.
  const combos = new Map<
    string,
    {
      store: string;
      storeName: string;
      support: string;
      supportName: string;
      owner: Owner;
      screens: Set<string>;
    }
  >();
  const addCombo = (
    store: string,
    storeName: string,
    supportName: string,
    owner: Owner,
    screens: AdmiraScreen[],
  ) => {
    const support = norm(supportName);
    const key = `${store}|${support}`;
    let combo = combos.get(key);
    if (!combo) {
      combo = {
        store,
        storeName,
        support,
        supportName,
        owner,
        screens: new Set(),
      };
      combos.set(key, combo);
    }
    for (const s of screens) combo.screens.add(s.id);
    return combo;
  };

  const isCrius = (support: string) =>
    norm(support) === norm(G.requestedSupport);

  for (const support of c.supports) {
    if (support.owner === 'instore-media') {
      resolveInstore(c, support, idx, issues, addCombo);
      continue;
    }
    resolveLiverpool(
      c,
      support,
      idx,
      issues,
      addCombo,
      isCrius(support.support),
    );
  }

  const placements: Placement[] = [];
  for (const combo of combos.values()) {
    placements.push({
      campaign: oc,
      startDay,
      endDay,
      days,
      store: combo.store,
      storeName: combo.storeName,
      support: combo.support,
      supportName: combo.supportName,
      owner: combo.owner,
      screenIds: [...combo.screens],
    });
  }
  return { period, placements };
}

type AddCombo = (
  store: string,
  storeName: string,
  supportName: string,
  owner: Owner,
  screens: AdmiraScreen[],
) => unknown;

function resolveLiverpool(
  c: OccupancyCampaignInput,
  support: CampaignSupport,
  idx: CatalogIndex,
  issues: OccupancyIssue[],
  addCombo: AddCombo,
  isCrius: boolean,
): void {
  const nSupport = norm(support.support);
  const nameFor = (store: string) => idx.nameByStore.get(store) ?? store;

  if (support.stores.length === 0) {
    // "Asignada" sin comentario: expandir pantallas activas del soporte.
    const expanded = idx.activeBySupport.get(nSupport) ?? [];
    if (expanded.length === 0) {
      issues.push({
        code: 'support-not-in-catalog',
        campaignName: c.name,
        support: support.support,
        message: `El soporte "${support.support}" (campaña "${c.name}") está asignado sin tiendas y no hay pantallas activas para expandirlo.`,
      });
      return;
    }
    const byStore = new Map<string, AdmiraScreen[]>();
    for (const s of expanded) {
      const store = normalizeStore(s.original['Numero de Tienda']);
      pushMap(byStore, store, s);
    }
    for (const [store, screens] of byStore) {
      addCombo(store, nameFor(store), support.support, 'liverpool', screens);
    }
    if (isCrius) {
      const cuadrada = guadalajaraCuadrada(idx);
      if (cuadrada.length > 0) {
        const store = normalizeStore(G.storeNumber);
        addCombo(store, nameFor(store), support.support, 'liverpool', cuadrada);
      }
    }
    return;
  }

  for (const st of support.stores) {
    const store = normalizeStore(st.numero);
    const key = `${nSupport}|${store}`;
    const active = idx.activeByStoreSupport.get(key) ?? [];
    if (active.length > 0) {
      addCombo(store, nameFor(store), support.support, 'liverpool', active);
      if (isCrius && store === normalizeStore(G.storeNumber)) {
        const cuadrada = (idx.activeByStore.get(store) ?? []).filter(
          (s) => norm(s.original.Modelo) === 'CUADRADA',
        );
        if (cuadrada.length > 0) {
          addCombo(
            store,
            nameFor(store),
            support.support,
            'liverpool',
            cuadrada,
          );
        }
      }
      continue;
    }
    // Sin pantalla activa: clasificar la incidencia de calidad.
    if ((idx.inactiveByStoreSupport.get(key) ?? []).length > 0) {
      issues.push({
        code: 'screen-inactive',
        campaignName: c.name,
        storeNumber: store,
        support: support.support,
        message: `Tienda ${store}, soporte "${support.support}" (campaña "${c.name}"): solo hay pantallas inactivas; no suma carga.`,
      });
    } else if (idx.allStores.has(store)) {
      issues.push({
        code: 'store-support-mismatch',
        campaignName: c.name,
        storeNumber: store,
        support: support.support,
        message: `Tienda ${store} existe pero no con el soporte "${support.support}" (campaña "${c.name}").`,
      });
    } else {
      issues.push({
        code: 'store-not-in-catalog',
        campaignName: c.name,
        storeNumber: store,
        support: support.support,
        message: `Tienda ${store} (soporte "${support.support}", campaña "${c.name}") no existe en el catálogo.`,
      });
    }
  }
}

function resolveInstore(
  c: OccupancyCampaignInput,
  support: CampaignSupport,
  idx: CatalogIndex,
  issues: OccupancyIssue[],
  addCombo: AddCombo,
): void {
  if (support.stores.length === 0) {
    issues.push({
      code: 'instore-without-stores',
      campaignName: c.name,
      support: support.support,
      message: `El soporte InStore Media "${support.support}" (campaña "${c.name}") está asignado sin comentario; no se puede expandir.`,
    });
    return;
  }
  for (const st of support.stores) {
    const store = normalizeStore(st.numero);
    const name = idx.nameByStore.get(store);
    if (!name && !idx.allStores.has(store)) {
      issues.push({
        code: 'store-not-in-catalog',
        campaignName: c.name,
        storeNumber: store,
        support: support.support,
        message: `Tienda ${store} (InStore Media "${support.support}", campaña "${c.name}") no existe en el catálogo; se conserva el número.`,
      });
    }
    // Sin pantallas físicas (no hay catálogo InStore Media autoritativo).
    addCombo(store, name ?? store, support.support, 'instore-media', []);
  }
}

// --- Agregación --------------------------------------------------------------

interface Bucket {
  campaigns: Map<
    string,
    { oc: OccupancyCampaign; s: number; e: number; days: number }
  >;
  screens: Set<string>;
  stores: Set<string>;
  supports: Set<string>;
  supportName: string;
  storeName: string;
  owner: Owner;
}

function newBucket(): Bucket {
  return {
    campaigns: new Map(),
    screens: new Set(),
    stores: new Set(),
    supports: new Set(),
    supportName: '',
    storeName: '',
    owner: 'liverpool',
  };
}

function addToBucket(b: Bucket, p: Placement) {
  if (!b.campaigns.has(p.campaign.campaignNameKey)) {
    b.campaigns.set(p.campaign.campaignNameKey, {
      oc: p.campaign,
      s: p.startDay,
      e: p.endDay,
      days: p.days,
    });
  }
  for (const id of p.screenIds) b.screens.add(id);
  b.stores.add(p.store);
  b.supports.add(p.support);
}

function breakdown(
  campaigns: Iterable<{ oc: OccupancyCampaign }>,
): ClassificationBreakdown {
  const bd: ClassificationBreakdown = {
    institutional: 0,
    provider: 0,
    unknown: 0,
  };
  for (const c of campaigns) bd[c.oc.classification] += 1;
  return bd;
}

function bucketCampaigns(b: Bucket): OccupancyCampaign[] {
  return [...b.campaigns.values()]
    .map((c) => c.oc)
    .sort((a, z) => a.campaignName.localeCompare(z.campaignName, 'es'));
}

function bucketPeak(b: Bucket): number {
  return maxOverlap([...b.campaigns.values()].map((c) => ({ s: c.s, e: c.e })));
}

function bucketDays(b: Bucket): number {
  let sum = 0;
  for (const c of b.campaigns.values()) sum += c.days;
  return sum;
}

/** Orden estable: pico desc, distintas desc, nombre asc. */
function compareLoad(
  a: { peakConcurrentCampaigns: number; distinctCampaigns: number },
  b: { peakConcurrentCampaigns: number; distinctCampaigns: number },
  nameA: string,
  nameB: string,
): number {
  return (
    b.peakConcurrentCampaigns - a.peakConcurrentCampaigns ||
    b.distinctCampaigns - a.distinctCampaigns ||
    nameA.localeCompare(nameB, 'es')
  );
}

function normalizeText(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Construye el modelo de carga operativa del Dashboard (puro). */
export function buildOccupancyDashboard(
  input: OccupancyInput,
): OccupancyDashboard {
  const { campaigns, screens, tracking, range } = input;
  const filters = input.filters ?? {};
  const classFilter = filters.classification ?? 'all';
  const ownerFilter = filters.owner ?? 'all';
  const storeFilter = filters.store ? normalizeStore(filters.store) : null;
  const supportFilter = filters.support ? norm(filters.support) : null;
  const search = normalizeText(filters.search ?? '');

  const idx = buildCatalogIndex(screens);
  const trackingByKey = new Map<string, CampaignOperationalTracking>();
  for (const t of tracking) {
    trackingByKey.set(t.campaignId ?? t.campaignNameKey, t);
  }

  const issues: OccupancyIssue[] = [];
  const periodCampaigns: PeriodCampaign[] = [];
  const placements: Placement[] = [];
  // Cuando hay un filtro de colocación activo (propietario/tienda/soporte), una
  // campaña solo participa en totales, serie diaria y dona si conserva al menos
  // una colocación que cumpla todos esos filtros (requerimiento §5.3). Sin esos
  // filtros, participan todas las campañas del periodo (comportamiento previo).
  const placementFilterActive =
    ownerFilter !== 'all' || storeFilter !== null || supportFilter !== null;
  const campaignsWithPlacement = new Set<string>();

  for (const c of campaigns) {
    const classification = classify(c, trackingByKey);
    // Filtros a nivel campaña (afectan también los totales de periodo).
    if (classFilter !== 'all' && classification !== classFilter) continue;
    if (search && !normalizeText(c.name).includes(search)) continue;

    const resolved = resolveCampaign(c, classification, idx, range, issues);
    if (!resolved) continue;
    periodCampaigns.push(resolved.period);
    for (const p of resolved.placements) {
      if (ownerFilter !== 'all' && p.owner !== ownerFilter) continue;
      if (storeFilter && p.store !== storeFilter) continue;
      if (supportFilter && p.support !== supportFilter) continue;
      placements.push(p);
      campaignsWithPlacement.add(p.campaign.campaignNameKey);
    }
  }

  // Conjunto de campañas del periodo que alimenta totales, serie y dona.
  const effectivePeriodCampaigns = placementFilterActive
    ? periodCampaigns.filter((p) =>
        campaignsWithPlacement.has(p.campaign.campaignNameKey),
      )
    : periodCampaigns;

  // Agregación por soporte, tienda y celda tienda-soporte.
  const bySupport = new Map<string, Bucket>();
  const byStore = new Map<string, Bucket>();
  const byCell = new Map<string, Bucket>();

  for (const p of placements) {
    const sup = bySupport.get(p.support) ?? newBucket();
    sup.supportName ||= p.supportName;
    sup.owner = p.owner;
    addToBucket(sup, p);
    bySupport.set(p.support, sup);

    const sto = byStore.get(p.store) ?? newBucket();
    sto.storeName ||= p.storeName;
    addToBucket(sto, p);
    byStore.set(p.store, sto);

    const cellKey = `${p.store}|${p.support}`;
    const cell = byCell.get(cellKey) ?? newBucket();
    cell.supportName ||= p.supportName;
    cell.storeName ||= p.storeName;
    cell.owner = p.owner;
    addToBucket(cell, p);
    byCell.set(cellKey, cell);
  }

  const supports: SupportOccupancy[] = [...bySupport.entries()]
    .map(([key, b]) => ({
      supportKey: key,
      supportName: b.supportName,
      owner: b.owner,
      peakConcurrentCampaigns: bucketPeak(b),
      distinctCampaigns: b.campaigns.size,
      campaignDays: bucketDays(b),
      classification: breakdown(b.campaigns.values()),
      distinctStores: b.stores.size,
      physicalScreens: b.screens.size,
      campaigns: bucketCampaigns(b),
    }))
    .sort((a, z) => compareLoad(a, z, a.supportName, z.supportName));

  const stores: StoreOccupancy[] = [...byStore.entries()]
    .map(([key, b]) => ({
      storeNumber: key,
      storeName: b.storeName,
      peakConcurrentCampaigns: bucketPeak(b),
      distinctCampaigns: b.campaigns.size,
      campaignDays: bucketDays(b),
      classification: breakdown(b.campaigns.values()),
      distinctSupports: b.supports.size,
      physicalScreens: b.screens.size,
      campaigns: bucketCampaigns(b),
    }))
    .sort((a, z) => compareLoad(a, z, a.storeName, z.storeName));

  const matrix: StoreSupportOccupancy[] = [...byCell.entries()]
    .map(([key, b]) => {
      const [store, support] = key.split('|');
      return {
        storeNumber: store ?? '',
        storeName: b.storeName,
        supportKey: support ?? '',
        supportName: b.supportName,
        owner: b.owner,
        peakConcurrentCampaigns: bucketPeak(b),
        distinctCampaigns: b.campaigns.size,
        campaignDays: bucketDays(b),
        classification: breakdown(b.campaigns.values()),
        screenIds: [...b.screens],
        campaigns: bucketCampaigns(b),
      };
    })
    .sort((a, z) =>
      compareLoad(
        a,
        z,
        `${a.storeName}${a.supportName}`,
        `${z.storeName}${z.supportName}`,
      ),
    );

  // Totales: pico/distintas/días desde el conjunto de campañas del periodo;
  // tiendas/soportes/pantallas desde las colocaciones filtradas.
  const allStores = new Set<string>();
  const allSupports = new Set<string>();
  const allScreens = new Set<string>();
  for (const p of placements) {
    allStores.add(p.store);
    allSupports.add(p.support);
    for (const id of p.screenIds) allScreens.add(id);
  }
  const totals: OccupancyTotals = {
    peakConcurrentCampaigns: maxOverlap(
      effectivePeriodCampaigns.map((p) => ({ s: p.startDay, e: p.endDay })),
    ),
    distinctCampaigns: effectivePeriodCampaigns.length,
    campaignDays: effectivePeriodCampaigns.reduce((n, p) => n + p.days, 0),
    distinctStores: allStores.size,
    distinctSupports: allSupports.size,
    physicalScreens: allScreens.size,
  };

  const series = buildDailySeries(effectivePeriodCampaigns, range);
  const classificationTotals = breakdown(
    effectivePeriodCampaigns.map((p) => ({ oc: p.campaign })),
  );

  return {
    supports,
    stores,
    matrix,
    issues,
    totals,
    series,
    classificationTotals,
    campaignIds: effectivePeriodCampaigns.map(
      (p) => p.campaign.campaignNameKey,
    ),
  };
}

/** Máximo de puntos diarios a materializar en la serie (evita rangos enormes). */
const MAX_SERIES_DAYS = 400;

/**
 * Serie diaria de campañas simultáneas por clasificación dentro del periodo.
 * Para cada día civil cuenta las campañas del periodo activas ese día.
 */
function buildDailySeries(
  periodCampaigns: PeriodCampaign[],
  range: DateRange,
): DailyLoadPoint[] {
  const startDay = dayNum(range.start);
  const endDay = dayNum(range.end);
  if (endDay < startDay) return [];
  const span = Math.min(endDay - startDay + 1, MAX_SERIES_DAYS);
  const points: DailyLoadPoint[] = [];
  for (let i = 0; i < span; i += 1) {
    const day = startDay + i;
    const point: DailyLoadPoint = {
      date: new Date(day * MS_DAY),
      institutional: 0,
      provider: 0,
      unknown: 0,
      total: 0,
    };
    for (const p of periodCampaigns) {
      if (p.startDay <= day && day <= p.endDay) {
        point[p.campaign.classification] += 1;
        point.total += 1;
      }
    }
    points.push(point);
  }
  return points;
}

// --- Periodos ----------------------------------------------------------------

export type RangePreset =
  'today' | 'this-week' | 'next-7' | 'this-month' | 'next-30' | 'custom';

/** Fecha civil (medianoche UTC) desde componentes UTC de otra fecha. */
function civil(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

/** Rango civil para un preset, relativo a `today` (fecha civil UTC). */
export function presetRange(preset: RangePreset, today: Date): DateRange {
  const t = civil(today);
  switch (preset) {
    case 'today':
      return { start: t, end: t };
    case 'next-7':
      return { start: t, end: addDays(t, 6) };
    case 'next-30':
      return { start: t, end: addDays(t, 29) };
    case 'this-week': {
      // Semana civil de lunes a domingo.
      const dow = t.getUTCDay(); // 0=domingo
      const backToMonday = dow === 0 ? 6 : dow - 1;
      const start = addDays(t, -backToMonday);
      return { start, end: addDays(start, 6) };
    }
    case 'this-month': {
      const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      const end = new Date(
        Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0),
      );
      return { start, end };
    }
    case 'custom':
      return { start: t, end: t };
  }
}

/** Etiqueta legible por clasificación. */
export const CLASSIFICATION_LABEL: Record<OccupancyClassification, string> = {
  institutional: 'Institucional',
  provider: 'Proveedor',
  unknown: 'Pendiente',
};
