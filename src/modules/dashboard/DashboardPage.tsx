import { useEkonResolvedCampaigns } from '@/modules/consolidation/useEkonResolvedCampaigns';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { Icon, type IconName } from '@/components/Icon';
import { NAV_ROUTES } from '@/app/routes';
import { canAccessRoute } from '@/app/routes';
import { can } from '@/app/permissions';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import { listOperationalTracking } from '@/services/campaignOperationalTracking';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from '@/modules/campaigns/campaignDiff';
import type { CampaignOperationalTracking } from '@/modules/operational-tracking/types';
import type { UserRole } from '@/domain/constants';
import {
  buildTrackingRows,
  criticalAlerts,
  effectiveChecks,
  isFullyTracked,
  rowSeverity,
  type TrackingRow,
} from '@/modules/operational-tracking/trackingModel';
import { STATUS_META } from '@/modules/operational-tracking/statusMeta';
import {
  todayCivil,
  parseCampaignDate,
  calendarDaysUntil,
  formatDdMmYyyy,
  formatCivilString,
} from '@/modules/operational-tracking/businessDays';
import { DigitalDashboardPanel } from '@/modules/digital-dashboard/DigitalDashboardPanel';
import {
  buildOccupancyDashboard,
  presetRange,
  type DateRange,
  type RangePreset,
  type OccupancyClassification,
  type Owner,
  type SupportOccupancy,
  type StoreOccupancy,
  type StoreSupportOccupancy,
  type OccupancyCampaign,
} from './occupancyModel';
import {
  OccupancyFilters,
  type OccupancyFilterValues,
} from './components/OccupancyFilters';
import { SupportOccupancyChart } from './components/SupportOccupancyChart';
import { StoreOccupancyChart } from './components/StoreOccupancyChart';
import { StoreSupportMatrix } from './components/StoreSupportMatrix';
import { OccupancyDetailPanel } from './components/OccupancyDetailPanel';
import { KpiDetailPanel } from './components/KpiDetailPanel';
import { DailyLoadChart } from './components/DailyLoadChart';
import { ClassificationDonut } from './components/ClassificationDonut';
import { filterDashboardRows } from './dashboardFilters';
import {
  formatStatusReason,
  isOperationallyApplicableStatus,
  statusByCampaignId,
} from '@/modules/campaigns/campaignStatus';
import { campaignIntersectsPeriod } from '@/modules/campaigns/dateFilter';
import { useTheme } from '@/app/theme';
import { ControlCenterPanel } from './controlCenter/ControlCenterPanel';
import './DashboardPage.css';
import './DashboardLayout.css';

type DashboardTone = 'info' | 'success' | 'warning' | 'danger';

type KpiId = 'active' | 'full' | 'ontrack' | 'alerts' | 'overdue';

interface Kpi {
  id: KpiId;
  icon: IconName;
  label: string;
  status: string;
  tone: DashboardTone;
  rows: TrackingRow[];
  /** Línea de contexto derivada del propio periodo (sin históricos nuevos). */
  context?: string;
  /** Proporción 0–100 para la mini-barra, cuando el contexto es un porcentaje. */
  meter?: number;
}

/** Identidad fija del cliente en el selector del Panel; el color siempre sale
 * de `--retailer-*` (visual-tokens de la skill de dashboards ISM). */
type RetailerId = 'liverpool' | 'chedraui' | 'lacomer' | 'soriana' | 'sanpablo';
interface RetailerDef {
  id: RetailerId;
  label: string;
  /** `digital`: tiene datos de Operación Digital multirretailer (retailerLabel
   * es el valor crudo de `DigitalOperationalItem.retailerLabel`). `empty`:
   * cliente sin perfil dado de alta en el Catálogo digital todavía. El color
   * fijo de cada uno sale de `--retailer-<id>` vía `dash-retailer--<id>`. */
  kind: 'liverpool' | 'digital' | 'empty';
  retailerLabel?: string;
}
const RETAILERS: RetailerDef[] = [
  { id: 'liverpool', label: 'Liverpool', kind: 'liverpool' },
  {
    id: 'chedraui',
    label: 'Chedraui',
    kind: 'digital',
    retailerLabel: 'CHEDRAUI',
  },
  {
    id: 'lacomer',
    label: 'La Comer',
    kind: 'digital',
    retailerLabel: 'LA COMER',
  },
  { id: 'soriana', label: 'Soriana', kind: 'empty' },
  { id: 'sanpablo', label: 'San Pablo', kind: 'empty' },
];

const QUICK_ACTION_PATHS = [
  '/seguimiento',
  '/importar',
  '/conciliacion',
  '/campanas',
] as const;

function trackingLink(row: TrackingRow): string {
  // Enlaza por identidad para resaltar el "flight" correcto en Seguimiento.
  return `/seguimiento?campana=${encodeURIComponent(row.identity)}`;
}

function isoDay(d: Date | null): string {
  return d ? formatDdMmYyyy(d) : '—';
}

/**
 * Motivo mostrado en "Atención inmediata". Si la fila tiene incidencias reales
 * (vencidos, terminada con pendientes, etc.) se listan; si no (p. ej. "vence
 * hoy" sin otra alerta) se usa el estado global, con su fecha si existe.
 */
function immediateReason(row: TrackingRow): string {
  const alerts = criticalAlerts(row);
  if (alerts.length > 0) return alerts.map((a) => a.label).join(' · ');
  const label = STATUS_META[row.overall].label;
  return row.nextDeadline ? `${label} · ${isoDay(row.nextDeadline)}` : label;
}

function rangeLabel(range: DateRange): string {
  const start = formatDdMmYyyy(range.start);
  const end = formatDdMmYyyy(range.end);
  return start === end ? start : `${start} — ${end}`;
}

