import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '@/components/Icon';
import type { Theme } from '@/app/theme';
import type { UserRole } from '@/domain';
import { canAccessRoute, routeByPath } from '@/app/routes';
import type { StoreDirectoryEntry } from '@/domain/stores';
import { listStoreDirectory } from '@/services/storeDirectory';
import {
  getControlCenterSnapshot,
  type ControlCenterSnapshot,
} from '@/services/controlCenter';
import type { StoreOccupancy } from '../occupancyModel';
import {
  INCIDENT_KINDS,
  INCIDENT_LABEL,
  buildControlCenterModel,
  type IncidentKind,
  type MapIncident,
  type MapStore,
  type Severity,
  type StateAggregate,
} from './mapModel';
import {
  storeCampaigns,
  type CampaignFilter,
  type IncidentFilter,
  type MapLayer,
  type MapView,
} from './mapOption';
import { controlPalette } from './palette';
import { ControlCenterMap } from './ControlCenterMap';
import { GlassDialog } from './GlassDialog';
import './ControlCenter.css';

const fmt = (n: number) => new Intl.NumberFormat('es-MX').format(Math.round(n));
const fmtK = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1)} M`
    : n >= 1e4
      ? `${(n / 1e3).toFixed(1)} k`
      : fmt(n);

const LAYERS: { id: MapLayer; label: string; icon: IconName }[] = [
  { id: 'campaigns', label: 'Campañas', icon: 'radio' },
  { id: 'incidents', label: 'Incidencias', icon: 'alert-triangle' },
  { id: 'audience', label: 'Audiencias', icon: 'users' },
];

const INCIDENT_ICON: Record<IncidentKind, IconName> = {
  support: 'wrench',
  content: 'image',
  camera: 'camera-off',
  other: 'help',
};
const INCIDENT_TONE: Record<
  IncidentKind,
  'danger' | 'warning' | 'violet' | 'info'
> = {
  support: 'danger',
  content: 'warning',
  camera: 'violet',
  other: 'info',
};
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
};

type Dialog =
  | { kind: 'store'; storeNumber: string }
  | { kind: 'state'; state: string }
  | { kind: 'incidents'; filter: IncidentFilter }
  | { kind: 'campaigns' }
  | { kind: 'audience' }
  | { kind: 'cameras' };

function ageLabel(hours: number): string {
  return hours >= 48 ? `${Math.round(hours / 24)} d` : `${hours} h`;
}

function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className={`cc-tag cc-tag--${severity}`}>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

function IncidentTable({
  incidents,
  storeName,
  onStore,
}: {
  incidents: readonly MapIncident[];
  storeName?: (n: string) => string;
  onStore?: (n: string) => void;
}) {
  if (incidents.length === 0)
    return <p className="cc-muted">Sin incidencias abiertas.</p>;
  return (
    <div className="cc-table-wrap">
      <table className="cc-table">
        <thead>
          <tr>
            <th>Tipo</th>
            {storeName && <th>Tienda</th>}
            <th>Detalle</th>
            <th className="cc-num">Abierta</th>
            <th>Etapa</th>
            <th>Severidad</th>
          </tr>
        </thead>
        <tbody>
          {incidents.map((i) => (
            <tr key={i.id}>
              <td>
                <span className={`cc-tag cc-tag--${i.kind}`}>
                  {INCIDENT_LABEL[i.kind]}
                </span>
              </td>
              {storeName && (
                <td>
                  <button
                    type="button"
                    className="cc-link"
                    onClick={() => onStore?.(i.storeNumber)}
                  >
                    {storeName(i.storeNumber)} · {i.storeNumber}
                  </button>
                </td>
              )}
              <td>
                {i.url ? (
                  <a href={i.url} target="_blank" rel="noopener noreferrer">
                    {i.title}
                  </a>
                ) : (
                  i.title
                )}
                {i.detail && <span className="cc-muted"> · {i.detail}</span>}
              </td>
              <td className="cc-num">{ageLabel(i.ageHours)}</td>
              <td>
                {i.ticketId ? `#${i.ticketId} · ` : ''}
                {i.stage}
              </td>
              <td>
                <SeverityTag severity={i.severity} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoreTable({
  stores,
  onStore,
}: {
  stores: readonly MapStore[];
  onStore: (n: string) => void;
}) {
  return (
    <div className="cc-table-wrap">
      <table className="cc-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Tienda</th>
            <th>Estado</th>
            <th className="cc-num cc-brand">Marcas</th>
            <th className="cc-num cc-liverpool">Liverpool</th>
            <th className="cc-num">Incid.</th>
            <th className="cc-num">OTS</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.storeNumber}>
              <td className="cc-num">{s.storeNumber}</td>
              <td>
                <button
                  type="button"
                  className="cc-link"
                  onClick={() => onStore(s.storeNumber)}
                >
                  {s.name}
                </button>
              </td>
              <td>{s.state ?? '—'}</td>
              <td className="cc-num">{s.campaigns.provider}</td>
              <td className="cc-num">{s.campaigns.institutional}</td>
              <td className="cc-num">{s.incidents.length}</td>
              <td className="cc-num">{s.ots === null ? '—' : fmt(s.ots)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Centro de Control: mapa de México con campañas (marcas vs. Liverpool),
 * incidencias operativas (Odoo + salud de cámaras) y audiencias Quividi, con
 * indicadores, rankings, navegador de tickets y ventanas flotantes.
 */
export function ControlCenterPanel({
  occupancyStores,
  supportedStores,
  theme,
  role,
  todayLabel,
  refreshKey,
}: {
  /** Ocupación de **hoy** (campañas vigentes a la fecha de consulta). */
  occupancyStores: readonly StoreOccupancy[];
  /** Tiendas con soportes activos en catálogo: el universo del mapa. */
  supportedStores: ReadonlySet<string>;
  theme: Theme;
  /** Rol del usuario: oculta accesos a módulos que su rol no puede abrir. */
  role: UserRole;
  /** Fecha de consulta `dd/mm/aaaa`. */
  todayLabel: string;
  refreshKey: number;
}) {
  const canOpen = (path: string) => {
    const route = routeByPath(path);
    return route !== undefined && canAccessRoute(role, route);
  };
  const [directory, setDirectory] = useState<StoreDirectoryEntry[]>([]);
  const [snapshot, setSnapshot] = useState<ControlCenterSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.allSettled([
      listStoreDirectory(),
      getControlCenterSnapshot(),
    ]).then(([dir, snap]) => {
      if (cancelled) return;
      const errs: string[] = [];
      if (dir.status === 'fulfilled') setDirectory(dir.value);
      else errs.push('No se pudo leer el directorio de tiendas.');
      if (snap.status === 'fulfilled') setSnapshot(snap.value);
      else
        errs.push(
          'No se pudieron leer incidencias ni audiencias. Se muestran solo las campañas.',
        );
      setErrors(errs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const model = useMemo(
    () =>
      buildControlCenterModel({
        directory,
        supportedStores,
        occupancy: occupancyStores,
        tickets: snapshot?.tickets ?? null,
        cameras: snapshot?.cameras ?? null,
        now: new Date(),
      }),
    [directory, supportedStores, occupancyStores, snapshot],
  );
  const palette = controlPalette(theme);

  const [layer, setLayer] = useState<MapLayer>('campaigns');
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>('all');
  const [incidentFilter, setIncidentFilter] = useState<IncidentFilter>('all');
  const [navIdx, setNavIdx] = useState(0);
  const [zoom, setZoom] = useState<{
    key: number;
    target: 'nation' | 'valle' | [number, number];
  }>({ key: 0, target: 'nation' });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const closeDialog = useCallback(() => setDialog(null), []);

  const byNumber = useMemo(
    () => new Map(model.stores.map((s) => [s.storeNumber, s])),
    [model.stores],
  );
  const nameOf = (n: string) => byNumber.get(n)?.name ?? `Tienda ${n}`;

  const navList = useMemo(
    () =>
      incidentFilter === 'all'
        ? model.incidents
        : model.incidents.filter((i) => i.kind === incidentFilter),
    [model.incidents, incidentFilter],
  );
  const navCurrent =
    navList.length > 0
      ? navList[((navIdx % navList.length) + navList.length) % navList.length]
      : null;
  const view: MapView = {
    layer,
    campaignFilter,
    incidentFilter,
    focusStore:
      layer === 'incidents' ? (navCurrent?.storeNumber ?? null) : null,
  };
  const goNav = (delta: number) => {
    const next = navIdx + delta;
    setNavIdx(next);
    const target =
      navList[((next % navList.length) + navList.length) % navList.length];
    const coord = target ? byNumber.get(target.storeNumber)?.coord : null;
    if (coord) setZoom((z) => ({ key: z.key + 1, target: coord }));
  };

  // --- Totales de los indicadores ------------------------------------------
  const active = model.stores.filter((s) => s.active);
  const totals = {
    // Campañas distintas al aire hoy: una campaña cuenta una vez, sin importar
    // a cuántas tiendas o soportes se distribuye.
    brand: model.campaignTotals.provider,
    liverpool: model.campaignTotals.institutional,
    campaigns: model.campaignTotals.total,
    incidents: model.incidents.length,
    critical: model.incidents.filter((i) => i.severity === 'critical').length,
    withTickets: model.incidents.filter((i) => i.source === 'odoo').length,
    ots: active.reduce((a, s) => a + (s.ots ?? 0), 0),
    measured: active.filter((s) => s.ots !== null).length,
    cameras: active.reduce((a, s) => a + s.cameras.total, 0),
    camerasAlerting: active.reduce((a, s) => a + s.cameras.alerting, 0),
    located: active.filter((s) => s.coord !== null).length,
  };
  const odooDown = snapshot !== null && snapshot.tickets === null;
  const camerasDown = snapshot !== null && snapshot.cameras === null;

  // --- Ranking de estados según la capa -------------------------------------
  const metric = (s: StateAggregate): number =>
    layer === 'campaigns'
      ? campaignFilter === 'brand'
        ? s.provider
        : campaignFilter === 'liverpool'
          ? s.institutional
          : s.campaigns
      : layer === 'incidents'
        ? incidentFilter === 'all'
          ? s.incidentTotal
          : s.incidents[incidentFilter]
        : s.ots;
  const ranking = [...model.states]
    .sort((a, b) => metric(b) - metric(a))
    .slice(0, 7);
  const rankMax = Math.max(1, ...ranking.map(metric));

  // --- Panel lateral del mapa ------------------------------------------------
  const topStore = [...active]
    .filter((s) =>
      layer === 'campaigns'
        ? storeCampaigns(s, campaignFilter) > 0
        : layer === 'audience'
          ? (s.ots ?? 0) > 0
          : false,
    )
    .sort((a, b) =>
      layer === 'campaigns'
        ? storeCampaigns(b, campaignFilter) - storeCampaigns(a, campaignFilter)
        : (b.ots ?? 0) - (a.ots ?? 0),
    )[0];

  const kpis: {
    id: Dialog['kind'];
    icon: IconName;
    tone: string;
    label: string;
    value: string;
    suffix?: string;
    foot: React.ReactNode;
    bar?: { pct: number; tone: string };
    split?: boolean;
  }[] = [
    {
      id: 'campaigns',
      icon: 'radio',
      tone: 'info',
      label: 'Campañas al aire',
      value: fmt(totals.campaigns),
      foot: (
        <span className="cc-kv">
          <span>
            <i className="cc-dot cc-dot--brand" /> Marcas {fmt(totals.brand)}
          </span>
          <span>
            <i className="cc-dot cc-dot--liverpool" /> Liverpool{' '}
            {fmt(totals.liverpool)}
          </span>
        </span>
      ),
      split: true,
    },
    {
      id: 'incidents',
      icon: 'alert-triangle',
      tone: 'danger',
      label: 'Incidencias abiertas',
      value: odooDown && camerasDown ? '—' : fmt(totals.incidents),
      foot: odooDown
        ? 'Odoo no respondió; solo cámaras'
        : `${totals.critical} críticas · ${totals.withTickets} tickets Odoo`,
    },
    {
      id: 'audience',
      icon: 'users',
      tone: 'success',
      label: 'Audiencia OTS',
      value: camerasDown ? '—' : fmtK(totals.ots),
      foot: snapshot?.camerasLatestDate
        ? `Último día medido ${snapshot.camerasLatestDate.split('-').reverse().join('/')} · ${totals.measured} tiendas`
        : `${totals.measured} tiendas con cámara`,
    },
    {
      id: 'cameras',
      icon: 'camera',
      tone: 'violet',
      label: 'Cámaras midiendo',
      value: camerasDown ? '—' : fmt(totals.cameras - totals.camerasAlerting),
      suffix: camerasDown ? undefined : `/ ${fmt(totals.cameras)}`,
      bar: totals.cameras
        ? {
            pct: (totals.cameras - totals.camerasAlerting) / totals.cameras,
            tone: 'violet',
          }
        : undefined,
      foot: `${totals.camerasAlerting} con alerta en Quividi`,
    },
  ];

  const dialogStore =
    dialog?.kind === 'store' ? byNumber.get(dialog.storeNumber) : undefined;
  const dialogState =
    dialog?.kind === 'state'
      ? model.states.find((s) => s.state === dialog.state)
      : undefined;

  return (
    <section className="cc" aria-label="Centro de Control">
      <div className="cc-grid">
        <aside className="cc-rail" aria-label="Indicadores">
          {kpis.map((k) => (
            <button
              key={k.id}
              type="button"
              className="cc-kpi cc-glass"
              onClick={() =>
                setDialog(
                  k.id === 'incidents'
                    ? { kind: 'incidents', filter: 'all' }
                    : ({ kind: k.id } as Dialog),
                )
              }
            >
              <span className={`cc-icon cc-icon--${k.tone}`} aria-hidden="true">
                <Icon name={k.icon} size={20} />
              </span>
              <span className="cc-kpi__label">{k.label}</span>
              <span className="cc-kpi__value">
                {k.value}
                {k.suffix && <small>{k.suffix}</small>}
              </span>
              {k.split && (
                <span className="cc-split" aria-hidden="true">
                  <i
                    className="cc-split__brand"
                    style={{ flexGrow: totals.brand || 0.0001 }}
                  />
                  <i
                    className="cc-split__liverpool"
                    style={{ flexGrow: totals.liverpool || 0.0001 }}
                  />
                </span>
              )}
              {k.bar && (
                <span className="cc-bar" aria-hidden="true">
                  <i
                    className={`cc-bar__fill cc-bar__fill--${k.bar.tone}`}
                    style={{ width: `${(k.bar.pct * 100).toFixed(1)}%` }}
                  />
                </span>
              )}
              <span className="cc-kpi__foot">{k.foot}</span>
            </button>
          ))}
        </aside>

        <div className="cc-map cc-glass">
          <div className="cc-map__head">
            <div>
              <span className="dashboard-eyebrow">
                Capa · {LAYERS.find((l) => l.id === layer)?.label} · Hoy{' '}
                {todayLabel}
              </span>
              <h2 className="cc-map__title">
                {layer === 'campaigns'
                  ? campaignFilter === 'brand'
                    ? 'Campañas de marca por estado'
                    : campaignFilter === 'liverpool'
                      ? 'Campañas Liverpool institucional por estado'
                      : 'Campañas al aire por estado'
                  : layer === 'incidents'
                    ? incidentFilter === 'all'
                      ? 'Incidencias operativas por estado'
                      : `${INCIDENT_LABEL[incidentFilter]} por estado`
                    : 'Audiencia OTS por estado'}
              </h2>
            </div>
            <div className="cc-seg" role="group" aria-label="Capa del mapa">
              {LAYERS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={layer === l.id}
                  className={`cc-seg__btn cc-seg__btn--${l.id}`}
                  onClick={() => {
                    setLayer(l.id);
                    setNavIdx(0);
                  }}
                >
                  <Icon name={l.icon} size={15} />
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="cc-map__chips"
            role="group"
            aria-label="Detalle de la capa"
          >
            {layer === 'campaigns' &&
              (
                [
                  ['all', 'Todas', null, totals.campaigns],
                  ['brand', 'Marcas', 'brand', totals.brand],
                  [
                    'liverpool',
                    'Liverpool institucional',
                    'liverpool',
                    totals.liverpool,
                  ],
                ] as const
              ).map(([id, label, dot, n]) => (
                <button
                  key={id}
                  type="button"
                  className="cc-chip"
                  aria-pressed={campaignFilter === id}
                  onClick={() => setCampaignFilter(id)}
                >
                  {dot && <i className={`cc-dot cc-dot--${dot}`} />}
                  {label} <span className="cc-chip__n">{fmt(n)}</span>
                </button>
              ))}
            {layer === 'incidents' &&
              (['all', ...INCIDENT_KINDS] as IncidentFilter[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className="cc-chip"
                  aria-pressed={incidentFilter === id}
                  onClick={() => {
                    setIncidentFilter(id);
                    setNavIdx(0);
                  }}
                >
                  {id !== 'all' && <i className={`cc-dot cc-dot--${id}`} />}
                  {id === 'all' ? 'Todas' : INCIDENT_LABEL[id]}{' '}
                  <span className="cc-chip__n">
                    {id === 'all'
                      ? model.incidents.length
                      : model.incidents.filter((i) => i.kind === id).length}
                  </span>
                </button>
              ))}
            {layer === 'audience' && (
              <span className="cc-muted">
                Tamaño = OTS del último día medido · Fuente: Quividi
              </span>
            )}
            <span className="cc-map__tools">
              <button
                type="button"
                className="cc-tool"
                onClick={() =>
                  setZoom((z) => ({ key: z.key + 1, target: 'valle' }))
                }
              >
                <Icon name="zoom-in" size={14} /> Valle de México
              </button>
              <button
                type="button"
                className="cc-tool"
                onClick={() =>
                  setZoom((z) => ({ key: z.key + 1, target: 'nation' }))
                }
              >
                <Icon name="rotate-ccw" size={14} /> País
              </button>
            </span>
          </div>

          <div className="cc-map__stage">
            <ControlCenterMap
              model={model}
              view={view}
              palette={palette}
              zoomTarget={zoom}
              onStoreClick={(n) => setDialog({ kind: 'store', storeNumber: n })}
              onStateClick={(st) => setDialog({ kind: 'state', state: st })}
            />

            <div className="cc-legend cc-glass" aria-label="Leyenda">
              {layer === 'campaigns' && (
                <>
                  <span>
                    <i className="cc-dot cc-dot--brand" /> Marcas
                  </span>
                  <span>
                    <i className="cc-dot cc-dot--liverpool" /> Liverpool
                    institucional
                  </span>
                  <span className="cc-muted">Tamaño = campañas</span>
                </>
              )}
              {layer === 'incidents' &&
                (incidentFilter === 'all' ? (
                  <>
                    <span>
                      <i className="cc-dot cc-dot--critical" /> Crítica
                    </span>
                    <span>
                      <i className="cc-dot cc-dot--high" /> Alta
                    </span>
                    <span>
                      <i className="cc-dot cc-dot--medium" /> Media
                    </span>
                    <span>
                      <i className="cc-dot cc-dot--ok" /> Operando
                    </span>
                  </>
                ) : (
                  <span>
                    <i className={`cc-dot cc-dot--${incidentFilter}`} />{' '}
                    {INCIDENT_LABEL[incidentFilter]}
                  </span>
                ))}
              {layer === 'audience' && (
                <>
                  <span>
                    <i className="cc-dot cc-dot--audience" /> OTS
                  </span>
                  <span>
                    <i className="cc-dot cc-dot--hollow" /> Sin cámara
                  </span>
                </>
              )}
              {model.withoutCoordinates > 0 && (
                <span className="cc-muted">
                  {model.withoutCoordinates} tiendas sin coordenadas cuentan
                  solo en su estado
                </span>
              )}
            </div>

            {layer === 'incidents' ? (
              <div
                className="cc-side cc-glass"
                aria-label="Navegador de tickets"
              >
                {navCurrent ? (
                  <>
                    <div className="cc-side__head">
                      <span className="dashboard-eyebrow">
                        Incidencia{' '}
                        {(((navIdx % navList.length) + navList.length) %
                          navList.length) +
                          1}{' '}
                        de {navList.length}
                      </span>
                      <span className="cc-side__nav">
                        <button
                          type="button"
                          className="cc-tool"
                          aria-label="Incidencia anterior"
                          onClick={() => goNav(-1)}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="cc-tool"
                          aria-label="Incidencia siguiente"
                          onClick={() => goNav(1)}
                        >
                          ›
                        </button>
                      </span>
                    </div>
                    <span className="cc-side__tags">
                      <span className={`cc-tag cc-tag--${navCurrent.kind}`}>
                        {INCIDENT_LABEL[navCurrent.kind]}
                      </span>
                      <SeverityTag severity={navCurrent.severity} />
                    </span>
                    <strong className="cc-side__title">
                      {navCurrent.title}
                    </strong>
                    <button
                      type="button"
                      className="cc-link"
                      onClick={() =>
                        setDialog({
                          kind: 'store',
                          storeNumber: navCurrent.storeNumber,
                        })
                      }
                    >
                      {nameOf(navCurrent.storeNumber)} · #
                      {navCurrent.storeNumber}
                    </button>
                    <span className="cc-side__row">
                      <span>{navCurrent.detail}</span>
                      <span>hace {ageLabel(navCurrent.ageHours)}</span>
                    </span>
                    <span className="cc-side__row">
                      <span>
                        {navCurrent.source === 'odoo'
                          ? `Odoo #${navCurrent.ticketId}`
                          : 'Quividi'}
                      </span>
                      <span>{navCurrent.stage}</span>
                    </span>
                    <span className="cc-side__actions">
                      {navCurrent.url && (
                        <a
                          className="btn btn-secondary"
                          href={navCurrent.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Abrir en Odoo
                        </a>
                      )}
                      {navCurrent.source === 'quividi' &&
                        canOpen('/salud-camaras') && (
                          <Link
                            className="btn btn-secondary"
                            to="/salud-camaras"
                          >
                            Salud de cámaras
                          </Link>
                        )}
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          setDialog({
                            kind: 'incidents',
                            filter: incidentFilter,
                          })
                        }
                      >
                        Ver lista
                      </button>
                    </span>
                  </>
                ) : (
                  <p className="cc-muted">
                    {odooDown
                      ? 'Odoo no respondió; no hay tickets que recorrer.'
                      : 'Sin incidencias abiertas con este filtro.'}
                  </p>
                )}
              </div>
            ) : (
              <div className="cc-side cc-glass">
                <span className="dashboard-eyebrow">
                  {layer === 'campaigns' ? 'Mayor emisión' : 'Mayor audiencia'}
                </span>
                {topStore ? (
                  <>
                    <button
                      type="button"
                      className="cc-link cc-side__title"
                      onClick={() =>
                        setDialog({
                          kind: 'store',
                          storeNumber: topStore.storeNumber,
                        })
                      }
                    >
                      {topStore.name} · #{topStore.storeNumber}
                    </button>
                    <span className="cc-side__row">
                      <span>{topStore.state ?? '—'}</span>
                      <b>
                        {layer === 'campaigns'
                          ? storeCampaigns(topStore, campaignFilter)
                          : fmtK(topStore.ots ?? 0)}
                      </b>
                    </span>
                  </>
                ) : (
                  <p className="cc-muted">Sin datos al día de hoy.</p>
                )}
                <span className="cc-side__row">
                  <span>Tiendas en el mapa</span>
                  <b>
                    {totals.located}/{active.length}
                  </b>
                </span>
              </div>
            )}
          </div>
        </div>

        <aside className="cc-rail" aria-label="Rankings">
          <section
            className="cc-panel cc-glass"
            aria-labelledby="cc-rank-title"
          >
            <h3 id="cc-rank-title">
              Estados con más{' '}
              {layer === 'campaigns'
                ? 'campañas'
                : layer === 'incidents'
                  ? 'incidencias'
                  : 'audiencia'}
            </h3>
            {ranking.length === 0 ? (
              <p className="cc-muted">
                Sin estados con tiendas en el directorio.
              </p>
            ) : (
              <ol className="cc-rank">
                {ranking.map((s, i) => (
                  <li key={s.state}>
                    <button
                      type="button"
                      onClick={() =>
                        setDialog({ kind: 'state', state: s.state })
                      }
                    >
                      <span className="cc-rank__pos">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="cc-rank__name">
                        {s.state}
                        <span className="cc-muted"> · {s.stores} tiendas</span>
                      </span>
                      <b>
                        {layer === 'audience'
                          ? fmtK(metric(s))
                          : fmt(metric(s))}
                      </b>
                      <span className="cc-rank__track" aria-hidden="true">
                        {layer === 'campaigns' && campaignFilter === 'all' ? (
                          <>
                            <i
                              className="cc-split__brand"
                              style={{
                                width: `${(s.provider / rankMax) * 100}%`,
                              }}
                            />
                            <i
                              className="cc-split__liverpool"
                              style={{
                                width: `${(s.institutional / rankMax) * 100}%`,
                              }}
                            />
                          </>
                        ) : (
                          <i
                            className={`cc-rank__fill cc-rank__fill--${layer}`}
                            style={{ width: `${(metric(s) / rankMax) * 100}%` }}
                          />
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section
            className="cc-panel cc-glass"
            aria-labelledby="cc-types-title"
          >
            <h3 id="cc-types-title">Incidencias operativas</h3>
            <div className="cc-types">
              {INCIDENT_KINDS.filter(
                (k) =>
                  k !== 'other' ||
                  model.incidents.some((i) => i.kind === 'other'),
              ).map((k) => {
                const list = model.incidents.filter((i) => i.kind === k);
                const stores = new Set(list.map((i) => i.storeNumber)).size;
                return (
                  <button
                    key={k}
                    type="button"
                    className="cc-type"
                    onClick={() => setDialog({ kind: 'incidents', filter: k })}
                  >
                    <span
                      className={`cc-icon cc-icon--${INCIDENT_TONE[k]}`}
                      aria-hidden="true"
                    >
                      <Icon name={INCIDENT_ICON[k]} size={18} />
                    </span>
                    <span>
                      <span className="cc-type__name">{INCIDENT_LABEL[k]}</span>
                      <span className="cc-muted">
                        {stores} {stores === 1 ? 'tienda' : 'tiendas'}
                        {k === 'camera' ? ' · Odoo + Quividi' : ' · Odoo'}
                      </span>
                    </span>
                    <b className={`cc-type__n cc-type__n--${k}`}>
                      {list.length}
                    </b>
                  </button>
                );
              })}
            </div>
          </section>

          {(loading ||
            errors.length > 0 ||
            (snapshot?.warnings.length ?? 0) > 0 ||
            directory.length === 0 ||
            model.unlocated.length > 0 ||
            model.unsupported.length > 0) && (
            <section
              className="cc-panel cc-glass cc-notes"
              aria-label="Avisos del mapa"
            >
              {loading && (
                <p className="cc-muted">Cargando ubicaciones e incidencias…</p>
              )}
              {!loading && directory.length === 0 && (
                <p>
                  El directorio de tiendas está vacío: el mapa no puede ubicar
                  tiendas.{' '}
                  {canOpen('/tiendas') && (
                    <Link to="/tiendas">Ir a Directorio de tiendas</Link>
                  )}
                </p>
              )}
              {[...errors, ...(snapshot?.warnings ?? [])].map((w) => (
                <p key={w}>{w}</p>
              ))}
              {model.unlocated.length > 0 && (
                <p>
                  {model.unlocated.length} tiendas con datos no están en el
                  directorio: {model.unlocated.slice(0, 8).join(', ')}
                  {model.unlocated.length > 8 ? '…' : ''}
                </p>
              )}
              {model.unsupported.length > 0 && (
                <p>
                  {model.unsupported.length} tiendas con datos no tienen
                  soportes activos en el catálogo y quedan fuera del mapa:{' '}
                  {model.unsupported.slice(0, 8).join(', ')}
                  {model.unsupported.length > 8 ? '…' : ''}
                </p>
              )}
            </section>
          )}
        </aside>
      </div>

      {dialog?.kind === 'store' && (
        <GlassDialog
          icon="map-pin"
          tone={dialogStore?.incidents.length ? 'danger' : 'info'}
          title={
            dialogStore
              ? `${dialogStore.name} · Tienda ${dialogStore.storeNumber}`
              : `Tienda ${dialog.storeNumber}`
          }
          subtitle={
            dialogStore
              ? [
                  dialogStore.municipality,
                  dialogStore.state,
                  dialogStore.zone ? `Zona ${dialogStore.zone}` : '',
                  dialogStore.coord ? '' : 'Sin coordenadas',
                  dialogStore.active ? '' : 'Inactiva',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'No está en el directorio de tiendas'
          }
          onClose={closeDialog}
        >
          {dialogStore && (
            <>
              <div className="cc-mini">
                <div>
                  <span>Campañas de marca</span>
                  <b className="cc-brand">{dialogStore.campaigns.provider}</b>
                </div>
                <div>
                  <span>Liverpool institucional</span>
                  <b className="cc-liverpool">
                    {dialogStore.campaigns.institutional}
                  </b>
                </div>
                <div>
                  <span>Pantallas con campaña</span>
                  <b>{dialogStore.screens}</b>
                </div>
                <div>
                  <span>OTS último día</span>
                  <b>{dialogStore.ots === null ? '—' : fmt(dialogStore.ots)}</b>
                </div>
                <div>
                  <span>Cámaras en alerta</span>
                  <b>
                    {dialogStore.cameras.alerting}/{dialogStore.cameras.total}
                  </b>
                </div>
              </div>
              <h3 className="cc-dialog__h">Incidencias operativas</h3>
              <IncidentTable incidents={dialogStore.incidents} />
              <div className="cc-dialog__actions">
                <Link
                  className="btn btn-secondary"
                  to={`/?tienda=${encodeURIComponent(dialogStore.storeNumber)}`}
                  onClick={closeDialog}
                >
                  Filtrar el panel por esta tienda
                </Link>
                {canOpen('/tiendas') && (
                  <Link
                    className="btn btn-primary"
                    to="/tiendas"
                    onClick={closeDialog}
                  >
                    Ver en Directorio
                  </Link>
                )}
              </div>
            </>
          )}
        </GlassDialog>
      )}

      {dialog?.kind === 'state' && (
        <GlassDialog
          icon="map-pin"
          title={dialog.state}
          subtitle={
            dialogState
              ? `${dialogState.stores} tiendas Liverpool`
              : 'Sin tiendas Liverpool'
          }
          onClose={closeDialog}
        >
          {dialogState && (
            <>
              <div className="cc-mini">
                <div>
                  <span>Marcas</span>
                  <b className="cc-brand">{dialogState.provider}</b>
                </div>
                <div>
                  <span>Liverpool</span>
                  <b className="cc-liverpool">{dialogState.institutional}</b>
                </div>
                <div>
                  <span>Incidencias</span>
                  <b>{dialogState.incidentTotal}</b>
                </div>
                <div>
                  <span>OTS último día</span>
                  <b>{fmt(dialogState.ots)}</b>
                </div>
              </div>
              <StoreTable
                stores={model.stores
                  .filter((s) => s.state === dialog.state)
                  .sort(
                    (a, b) =>
                      b.incidents.length - a.incidents.length ||
                      b.totalCampaigns - a.totalCampaigns,
                  )}
                onStore={(n) => setDialog({ kind: 'store', storeNumber: n })}
              />
            </>
          )}
        </GlassDialog>
      )}

      {dialog?.kind === 'incidents' && (
        <GlassDialog
          icon={
            dialog.filter === 'all'
              ? 'alert-triangle'
              : INCIDENT_ICON[dialog.filter]
          }
          tone={
            dialog.filter === 'all' ? 'danger' : INCIDENT_TONE[dialog.filter]
          }
          title={
            dialog.filter === 'all'
              ? 'Incidencias abiertas'
              : `Incidencias · ${INCIDENT_LABEL[dialog.filter]}`
          }
          subtitle="Ordenadas por severidad y antigüedad"
          onClose={closeDialog}
        >
          <IncidentTable
            incidents={
              dialog.filter === 'all'
                ? model.incidents
                : model.incidents.filter((i) => i.kind === dialog.filter)
            }
            storeName={nameOf}
            onStore={(n) => setDialog({ kind: 'store', storeNumber: n })}
          />
          <div className="cc-dialog__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLayer('incidents');
                setIncidentFilter(dialog.filter);
                setNavIdx(0);
                closeDialog();
              }}
            >
              Ver en el mapa
            </button>
          </div>
        </GlassDialog>
      )}

      {(dialog?.kind === 'campaigns' ||
        dialog?.kind === 'audience' ||
        dialog?.kind === 'cameras') && (
        <GlassDialog
          icon={
            dialog.kind === 'campaigns'
              ? 'radio'
              : dialog.kind === 'audience'
                ? 'users'
                : 'camera'
          }
          tone={
            dialog.kind === 'campaigns'
              ? 'info'
              : dialog.kind === 'audience'
                ? 'success'
                : 'violet'
          }
          title={
            dialog.kind === 'campaigns'
              ? 'Campañas al aire por tienda'
              : dialog.kind === 'audience'
                ? 'Audiencia por tienda'
                : 'Cámaras por tienda'
          }
          subtitle={`Hoy ${todayLabel}`}
          onClose={closeDialog}
        >
          <StoreTable
            stores={[...active]
              .filter((s) =>
                dialog.kind === 'campaigns'
                  ? s.totalCampaigns > 0
                  : s.cameras.total > 0,
              )
              .sort((a, b) =>
                dialog.kind === 'campaigns'
                  ? b.totalCampaigns - a.totalCampaigns
                  : dialog.kind === 'audience'
                    ? (b.ots ?? 0) - (a.ots ?? 0)
                    : b.cameras.alerting - a.cameras.alerting,
              )}
            onStore={(n) => setDialog({ kind: 'store', storeNumber: n })}
          />
          <div className="cc-dialog__actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLayer(
                  dialog.kind === 'campaigns'
                    ? 'campaigns'
                    : dialog.kind === 'audience'
                      ? 'audience'
                      : 'incidents',
                );
                if (dialog.kind === 'cameras') setIncidentFilter('camera');
                closeDialog();
              }}
            >
              Ver en el mapa
            </button>
          </div>
        </GlassDialog>
      )}
    </section>
  );
}