type Selection =
  | { kind: 'support'; item: SupportOccupancy }
  | { kind: 'store'; item: StoreOccupancy }
  | { kind: 'cell'; item: StoreSupportOccupancy };

interface DetailData {
  title: string;
  subtitle?: string;
  stats: { label: string; value: string | number }[];
  campaigns: OccupancyCampaign[];
}

function selectionToDetail(sel: Selection): DetailData {
  if (sel.kind === 'support') {
    const s = sel.item;
    return {
      title: s.supportName,
      subtitle: s.owner === 'instore-media' ? 'InStore Media' : 'Liverpool',
      stats: [
        { label: 'Pico simultáneo', value: s.peakConcurrentCampaigns },
        { label: 'Campañas', value: s.distinctCampaigns },
        { label: 'Tiendas', value: s.distinctStores },
        { label: 'Pantallas', value: s.physicalScreens },
        { label: 'Días-campaña', value: s.campaignDays },
      ],
      campaigns: s.campaigns,
    };
  }
  if (sel.kind === 'store') {
    const s = sel.item;
    return {
      title: `${s.storeName} · ${s.storeNumber}`,
      stats: [
        { label: 'Pico simultáneo', value: s.peakConcurrentCampaigns },
        { label: 'Campañas', value: s.distinctCampaigns },
        { label: 'Soportes', value: s.distinctSupports },
        { label: 'Pantallas', value: s.physicalScreens },
        { label: 'Días-campaña', value: s.campaignDays },
      ],
      campaigns: s.campaigns,
    };
  }
  const c = sel.item;
  return {
    title: `${c.storeName} · ${c.supportName}`,
    subtitle: `Tienda ${c.storeNumber}`,
    stats: [
      { label: 'Pico simultáneo', value: c.peakConcurrentCampaigns },
      { label: 'Campañas', value: c.distinctCampaigns },
      { label: 'Pantallas', value: c.screenIds.length },
      { label: 'Días-campaña', value: c.campaignDays },
    ],
    campaigns: c.campaigns,
  };
}

/**
 * Centro de Control Operativo (panel inicial): mapa nacional de campañas,
 * incidencias y audiencias, semáforo de seguimiento, prioridades, estados de
 * campaña y carga por tienda/soporte en una sola vista.
 */
export function DashboardPage({ role = 'admin' }: { role?: UserRole }) {
  const visibleRoutes = NAV_ROUTES.filter((route) =>
    canAccessRoute(role, route),
  );
  const quickActions = QUICK_ACTION_PATHS.map((path) =>
    visibleRoutes.find((route) => route.path === path),
  ).filter((route): route is (typeof NAV_ROUTES)[number] => Boolean(route));
  const { theme } = useTheme();
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  // Retiradas del calendario (baja lógica de la importación): solo alimentan la
  // sección «Estados de campaña».
  const [withdrawn, setWithdrawn] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [tracking, setTracking] = useState<CampaignOperationalTracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setFailed(false);
    try {
      const [all, s, t] = await Promise.all([
        listCampaigns({ includeInactive: true }),
        listScreens(),
        listOperationalTracking(),
      ]);
      // Conserva datos previos hasta tener la respuesta (no vacía la pantalla).
      setCampaigns(all.filter((c) => c.active !== false));
      setWithdrawn(all.filter((c) => c.active === false));
      setScreens(s);
      setTracking(t);
      setLoadedAt(new Date());
      setLoadedOnce(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = useMemo(() => todayCivil(), []);

  // --- Filtros globales del panel ------------------------------------------
  // Un solo contexto (periodo, clasificación, propietario, soporte, tienda y
  // búsqueda) recorta TODAS las secciones: tarjetas KPI, salud operativa,
  // alertas, vencimientos, inicios, terminadas con pendientes y la carga.
  const [params, setParams] = useSearchParams();
  const filters: OccupancyFilterValues = {
    // Mes actual es el periodo predeterminado: sin `periodo` en la URL se usa
    // `this-month` (§3.3). `periodo=today` u otros presets se respetan tal cual.
    preset: (params.get('periodo') as RangePreset) || 'this-month',
    desde: params.get('desde') ?? '',
    hasta: params.get('hasta') ?? '',
    classification:
      (params.get('clasificacion') as OccupancyClassification | 'all') || 'all',
    origin:
      params.get('origen') === 'manual'
        ? 'manual'
        : params.get('origen') === 'liverpool'
          ? 'liverpool'
          : 'all',
    owner: (params.get('propietario') as Owner | 'all') || 'all',
    support: params.get('soporte') ?? '',
    store: params.get('tienda') ?? '',
    search: params.get('q') ?? '',
  };
  const patchFilters = (patch: Partial<OccupancyFilterValues>) => {
    const next = { ...filters, ...patch };
    // Clona los params actuales (preserva `retailer`/`vista`) y solo
    // reescribe las claves de filtro.
    const p = new URLSearchParams(params);
    const set = (key: string, value: string) => {
      if (value) p.set(key, value);
      else p.delete(key);
    };
    // La vista predeterminada (Mes actual) omite `periodo` de la URL (§3.3).
    set('periodo', next.preset !== 'this-month' ? next.preset : '');
    set('desde', next.preset === 'custom' ? next.desde : '');
    set('hasta', next.preset === 'custom' ? next.hasta : '');
    set(
      'clasificacion',
      next.classification !== 'all' ? next.classification : '',
    );
    set('origen', next.origin !== 'all' ? next.origin : '');
    set('propietario', next.owner !== 'all' ? next.owner : '');
    set('soporte', next.support);
    set('tienda', next.store);
    set('q', next.search);
    setParams(p, { replace: true });
  };

  // --- Selector de retailer + pestañas de Liverpool -------------------------
  // Fuera de Liverpool solo hay datos si `digitalOperations.read` está en la
  // matriz del rol; sin ese permiso el panel se comporta como antes (un solo
  // cliente, sin selector).
  const canSeeRetailers = can(role, 'digitalOperations.read');
  const retailerParam = params.get('retailer') as RetailerId | null;
  const retailer: RetailerId =
    canSeeRetailers && RETAILERS.some((r) => r.id === retailerParam)
      ? (retailerParam as RetailerId)
      : 'liverpool';
  const setRetailer = (id: RetailerId) => {
    const p = new URLSearchParams(params);
    if (id === 'liverpool') p.delete('retailer');
    else p.set('retailer', id);
    p.delete('vista');
    setParams(p, { replace: true });
  };

  const range: DateRange = useMemo(() => {
    if (filters.preset === 'custom') {
      const s = parseCampaignDate(filters.desde) ?? today;
      const e = parseCampaignDate(filters.hasta) ?? s;
      return s.getTime() <= e.getTime()
        ? { start: s, end: e }
        : { start: e, end: s };
    }
    return presetRange(filters.preset, today);
  }, [filters.preset, filters.desde, filters.hasta, today]);

  // Mupi/Pendón sin detalle toman sus tiendas de Ekon (igual que el CSV) para
  // que la meta de testigos no se calcule con tiendas de más ni de menos.
  const resolved = useEkonResolvedCampaigns(campaigns, role);
  const rows = useMemo(
    () => buildTrackingRows(resolved.campaigns, screens, tracking, today),
    [resolved.campaigns, screens, tracking, today],
  );

  // Estado efectivo por campaña (resuelve también seguimiento legacy).
  const statuses = useMemo(
    () => statusByCampaignId(campaigns, tracking),
    [campaigns, tracking],
  );

  // Modelo de carga (fuente única de la resolución de colocaciones contra el
  // catálogo). El resumen operativo reutiliza su conjunto de campañas para que
  // KPIs/alertas se recorten igual que la carga ante filtros de colocación.
  const occupancy = useMemo(
    () =>
      buildOccupancyDashboard({
        campaigns,
        screens,
        tracking,
        range,
        statuses,
        filters: {
          classification: filters.classification,
          origin: filters.origin,
          owner: filters.owner,
          store: filters.store || null,
          support: filters.support || null,
          search: filters.search,
        },
      }),
    [
      campaigns,
      screens,
      tracking,
      range,
      statuses,
      filters.classification,
      filters.origin,
      filters.owner,
      filters.store,
      filters.support,
      filters.search,
    ],
  );

  // Cuando hay filtro de propietario/soporte/tienda activo, el resumen se
  // restringe a las campañas con colocación resuelta (las mismas que alimentan
  // la carga). Sin esos filtros, no se restringe por colocación.
  const placementActive =
    filters.owner !== 'all' ||
    Boolean(filters.support) ||
    Boolean(filters.store);
  const placementCampaignIds = useMemo(
    () => (placementActive ? new Set(occupancy.campaignIds) : null),
    [placementActive, occupancy.campaignIds],
  );

  // Filas del resumen operativo recortadas al contexto global del panel.
  const filteredRows = useMemo(
    () =>
      filterDashboardRows(rows, {
        range,
        classification: filters.classification,
        origin: filters.origin,
        search: filters.search,
        placementCampaignIds,
      }),
    [
      rows,
      range,
      filters.classification,
      filters.origin,
      filters.search,
      placementCampaignIds,
    ],
  );

  const view = useMemo(() => {
    // Solo las campañas activas entran en el resumen operativo (KPIs, alertas,
    // vencimientos, inicios y terminadas con pendientes); en pausa, canceladas y
    // duplicadas se muestran aparte en «Estados de campaña». Se filtran ANTES de
    // calcular las secciones para que no acaben contadas como "En curso sin
    // atrasos" solo porque `criticalAlerts()` devuelva un arreglo vacío.
    const applicable = filteredRows.filter((r) =>
      isOperationallyApplicableStatus(r.lifecycleStatus),
    );
    const active = applicable.filter((r) => r.timeframe === 'active');
    const withAlerts = active.filter((r) => criticalAlerts(r).length > 0);
    const full = active.filter(isFullyTracked);
    const overduePending = active.filter(
      (r) =>
        r.startStatus === 'overdue' ||
        r.completeStatus === 'overdue' ||
        r.passesStatus === 'overdue',
    );
    const onTrack = active.filter(
      (r) => criticalAlerts(r).length === 0 && !isFullyTracked(r),
    );

    // B. Alertas críticas (activas + terminadas con pendientes).
    const alerts = applicable
      .map((r) => ({ row: r, alerts: criticalAlerts(r) }))
      .filter((x) => x.alerts.length > 0)
      .sort((a, b) => {
        const s = rowSeverity(a.row) - rowSeverity(b.row);
        if (s !== 0) return s;
        const da = a.row.nextDeadline?.getTime() ?? Infinity;
        const db = b.row.nextDeadline?.getTime() ?? Infinity;
        return da - db;
      });

    // C. Próximos vencimientos (por vencer, no vencidos).
    const upcomingDue = applicable
      .filter(
        (r) =>
          r.startStatus === 'due-soon' ||
          r.startStatus === 'due-today' ||
          r.completeStatus === 'due-soon' ||
          r.completeStatus === 'due-today' ||
          r.passesStatus === 'due-soon' ||
          r.passesStatus === 'due-today',
      )
      .sort(
        (a, b) =>
          (a.nextDeadline?.getTime() ?? Infinity) -
          (b.nextDeadline?.getTime() ?? Infinity),
      );

    // D. Próximos inicios (dentro de 7 días naturales).
    const upcomingStarts = applicable
      .filter((r) => {
        if (r.timeframe !== 'upcoming') return false;
        const start = parseCampaignDate(r.campaign.fechaInicio);
        if (!start) return false;
        const days = calendarDaysUntil(today, start);
        return days >= 0 && days <= 7;
      })
      .sort(
        (a, b) =>
          (parseCampaignDate(a.campaign.fechaInicio)?.getTime() ?? 0) -
          (parseCampaignDate(b.campaign.fechaInicio)?.getTime() ?? 0),
      );

    const finishedPending = applicable.filter(
      (r) => r.timeframe === 'finished' && criticalAlerts(r).length > 0,
    );

    // "Vencidas con pendientes": activas con indicadores vencidos + terminadas
    // con obligaciones pendientes (deduplicadas por identidad de campaña).
    const overdueOrFinishedPending: TrackingRow[] = [];
    const seenUrgent = new Set<string>();
    for (const r of [...overduePending, ...finishedPending]) {
      if (seenUrgent.has(r.campaign.id)) continue;
      seenUrgent.add(r.campaign.id);
      overdueOrFinishedPending.push(r);
    }

    // Atención inmediata: lo que exige acción YA, en ROJO. Cubre exactamente lo
    // mismo que dispara el rojo de "Estado operativo" (vencidas + terminadas con
    // pendientes) para no dar señales contradictorias, y suma "vence hoy" (la
    // urgencia recién escalada a rojo). "Por vencer" (días) queda fuera: sigue en
    // "Próximos vencimientos". Deduplicado por identidad y ordenado por severidad
    // y luego por el vencimiento más próximo.
    const urgentNow = applicable.filter(
      (r) =>
        r.startStatus === 'overdue' ||
        r.completeStatus === 'overdue' ||
        r.passesStatus === 'overdue' ||
        r.startStatus === 'due-today' ||
        r.completeStatus === 'due-today' ||
        r.passesStatus === 'due-today',
    );
    const immediateAttention: TrackingRow[] = [];
    const seenImmediate = new Set<string>();
    for (const r of [...urgentNow, ...finishedPending]) {
      if (seenImmediate.has(r.campaign.id)) continue;
      seenImmediate.add(r.campaign.id);
      immediateAttention.push(r);
    }
    immediateAttention.sort((a, b) => {
      const s = rowSeverity(a) - rowSeverity(b);
      if (s !== 0) return s;
      return (
        (a.nextDeadline?.getTime() ?? Infinity) -
        (b.nextDeadline?.getTime() ?? Infinity)
      );
    });

    return {
      active,
      withAlerts,
      full,
      overduePending,
      onTrack,
      alerts,
      upcomingDue,
      upcomingStarts,
      finishedPending,
      overdueOrFinishedPending,
      immediateAttention,
    };
  }, [filteredRows, today]);

  // --- Estados de campaña --------------------------------------------------
  // En pausa / canceladas / duplicadas del contexto del panel, más las
  // retiradas del calendario que se cruzan con el periodo.
  const withdrawnRows = useMemo(() => {
    const inPeriod = withdrawn.filter((c) =>
      campaignIntersectsPeriod(
        c.fechaInicio,
        c.fechaFin,
        range.start,
        range.end,
      ),
    );
    return filterDashboardRows(
      buildTrackingRows(inPeriod, screens, tracking, today),
      {
        range,
        classification: filters.classification,
        origin: filters.origin,
        search: filters.search,
        placementCampaignIds: null,
      },
    );
  }, [
    withdrawn,
    screens,
    tracking,
    today,
    range,
    filters.classification,
    filters.origin,
    filters.search,
  ]);
  const statusView = useMemo(
    () => ({
      paused: filteredRows.filter((r) => r.lifecycleStatus === 'paused'),
      cancelled: filteredRows.filter((r) => r.lifecycleStatus === 'cancelled'),
      duplicate: filteredRows.filter((r) => r.lifecycleStatus === 'duplicate'),
      withdrawn: withdrawnRows,
    }),
    [filteredRows, withdrawnRows],
  );
  const statusText = (r: TrackingRow): string => {
    const reason = formatStatusReason(r.tracking?.statusReason);
    const origin =
      r.lifecycleStatus === 'duplicate' && r.tracking?.duplicateOfCampaignName
        ? ` · Original: ${r.tracking.duplicateOfCampaignName}`
        : '';
    const when = r.tracking?.lifecycleUpdatedAt
      ? ` · ${formatDdMmYyyy(new Date(r.tracking.lifecycleUpdatedAt))}`
      : '';
    return `${reason || 'Sin motivo'}${origin}${when}`;
  };

  const operationalHealth = useMemo(() => {
    const measuredIds = new Set(view.active.map((row) => row.campaign.id));
    const alertIds = new Set(
      view.alerts.map(({ row }) => {
        measuredIds.add(row.campaign.id);
        return row.campaign.id;
      }),
    );
    const score = measuredIds.size
      ? Math.round(
          ((measuredIds.size - alertIds.size) / measuredIds.size) * 100,
        )
      : 100;

    if (view.overduePending.length > 0 || view.finishedPending.length > 0) {
      return {
        score,
        tone: 'danger' as const,
        label: 'Atención inmediata',
        detail: `${view.overduePending.length + view.finishedPending.length} campañas vencidas o terminadas con pendientes`,
      };
    }
    if (view.alerts.length > 0 || view.upcomingDue.length > 0) {
      return {
        score,
        tone: 'warning' as const,
        label: 'Revisión necesaria',
        detail: `${view.alerts.length} con alertas y ${view.upcomingDue.length} próximas a vencer`,
      };
    }
    return {
      score,
      tone: 'success' as const,
      label: 'Operación al día',
      detail:
        view.active.length > 0
          ? 'Sin alertas críticas ni vencimientos operativos'
          : 'Sin campañas activas con obligaciones pendientes',
    };
  }, [view]);

  // --- Carga operativa (ocupación) -----------------------------------------
  // Opciones de soporte/tienda: modelo del periodo sin filtros de tienda/soporte.
  const optionsModel = useMemo(
    () =>
      buildOccupancyDashboard({
        campaigns,
        screens,
        tracking,
        range,
        statuses,
      }),
    [campaigns, screens, tracking, range, statuses],
  );
  const supportOptions = useMemo(
    () =>
      [...optionsModel.supports]
        .map((s) => ({ key: s.supportKey, name: s.supportName }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [optionsModel],
  );
  const storeOptions = useMemo(
    () =>
      [...optionsModel.stores]
        .map((s) => ({ number: s.storeNumber, name: s.storeName }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [optionsModel],
  );

  const rowByKey = useMemo(() => {
    const m = new Map<string, TrackingRow>();
    for (const r of rows) m.set(r.campaign.nameKey, r);
    return m;
  }, [rows]);

  const [selection, setSelection] = useState<Selection | null>(null);
  const detail = useMemo(
    () => (selection ? selectionToDetail(selection) : null),
    [selection],
  );

  // --- Tarjetas KPI interactivas -------------------------------------------
  // Los contextos son SIEMPRE derivables del propio periodo (porcentajes,
  // desgloses de conteos ya calculados). No se comparan con periodos anteriores
  // porque el modelo no persiste histórico de estos indicadores.
  const urgentCount = view.overdueOrFinishedPending.length;
  const activeCount = view.active.length;
  const fullPct = activeCount
    ? Math.round((view.full.length / activeCount) * 100)
    : 0;
  const kpis: Kpi[] = [
    {
      id: 'active',
      icon: 'activity',
      label: 'Campañas activas',
      status: 'En ejecución',
      tone: 'info',
      rows: view.active,
      context: `${activeCount - view.withAlerts.length} sin alertas`,
    },
    {
      id: 'full',
      icon: 'check-circle',
      label: 'Seguimiento completo',
      status: 'Completas',
      tone: 'success',
      rows: view.full,
      context: `${fullPct}% de las activas`,
      meter: fullPct,
    },
    {
      id: 'ontrack',
      icon: 'clock',
      label: 'En curso sin atrasos',
      status: 'Al día',
      tone: 'success',
      rows: view.onTrack,
      context: 'Sin alertas ni vencidas',
    },
    {
      id: 'alerts',
      icon: 'alert-triangle',
      label: 'Con alertas',
      status: view.withAlerts.length > 0 ? 'Revisión' : 'Sin alertas',
      tone: view.withAlerts.length > 0 ? 'warning' : 'success',
      rows: view.withAlerts,
      context: `${view.upcomingDue.length} próximas a vencer`,
    },
    {
      id: 'overdue',
      icon: 'bell',
      label: 'Vencidas con pendientes',
      status: urgentCount > 0 ? 'Urgente' : 'Sin vencidas',
      tone: urgentCount > 0 ? 'danger' : 'success',
      rows: view.overdueOrFinishedPending,
      context: `${view.overduePending.length} vencidas · ${view.finishedPending.length} terminadas`,
    },
  ];
  const [kpiSelection, setKpiSelection] = useState<KpiId | null>(null);
  const selectedKpi = kpis.find((k) => k.id === kpiSelection) ?? null;
  const periodLabel = rangeLabel(range);

  // Anillo de salud del hero: circunferencia y desfase según la puntuación.
  const healthCirc = 2 * Math.PI * 52;
  const healthOffset = healthCirc * (1 - operationalHealth.score / 100);

  return (
    <div className="dashboard-content">
      <PageHeader
        title="Centro de Control Operativo"
        description="Campañas, incidencias y audiencias de todo el país, con el semáforo de seguimiento y la carga en una sola vista."
        actions={
          <div className="dashboard-refresh">
            {loadedAt && (
              <span className="dashboard-refresh__time">
                Actualizado {formatDdMmYyyy(loadedAt)}{' '}
                {String(loadedAt.getHours()).padStart(2, '0')}:
                {String(loadedAt.getMinutes()).padStart(2, '0')}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void load()}
              disabled={refreshing}
              aria-busy={refreshing}
            >
              {refreshing ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        }
      />

      {loading && !loadedOnce && (
        <LoadingOverlay
          variant="process"
          title="Construyendo el panel…"
          description="Cruzando campañas, seguimiento y pantallas."
        />
      )}

      {failed && (
        <div className="import__note" role="alert">
          No se pudo cargar el resumen operativo. Revisa tu conexión y vuelve a
          intentar.
        </div>
      )}

      {loadedOnce && (
        <>
          {canSeeRetailers && (
            <div className="dash-retailers" role="tablist" aria-label="Cliente">
              {RETAILERS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={retailer === r.id}
                  className={`dash-retailer dash-retailer--${r.id}${
                    retailer === r.id ? ' dash-retailer--active' : ''
                  }`}
                  onClick={() => setRetailer(r.id)}
                >
                  <span className="dash-retailer__dot" aria-hidden="true" />
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {retailer !== 'liverpool' ? (
            <RetailerPanel
              def={RETAILERS.find((r) => r.id === retailer)!}
              role={role}
              refreshKey={loadedAt?.getTime() ?? 0}
            />
          ) : (
            <>
              <OccupancyFilters
                values={filters}
                onChange={patchFilters}
                supportOptions={supportOptions}
                storeOptions={storeOptions}
              />

              <ControlCenterPanel
                occupancyStores={occupancy.stores}
                theme={theme}
                role={role}
                periodLabel={periodLabel}
                refreshKey={loadedAt?.getTime() ?? 0}
              />

              <div className="dashboard-section__head cc-section-head">
                <div>
                  <span className="dashboard-eyebrow">Seguimiento</span>
                  <h2>Semáforo operativo</h2>
                </div>
              </div>
              <section
                className="dash-summary"
                aria-label="Resumen de campañas activas"
              >
                {kpis.map((kpi) => (
                  <SummaryTile
                    key={kpi.id}
                    icon={kpi.icon}
                    label={kpi.label}
                    status={kpi.status}
                    tone={kpi.tone}
                    value={kpi.rows.length}
                    context={kpi.context}
                    meter={kpi.meter}
                    selected={kpiSelection === kpi.id}
                    onSelect={() =>
                      setKpiSelection((cur) => (cur === kpi.id ? null : kpi.id))
                    }
                  />
                ))}
              </section>

              {selectedKpi && (
                <KpiDetailPanel
                  title={selectedKpi.label}
                  periodLabel={periodLabel}
                  rows={selectedKpi.rows}
                  onClose={() => setKpiSelection(null)}
                />
              )}

              <div className="dashboard-hero">
                <section
                  className={`dashboard-panel dashboard-health dashboard-health--${operationalHealth.tone}`}
                  aria-label={`Estado operativo: ${operationalHealth.label}`}
                >
                  <div className="dashboard-health__ring" aria-hidden="true">
                    <svg viewBox="0 0 120 120" width="64" height="64">
                      <circle
                        className="dashboard-health__ring-bg"
                        cx="60"
                        cy="60"
                        r="52"
                      />
                      <circle
                        className="dashboard-health__ring-fill"
                        cx="60"
                        cy="60"
                        r="52"
                        strokeDasharray={healthCirc}
                        strokeDashoffset={healthOffset}
                      />
                    </svg>
                    <div className="dashboard-health__ring-label">
                      <span className="dashboard-health__score">
                        {operationalHealth.score}%
                      </span>
                      <span className="dashboard-health__score-cap">Salud</span>
                    </div>
                  </div>
                  <div className="dashboard-health__body">
                    <span className="dashboard-eyebrow">Estado operativo</span>
                    <h2>{operationalHealth.label}</h2>
                    <p>{operationalHealth.detail}</p>
                    <div className="dashboard-health__meta">
                      <div>
                        <b className="tabnum">{view.active.length}</b>
                        <span>activas</span>
                      </div>
                      <div>
                        <b className="tabnum is-warn">
                          {view.withAlerts.length}
                        </b>
                        <span>con alertas</span>
                      </div>
                      <div>
                        <b className="tabnum is-bad">
                          {view.overdueOrFinishedPending.length}
                        </b>
                        <span>vencidas / pend.</span>
                      </div>
                      <div>
                        <b className="tabnum">{view.full.length}</b>
                        <span>seguimiento completo</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className={`dashboard-panel dashboard-urgent${
                    view.immediateAttention.length === 0
                      ? ' dashboard-urgent--clear'
                      : ''
                  }`}
                  aria-labelledby="dashboard-urgent-title"
                >
                  <div className="dashboard-urgent__head">
                    <div>
                      <span className="dashboard-eyebrow">Prioridad</span>
                      <h2 id="dashboard-urgent-title">Atención inmediata</h2>
                    </div>
                    <span
                      className="dashboard-urgent__count"
                      aria-hidden={view.immediateAttention.length === 0}
                    >
                      {view.immediateAttention.length}
                    </span>
                  </div>
                  {view.immediateAttention.length === 0 ? (
                    <p className="dashboard-urgent__empty">
                      Sin campañas que requieran acción inmediata.
                    </p>
                  ) : (
                    <>
                      <ul className="dashboard-urgent__list">
                        {view.immediateAttention.slice(0, 5).map((r) => (
                          <li
                            key={r.campaign.id}
                            className="dashboard-urgent__item"
                          >
                            <Link to={trackingLink(r)}>{r.campaign.name}</Link>
                            <span className="dashboard-urgent__reason">
                              {immediateReason(r)}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {view.immediateAttention.length > 5 && (
                        <Link
                          className="dashboard-urgent__more"
                          to="/seguimiento"
                        >
                          Ver {view.immediateAttention.length - 5} más en
                          Seguimiento
                        </Link>
                      )}
                    </>
                  )}
                </section>
              </div>

              <section
                className="dashboard-panel dashboard-panel--chart"
                aria-labelledby="dashboard-load-title"
              >
                <div className="dashboard-panel__head">
                  <div>
                    <span className="dashboard-eyebrow">Liverpool</span>
                    <h2 id="dashboard-load-title">Carga diaria</h2>
                    <p>Campañas simultáneas · {rangeLabel(range)}</p>
                  </div>
                  <span className="dashboard-stat-pill">
                    Pico {occupancy.totals.peakConcurrentCampaigns}
                  </span>
                </div>

                {campaigns.length === 0 ? (
                  <div className="dashboard-chart-empty">
                    Importa el calendario para visualizar la carga diaria.
                  </div>
                ) : occupancy.totals.distinctCampaigns === 0 ? (
                  <div className="dashboard-chart-empty">
                    Sin campañas en el periodo o filtros seleccionados.
                  </div>
                ) : (
                  <DailyLoadChart series={occupancy.series} theme={theme} />
                )}
              </section>

              <section
                id="dashboard-attention"
                className="dashboard-section dashboard-attention"
                aria-labelledby="dashboard-attention-title"
              >
                <div className="dashboard-section__head">
                  <div>
                    <span className="dashboard-eyebrow">Prioridades</span>
                    <h2 id="dashboard-attention-title">Atención operativa</h2>
                  </div>
                  <Link className="dashboard-section__link" to="/seguimiento">
                    Ver seguimiento completo
                  </Link>
                </div>
                <div className="dash-grid">
                  <AlertList
                    title="Alertas críticas"
                    empty="Sin alertas críticas."
                    tone="danger"
                    items={view.alerts.map((a) => ({
                      row: a.row,
                      text: a.alerts.map((x) => x.label).join(' · '),
                    }))}
                  />
                  <AlertList
                    title="Próximos vencimientos"
                    empty="Nada por vencer pronto."
                    tone="warning"
                    items={view.upcomingDue.map((r) => ({
                      row: r,
                      text: `${STATUS_META[r.overall].label} · ${isoDay(r.nextDeadline)}`,
                    }))}
                  />
                  <AlertList
                    title="Próximos inicios (7 días)"
                    empty="Sin inicios próximos."
                    tone="info"
                    items={view.upcomingStarts.map((r) => {
                      const c = effectiveChecks(r);
                      const pend: string[] = [];
                      if (r.linkStatus !== 'valid') pend.push('link');
                      if (!c.liverpool) pend.push('validación');
                      if (!c.csm) pend.push('CSM');
                      return {
                        row: r,
                        text: `Inicia ${formatCivilString(r.campaign.fechaInicio)}${
                          pend.length ? ` · pendiente: ${pend.join(', ')}` : ''
                        }`,
                      };
                    })}
                  />
                  <AlertList
                    title="Terminadas con pendientes"
                    empty="Ninguna terminada con obligaciones pendientes."
                    tone="danger"
                    items={view.finishedPending.map((r) => ({
                      row: r,
                      text: criticalAlerts(r)
                        .map((x) => x.label)
                        .join(' · '),
                    }))}
                  />
                </div>
              </section>

              <section
                id="dashboard-statuses"
                className="dashboard-section"
                aria-labelledby="dashboard-statuses-title"
              >
                <div className="dashboard-section__head">
                  <div>
                    <span className="dashboard-eyebrow">
                      Fuera de operación
                    </span>
                    <h2 id="dashboard-statuses-title">Estados de campaña</h2>
                  </div>
                  <Link className="dashboard-section__link" to="/campanas">
                    Ver campañas
                  </Link>
                </div>
                <div className="dash-grid">
                  <AlertList
                    title="En pausa"
                    empty="Ninguna campaña en pausa."
                    tone="warning"
                    items={statusView.paused.map((r) => ({
                      row: r,
                      text: statusText(r),
                    }))}
                  />
                  <AlertList
                    title="Canceladas"
                    empty="Ninguna campaña cancelada."
                    tone="danger"
                    items={statusView.cancelled.map((r) => ({
                      row: r,
                      text: statusText(r),
                    }))}
                  />
                  <AlertList
                    title="Duplicadas"
                    empty="Ninguna campaña duplicada."
                    tone="info"
                    items={statusView.duplicate.map((r) => ({
                      row: r,
                      text: statusText(r),
                    }))}
                  />
                  <AlertList
                    title="Retiradas del calendario"
                    empty="Ninguna retirada del calendario."
                    tone="info"
                    linkTo={() => '/campanas'}
                    items={statusView.withdrawn.map((r) => ({
                      row: r,
                      text: `Vigencia ${formatCivilString(r.campaign.fechaInicio)} – ${formatCivilString(r.campaign.fechaFin)}`,
                    }))}
                  />
                </div>
              </section>

              <section
                id="dashboard-load"
                className="occ-section dashboard-section"
                aria-labelledby="dashboard-occupancy-title"
              >
                <div className="dashboard-section__head">
                  <div>
                    <span className="dashboard-eyebrow">Detalle de carga</span>
                    <h2 id="dashboard-occupancy-title">
                      Carga por tienda y soporte
                    </h2>
                  </div>
                </div>
                <p className="dashboard-section__description">
                  La carga se mide como{' '}
                  <strong>pico de campañas simultáneas</strong> en el periodo.
                  No representa capacidad ni saturación porque aún no existe una
                  capacidad máxima configurada por pantalla.
                </p>

                {campaigns.length === 0 ? (
                  <p className="occ-empty">
                    Aún no hay campañas. Importa el calendario para ver la
                    carga.
                  </p>
                ) : occupancy.totals.distinctCampaigns === 0 ? (
                  <p className="occ-empty">
                    El detalle de tiendas y soportes está vacío para la
                    selección actual.
                  </p>
                ) : (
                  <>
                    <section
                      className="dashboard-panel dashboard-classification"
                      aria-labelledby="dashboard-classification-title"
                    >
                      <div className="dashboard-panel__head dashboard-panel__head--compact">
                        <div>
                          <span className="dashboard-eyebrow">
                            Distribución
                          </span>
                          <h2 id="dashboard-classification-title">
                            Mezcla por clasificación
                          </h2>
                        </div>
                      </div>
                      <ClassificationDonut
                        breakdown={occupancy.classificationTotals}
                        theme={theme}
                      />
                    </section>

                    <div className="occ-cards">
                      <OccCard
                        label="Tienda con mayor carga"
                        value={occupancy.stores[0]?.storeName ?? '—'}
                        sub={
                          occupancy.stores[0]
                            ? `Pico ${occupancy.stores[0].peakConcurrentCampaigns} simultáneas`
                            : undefined
                        }
                      />
                      <OccCard
                        label="Soporte con mayor carga"
                        value={occupancy.supports[0]?.supportName ?? '—'}
                        sub={
                          occupancy.supports[0]
                            ? `Pico ${occupancy.supports[0].peakConcurrentCampaigns} simultáneas`
                            : undefined
                        }
                      />
                      <OccCard
                        label="Campañas activas en el periodo"
                        value={occupancy.totals.distinctCampaigns}
                        sub={`Pico global ${occupancy.totals.peakConcurrentCampaigns}`}
                      />
                      <OccCard
                        label="Tiendas utilizadas"
                        value={occupancy.totals.distinctStores}
                      />
                      <OccCard
                        label="Soportes utilizados"
                        value={occupancy.totals.distinctSupports}
                      />
                    </div>

                    <div className="occ-charts">
                      <SupportOccupancyChart
                        supports={occupancy.supports}
                        onSelect={(item) =>
                          setSelection({ kind: 'support', item })
                        }
                      />
                      <StoreOccupancyChart
                        stores={occupancy.stores}
                        onSelect={(item) =>
                          setSelection({ kind: 'store', item })
                        }
                      />
                    </div>

                    <h3 className="dashboard-matrix-title">
                      Matriz tienda × soporte
                    </h3>
                    <p className="dashboard-matrix-description">
                      El color indica intensidad relativa del pico dentro de la
                      vista, no capacidad ni saturación.
                    </p>
                    <StoreSupportMatrix
                      supports={occupancy.supports}
                      stores={occupancy.stores}
                      matrix={occupancy.matrix}
                      onSelect={(item) => setSelection({ kind: 'cell', item })}
                    />
                  </>
                )}
              </section>
            </>
          )}

          <section
            className="dashboard-panel dashboard-actions"
            aria-labelledby="dashboard-actions-title"
          >
            <div className="dashboard-panel__head dashboard-panel__head--compact">
              <div>
                <span className="dashboard-eyebrow">Atajos</span>
                <h2 id="dashboard-actions-title">Acciones rápidas</h2>
              </div>
            </div>
            <nav className="dashboard-actions__list">
              {quickActions.map((route) => (
                <Link key={route.path} to={route.path}>
                  <span className="dashboard-actions__icon">
                    <Icon name={route.icon} size={18} />
                  </span>
                  <span>{route.label}</span>
                  <Icon
                    className="dashboard-actions__chevron"
                    name="chevron-down"
                    size={16}
                  />
                </Link>
              ))}
            </nav>
          </section>
        </>
      )}

      {retailer === 'liverpool' && detail && (
        <OccupancyDetailPanel
          title={detail.title}
          subtitle={detail.subtitle}
          stats={detail.stats}
          campaigns={detail.campaigns}
          rowByKey={rowByKey}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  status,
  value,
  tone,
  context,
  meter,
  selected,
  onSelect,
}: {
  icon: IconName;
  label: string;
  status: string;
  value: number;
  tone: DashboardTone;
  context?: string;
  meter?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`dash-tile dash-tile--${tone}${
        selected ? ' dash-tile--selected' : ''
      }`}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. ${status}. Ver detalle`}
      onClick={onSelect}
    >
      <div className="dash-tile__top">
        <span className="dash-tile__icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <span className="dash-tile__status">
          <span className="dash-tile__status-dot" aria-hidden="true" />
          {status}
        </span>
      </div>
      <div>
        <div className="dash-tile__value">{value}</div>
        <div className="dash-tile__label">{label}</div>
        {context && (
          <div className="dash-tile__context">
            <span>{context}</span>
            {typeof meter === 'number' && (
              <span
                className="dash-tile__meter"
                aria-hidden="true"
                data-empty={meter === 0 ? '' : undefined}
              >
                <i style={{ width: `${Math.max(meter, 2)}%` }} />
              </span>
            )}
          </div>
        )}
      </div>
      <span className="dash-tile__action">
        {selected ? 'Ocultar detalle' : 'Ver detalle'}
        <Icon name="chevron-down" size={14} />
      </span>
    </button>
  );
}

function OccCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="occ-card">
      <div className="occ-card__label">{label}</div>
      <div className="occ-card__value">{value}</div>
      {sub && <div className="occ-card__sub">{sub}</div>}
    </div>
  );
}

/** Contenido del selector de retailer para cualquier cliente que no sea
 * Liverpool: el panel de Operación Digital filtrado a uno solo, o el estado
 * vacío explícito cuando el retailer aún no tiene perfil en el Catálogo
 * digital (Soriana, San Pablo). */
function RetailerPanel({
  def,
  role,
  refreshKey,
}: {
  def: RetailerDef;
  role: UserRole;
  refreshKey: number;
}) {
  if (def.kind === 'digital') {
    return (
      <DigitalDashboardPanel
        retailerLabel={def.retailerLabel!}
        displayName={def.label}
        refreshKey={refreshKey}
      />
    );
  }
  return (
    <section
      className="dashboard-section digital-empty"
      aria-label={`Sin datos de ${def.label}`}
    >
      <p className="digital-empty__text">
        Sin colocaciones registradas para {def.label} todavía.
      </p>
      {can(role, 'digitalCatalog.manage') && (
        <Link className="digital-empty__link" to="/catalogo-digital">
          Ir a Catálogo digital para darlo de alta →
        </Link>
      )}
    </section>
  );
}

function AlertList({
  title,
  empty,
  items,
  tone,
  linkTo = trackingLink,
}: {
  title: string;
  empty: string;
  items: { row: TrackingRow; text: string }[];
  tone: Extract<DashboardTone, 'info' | 'warning' | 'danger'>;
  linkTo?: (row: TrackingRow) => string;
}) {
  return (
    <section className={`card dash-list dash-list--${tone}`} aria-label={title}>
      <div className="dash-list__head">
        <span className="dash-list__indicator" aria-hidden="true" />
        <h3 className="dash-list__title">{title}</h3>
        <span className="dash-list__count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="dash-list__empty">{empty}</p>
      ) : (
        <ul className="dash-list__items">
          {items.slice(0, 12).map((it) => (
            <li key={it.row.campaign.id}>
              <Link to={linkTo(it.row)}>{it.row.campaign.name}</Link>
              <span className="text-muted"> — {it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
