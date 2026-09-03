import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { LoadingState } from '@/components/LoadingState';
import { useAuth } from '@/app/providers/AuthProvider';
import {
  correctCampaign,
  listCampaignCorrections,
  listCampaigns,
} from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  listEkonLinks,
  ekonNumberForCampaign,
  migrateLegacyEkonLinks,
  saveEkonLink,
  unlinkEkon,
  type CampaignEkonLink,
} from '@/services/campaignEkonLinks';
import {
  consolidate,
  normalizeStore,
  type Consolidation,
  type ConsolidationIssue,
  type ConsolidationResult,
} from '@/modules/consolidation/consolidate';
import {
  buildZip,
  consolidationCsv,
  csvFileName,
  zipFileName,
} from '@/modules/exports/csvExport';
import { buildIssuesPdf, ISSUE_LABELS } from '@/modules/exports/pdfReport';
import { buildCampaignReport } from '@/modules/exports/campaignReport';
import {
  buildCampaignReportBlob,
  bulkReportFileName,
  individualReportFileName,
} from '@/modules/exports/campaignExcelExport';
import {
  buildCampaignPptPlan,
  buildCampaignPpt,
  pptFileName,
} from '@/modules/exports/pptExport';
import { SortableTh } from '@/components/SortableTh';
import { nextSortState, sortRows, type SortState } from '@/lib/tableSort';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import { isInStoreMediaSupport, normalizeSupport } from '@/domain';
import type { AdmiraScreen } from '@/domain';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { effectiveCampaignSupportScope } from '@/modules/liverpool-import/campaignParse';
import { campaignIdentity, type StoredCampaign } from './campaignDiff';
import { parseEkonNumber, otherCampaignsWithEkonNumber } from './ekon';
import { computeMenuPlacement, type MenuPlacement } from './menuPlacement';
import {
  analyzeLowOccupancy,
  todayIsoDate,
} from '@/modules/low-occupancy/occupancyAnalysis';
import '@/modules/low-occupancy/LowOccupancyPage.css';
import {
  campaignIntersectsPeriod,
  hasPeriodFilter,
  parseCampaignDate,
  periodError,
} from './dateFilter';
import '@/modules/liverpool-import/ImportPage.css';
import '@/modules/admira-catalog/CatalogPage.css';
import {
  CAMPAIGN_FIELD_LABELS,
  EDITABLE_CAMPAIGN_FIELDS,
  campaignCorrectionError,
  type CampaignCorrectionEvent,
  type CampaignCorrectionValues,
  type EditableCampaignField,
} from './campaignCorrection';
import {
  initializeTrackingForImport,
  listOperationalTracking,
} from '@/services/campaignOperationalTracking';
import type {
  CampaignOperationalTracking,
  Classification,
} from '@/modules/operational-tracking/types';
import { classifyFromTipo } from '@/modules/operational-tracking/campaignClassification';
import { isValidDownloadUrl } from '@/modules/operational-tracking/downloadLink';
import { can } from '@/app/permissions';
import './CampaignsPage.css';

function normalize(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'campana';
}

/** Icono estilizado de PowerPoint (recreado con formas, sin logo propietario). */
function PptIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="3" width="20" height="18" rx="2.5" fill="#C43E1C" />
      <text
        x="12"
        y="17"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="Arial, sans-serif"
      >
        P
      </text>
    </svg>
  );
}

/**
 * Módulo Campañas (vista consolidada): lista las campañas guardadas y, por cada
 * una, permite exportar el PDF de errores, ver el detalle (soportes + tiendas +
 * estado), descargar sus CSV y asociar manualmente su número de campaña Ekon.
 * Ofrece además búsqueda por nombre o número Ekon y filtros por periodo
 * (Desde/Hasta).
 */
export function CampaignsPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [ekonLinks, setEkonLinks] = useState<CampaignEkonLink[]>([]);
  const [trackingList, setTrackingList] = useState<
    CampaignOperationalTracking[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [detail, setDetail] = useState<StoredCampaign | null>(null);
  const [correction, setCorrection] = useState<StoredCampaign | null>(null);
  // Menú de descargas: solo uno abierto a la vez (por id de campaña).
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [zipBusyName, setZipBusyName] = useState<string | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [pptBusyName, setPptBusyName] = useState<string | null>(null);
  const [pptError, setPptError] = useState<string | null>(null);
  // Desglose Excel: por id de campaña (evita colisionar campañas homónimas).
  const [excelBusyId, setExcelBusyId] = useState<string | null>(null);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s, initialLinks, tracking] = await Promise.all([
        listCampaigns(),
        listScreens(),
        listEkonLinks(),
        listOperationalTracking(),
      ]);
      let e = initialLinks;
      try {
        const migrated = await migrateLegacyEkonLinks(c, initialLinks);
        if (migrated > 0) e = await listEkonLinks();
      } catch {
        // La migración es idempotente y se reintentará en la próxima carga; no
        // se bloquea la consulta por un fallo transitorio de escritura.
      }
      c.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setCampaigns(c);
      setScreens(s);
      setEkonLinks(e);
      setTrackingList(tracking);
    } catch {
      setError('No se pudieron cargar las campañas o el catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadEkon = useCallback(async () => {
    setEkonLinks(await listEkonLinks());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canCorrectCampaign = can(user?.role ?? 'viewer', 'campaign.correct');

  const trackingCampaignIds = useMemo(
    () =>
      new Set(
        trackingList.flatMap((tracking) =>
          tracking.campaignId ? [tracking.campaignId] : [],
        ),
      ),
    [trackingList],
  );
  const legacyTrackingKeys = useMemo(
    () =>
      new Set(
        trackingList
          .filter((tracking) => !tracking.campaignId)
          .map((tracking) => tracking.campaignNameKey),
      ),
    [trackingList],
  );

  const result: ConsolidationResult = useMemo(
    () => consolidate(campaigns, screens),
    [campaigns, screens],
  );

  // Advertencia no bloqueante: pantallas con baja ocupación (1–2 proveedores)
  // para hoy. No cambia el CSV normal ni bloquea la exportación.
  const today = todayIsoDate();
  const lowOccupancyToday = useMemo(
    () =>
      analyzeLowOccupancy({
        campaigns,
        screens,
        analysisDate: today,
      }).units.filter((u) => u.recommendedRatio === 1).length,
    [campaigns, screens, today],
  );

  const consByCampaign = useMemo(() => {
    const m = new Map<string, Consolidation[]>();
    for (const c of result.consolidations) {
      (
        m.get(c.campaignName) ?? m.set(c.campaignName, []).get(c.campaignName)!
      ).push(c);
    }
    return m;
  }, [result]);

  const issuesByCampaign = useMemo(() => {
    const m = new Map<string, ConsolidationIssue[]>();
    for (const i of result.issues) {
      (m.get(i.campaign) ?? m.set(i.campaign, []).get(i.campaign)!).push(i);
    }
    return m;
  }, [result]);

  // Mapa campaign.id → número Ekon (cada flight se edita por separado).
  const ekonByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const campaign of campaigns) {
      const number = ekonNumberForCampaign(campaign, ekonLinks);
      if (number != null) m.set(campaign.id, number);
    }
    return m;
  }, [campaigns, ekonLinks]);

  // Mapa pantalla → número de tienda normalizado, para contar tiendas reales.
  const screenStore = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of screens) {
      m.set(s.id, normalizeStore(s.original['Numero de Tienda']));
    }
    return m;
  }, [screens]);

  // Índice número de tienda (normalizado) → nombre, tomado del maestro, para
  // enriquecer el PDF de errores con el nombre además del número.
  const storeNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of screens) {
      const num = normalizeStore(s.original['Numero de Tienda']);
      const name = s.original['Nombre de tienda']?.trim();
      if (num && name && !m.has(num)) m.set(num, name);
    }
    return m;
  }, [screens]);

  // Tiendas distintas realmente incluidas tras la consolidación.
  const storeCountByCampaign = useMemo(() => {
    const m = new Map<string, number>();
    for (const [name, cons] of consByCampaign) {
      const stores = new Set<string>();
      for (const cn of cons) {
        for (const id of cn.screenIds) {
          const store = screenStore.get(id);
          if (store) stores.add(store);
        }
      }
      m.set(name, stores.size);
    }
    return m;
  }, [consByCampaign, screenStore]);

  const perError = periodError(desde, hasta);

  const filtered = useMemo(() => {
    if (perError) return [];
    const q = normalize(search);
    const d = parseCampaignDate(desde);
    const h = parseCampaignDate(hasta);
    return campaigns.filter((c) => {
      const ekon = ekonByKey.get(c.id);
      const matchesSearch =
        !q ||
        normalize(c.name).includes(q) ||
        (ekon != null && String(ekon).includes(q));
      if (!matchesSearch) return false;
      return campaignIntersectsPeriod(c.fechaInicio, c.fechaFin, d, h);
    });
  }, [campaigns, ekonByKey, search, desde, hasta, perError]);

  const [sort, setSort] = useState<SortState>({ key: null, dir: 'asc' });
  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        name: (c) => c.name,
        tipo: (c) => c.tipo || '',
        inicio: (c) => parseCampaignDate(c.fechaInicio)?.getTime() ?? 0,
        fin: (c) => parseCampaignDate(c.fechaFin)?.getTime() ?? 0,
        ekon: (c) => ekonByKey.get(c.id) ?? 0,
        tiendas: (c) => storeCountByCampaign.get(c.name) ?? 0,
      }),
    [filtered, sort, ekonByKey, storeCountByCampaign],
  );
  const onSort = (k: string) => setSort((s) => nextSortState(s, k));

  const filtersActive =
    search.trim() !== '' || hasPeriodFilter(desde, hasta) || perError !== null;

  // CSV e incidencias visibles: solo de las campañas incluidas en `filtered`.
  const visibleStats = useMemo(() => {
    let csv = 0;
    let issues = 0;
    for (const c of filtered) {
      csv += consByCampaign.get(c.name)?.length ?? 0;
      issues += (issuesByCampaign.get(c.name) ?? []).length;
    }
    return { csv, issues };
  }, [filtered, consByCampaign, issuesByCampaign]);

  function clearFilters() {
    setSearch('');
    setDesde('');
    setHasta('');
  }

  async function downloadZipFor(c: StoredCampaign, cons: Consolidation[]) {
    if (zipBusyName || cons.length === 0) return;
    setCsvError(null);
    setZipBusyName(c.name);
    try {
      const blob = await buildZip(cons);
      download(blob, zipFileName(c.name));
      setOpenMenuId(null);
    } catch {
      setCsvError(
        `No se pudo generar el ZIP de "${c.name}". Inténtalo de nuevo.`,
      );
      setOpenMenuId(null);
    } finally {
      setZipBusyName(null);
    }
  }

  async function downloadPdf(c: StoredCampaign) {
    const res: ConsolidationResult = {
      consolidations: [],
      issues: issuesByCampaign.get(c.name) ?? [],
      excludedInstore: result.excludedInstore.filter(
        (e) => e.campaign === c.name,
      ),
      ismExcludedCount: 0,
    };
    download(
      await buildIssuesPdf(res, { campaignName: c.name, storeNames }),
      `errores-${safeName(c.name)}.pdf`,
    );
  }

  async function downloadPpt(c: StoredCampaign) {
    if (pptBusyName) return; // evita dos generaciones simultáneas
    setPptError(null);
    setPptBusyName(c.name);
    try {
      const plan = buildCampaignPptPlan(c, screens);
      const blob = await buildCampaignPpt(plan);
      download(blob, pptFileName(c.name, c.fechaInicio, c.fechaFin));
    } catch {
      setPptError(
        `No se pudo generar la PPT de evidencias de "${c.name}". Inténtalo de nuevo.`,
      );
    } finally {
      setPptBusyName(null);
    }
  }

  function downloadCsvFor(cons: Consolidation) {
    download(
      new Blob([consolidationCsv(cons)], { type: 'text/csv;charset=utf-8' }),
      csvFileName(cons),
    );
  }

  // Desglose Excel de UNA campaña (la instancia exacta, sin mezclar homónimas).
  async function downloadExcelFor(c: StoredCampaign) {
    if (excelBusyId) return;
    setExcelError(null);
    setExcelBusyId(c.id);
    try {
      const report = buildCampaignReport([c], screens, ekonByKey);
      const blob = await buildCampaignReportBlob(report);
      download(
        blob,
        individualReportFileName({
          campaignName: c.name,
          ekonNumber: ekonByKey.get(c.id) ?? null,
          startDate: c.fechaInicio,
          endDate: c.fechaFin,
        }),
      );
      setOpenMenuId(null);
    } catch {
      setExcelError(
        `No se pudo generar el desglose Excel de "${c.name}". Inténtalo de nuevo.`,
      );
      setOpenMenuId(null);
    } finally {
      setExcelBusyId(null);
    }
  }

  // Desglose Excel masivo: exporta exactamente el arreglo `filtered` (respeta
  // búsqueda y periodo Desde/Hasta, tal como los ve la tabla).
  async function downloadBulkExcel() {
    if (bulkBusy || perError !== null || filtered.length === 0) return;
    setBulkError(null);
    setBulkBusy(true);
    try {
      const report = buildCampaignReport(filtered, screens, ekonByKey);
      const blob = await buildCampaignReportBlob(report);
      download(blob, bulkReportFileName(desde, hasta));
    } catch {
      setBulkError(
        'No se pudo generar el desglose Excel de las campañas. Inténtalo de nuevo.',
      );
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Campañas guardadas y su cruce contra el catálogo. Desde aquí puedes corregir datos con motivo e historial, generar evidencias, exportar errores, descargar CSV y asociar el número de campaña Ekon."
        actions={
          <button className="btn btn-secondary" onClick={() => void reload()}>
            Actualizar
          </button>
        }
      />

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {lowOccupancyToday > 0 && (
        <div className="occ-warning" role="status">
          <span className="occ-warning__icon" aria-hidden="true">
            ⚠️
          </span>
          <span>
            Se detectaron {lowOccupancyToday}{' '}
            {lowOccupancyToday === 1 ? 'pantalla' : 'pantallas'} con baja
            ocupación para hoy. La exportación puede continuar.
          </span>
          <Link
            className="btn btn-secondary"
            to={`/alertas-ocupacion?fecha=${today}`}
          >
            Ver alertas de baja ocupación
          </Link>
        </div>
      )}

      <div className="catalog__filters">
        <input
          className="catalog__search"
          type="search"
          placeholder="Buscar por campaña o # Ekon…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="campaign-date">
          <span className="text-muted">Desde</span>
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </label>
        <label className="campaign-date">
          <span className="text-muted">Hasta</span>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </label>
        {filtersActive && (
          <button className="btn btn-secondary" onClick={clearFilters}>
            Limpiar filtros
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={() => void downloadBulkExcel()}
          disabled={bulkBusy || perError !== null || filtered.length === 0}
          aria-busy={bulkBusy}
          title="Exportar el desglose Excel de las campañas visibles"
        >
          {bulkBusy
            ? 'Generando Excel…'
            : filtersActive
              ? `Exportar filtradas (${filtered.length})`
              : `Exportar todas (${filtered.length})`}
        </button>
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          {filtersActive
            ? `${filtered.length} de ${campaigns.length} campañas · ${visibleStats.csv} CSV · ${visibleStats.issues} incidencias`
            : `${campaigns.length} campañas · ${result.consolidations.length} CSV · ${result.issues.length} incidencias`}
        </span>
      </div>

      {perError && (
        <div className="catalog__error" role="alert">
          {perError}
        </div>
      )}

      {csvError && (
        <div className="catalog__error" role="alert">
          {csvError}
        </div>
      )}

      {pptError && (
        <div className="catalog__error" role="alert">
          {pptError}
        </div>
      )}

      {excelError && (
        <div className="catalog__error" role="alert">
          {excelError}
        </div>
      )}

      {bulkError && (
        <div className="catalog__error" role="alert">
          {bulkError}
        </div>
      )}

      {loading ? (
        <LoadingState
          variant="process"
          title="Cargando campañas…"
          description="Acomodando flights, fechas y soportes."
          compact
        />
      ) : campaigns.length === 0 ? (
        <div className="import__note">
          Aún no hay campañas en la base de datos. Ve a{' '}
          <strong>Importar Calendario</strong>, sube el archivo y pulsa{' '}
          <strong>“Aceptar y guardar cambios”</strong>.
        </div>
      ) : perError ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Corrige el periodo para ver resultados.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Ninguna campaña coincide con los filtros.
          </p>
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <SortableTh
                  label="Campaña"
                  sortKey="name"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="# campaña Ekon"
                  sortKey="ekon"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Tipo de campaña"
                  sortKey="tipo"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Inicio"
                  sortKey="inicio"
                  sort={sort}
                  onSort={onSort}
                />
                <SortableTh
                  label="Fin"
                  sortKey="fin"
                  sort={sort}
                  onSort={onSort}
                />
                <th>Contenido</th>
                <SortableTh
                  label="Tiendas"
                  sortKey="tiendas"
                  sort={sort}
                  onSort={onSort}
                />
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const cons = consByCampaign.get(c.name) ?? [];
                const nIssues = (issuesByCampaign.get(c.name) ?? []).length;
                const ekon = ekonByKey.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{ekon ?? '—'}</td>
                    <td>{c.tipo || '—'}</td>
                    <td>{formatCivilString(c.fechaInicio)}</td>
                    <td>{formatCivilString(c.fechaFin)}</td>
                    <td>
                      {c.link && c.link.trim() ? (
                        <a
                          className="btn btn-secondary"
                          href={c.link}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '0.3rem 0.6rem',
                            fontSize: '0.8rem',
                          }}
                        >
                          Descargar contenido
                        </a>
                      ) : (
                        <span className="text-muted">Link pendiente</span>
                      )}
                    </td>
                    <td>{storeCountByCampaign.get(c.name) ?? 0}</td>
                    <td>
                      <div className="campaign-actions">
                        <button
                          className="icon-btn"
                          title={`Descargar PPT de evidencias de ${c.name}`}
                          aria-label={`Descargar PPT de evidencias de ${c.name}`}
                          disabled={pptBusyName !== null}
                          aria-busy={pptBusyName === c.name}
                          onClick={() => void downloadPpt(c)}
                        >
                          {pptBusyName === c.name ? (
                            <span className="ppt-generating">…</span>
                          ) : (
                            <PptIcon />
                          )}
                        </button>
                        <button
                          className="icon-btn"
                          title="Exportar PDF de errores"
                          disabled={nIssues === 0}
                          onClick={() => void downloadPdf(c)}
                        >
                          📄
                        </button>
                        {canCorrectCampaign && (
                          <button
                            className="icon-btn"
                            title={`Corregir datos de ${c.name}`}
                            aria-label={`Corregir datos de ${c.name}`}
                            onClick={() => setCorrection(c)}
                          >
                            ✏️
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="Ver detalle (soportes, tiendas y Ekon)"
                          onClick={() => setDetail(c)}
                        >
                          👁️
                        </button>
                        <CampaignDownloadsMenu
                          campaign={c}
                          cons={cons}
                          open={openMenuId === c.id}
                          zipBusy={zipBusyName === c.name}
                          excelBusy={excelBusyId === c.id}
                          onOpenChange={(o) => setOpenMenuId(o ? c.id : null)}
                          onDownloadExcel={() => void downloadExcelFor(c)}
                          onDownloadCsv={(cn) => {
                            downloadCsvFor(cn);
                            setOpenMenuId(null);
                          }}
                          onDownloadZip={() => downloadZipFor(c, cons)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <CampaignDetail
          campaign={detail}
          issues={issuesByCampaign.get(detail.name) ?? []}
          ekonNumber={ekonByKey.get(detail.id) ?? null}
          ekonLinks={ekonLinks}
          actor={actor}
          onChanged={reloadEkon}
          onClose={() => setDetail(null)}
        />
      )}

      {correction && (
        <CampaignCorrectionModal
          campaign={correction}
          actor={actor}
          hasTracking={
            trackingCampaignIds.has(correction.id) ||
            legacyTrackingKeys.has(campaignIdentity(correction))
          }
          onSaved={async () => {
            await reload();
            setCorrection(null);
          }}
          onClose={() => setCorrection(null)}
        />
      )}
    </>
  );
}

function toDateInputValue(value: string): string {
  const date = parseCampaignDate(value);
  if (!date) return '';
  const year = date.getUTCFullYear();
  if (year < 2000 || year > 2100) return '';
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initialCorrectionValues(
  campaign: StoredCampaign,
): CampaignCorrectionValues {
  return Object.fromEntries(
    EDITABLE_CAMPAIGN_FIELDS.map((field) => [
      field,
      field === 'fechaInicio' || field === 'fechaFin'
        ? toDateInputValue(campaign[field])
        : campaign[field],
    ]),
  ) as CampaignCorrectionValues;
}

function CampaignCorrectionModal({
  campaign,
  actor,
  hasTracking,
  onSaved,
  onClose,
}: {
  campaign: StoredCampaign;
  actor: Actor;
  hasTracking: boolean;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<CampaignCorrectionValues>(() =>
    initialCorrectionValues(campaign),
  );
  const [reason, setReason] = useState('');
  const [classification, setClassification] = useState<Classification | ''>('');
  const [history, setHistory] = useState<CampaignCorrectionEvent[]>([]);
  const [saving, setSaving] = useState(false);
  const [correctionSaved, setCorrectionSaved] = useState<StoredCampaign | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listCampaignCorrections(campaign.id)
      .then((events) => {
        if (active) setHistory(events);
      })
      .catch(() => {
        if (active) setHistory([]);
      });
    return () => {
      active = false;
    };
  }, [campaign.id]);

  const effectiveTipo = values.tipo ?? campaign.tipo;
  const inferredClassification = classifyFromTipo(effectiveTipo);
  const needsClassification =
    !hasTracking && inferredClassification === 'unknown';
  const validation = campaignCorrectionError(campaign, values, reason);

  function setField(field: EditableCampaignField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save() {
    setError(null);
    if (!correctionSaved && validation) {
      setError(validation);
      return;
    }
    const selectedClassification =
      inferredClassification === 'unknown'
        ? classification
        : inferredClassification;
    if (!hasTracking && selectedClassification === '') {
      setError('Selecciona la clasificación para crear el seguimiento.');
      return;
    }

    setSaving(true);
    try {
      const correctedCampaign =
        correctionSaved ??
        (
          await correctCampaign({
            campaignId: campaign.id,
            values,
            reason,
            actor,
          })
        ).campaign;
      setCorrectionSaved(correctedCampaign);
      if (!hasTracking) {
        const trackingResult = await initializeTrackingForImport(
          [
            {
              campaignId: correctedCampaign.id,
              campaignNameKey: campaignIdentity(correctedCampaign),
              campaignName: correctedCampaign.name,
              classification: selectedClassification as Classification,
              linkValid: isValidDownloadUrl(correctedCampaign.link),
              confirmedReclassify: false,
            },
          ],
          actor,
        );
        if (trackingResult.failures.length > 0) {
          setHistory(await listCampaignCorrections(campaign.id));
          setError(
            'La corrección se guardó, pero no se pudo crear el seguimiento operativo. Usa “Reintentar seguimiento” para completar la operación.',
          );
          return;
        }
      }
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'No se pudo guardar la corrección.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Corregir campaña ${campaign.name}`}
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="modal__card campaign-correction"
        style={{ maxWidth: 760 }}
      >
        <h2 className="modal__title">Corregir {campaign.name}</h2>
        <p className="text-muted campaign-correction__intro">
          Modifica únicamente los campos necesarios. SIGNAM conservará la
          corrección frente a futuras reimportaciones y registrará el cambio.
        </p>

        <div className="campaign-correction__grid">
          {EDITABLE_CAMPAIGN_FIELDS.map((field) => (
            <label key={field}>
              <span>{CAMPAIGN_FIELD_LABELS[field]}</span>
              <input
                className="catalog__search"
                type={
                  field === 'fechaInicio' || field === 'fechaFin'
                    ? 'date'
                    : field === 'link'
                      ? 'url'
                      : 'text'
                }
                min={
                  field === 'fechaInicio' || field === 'fechaFin'
                    ? '2000-01-01'
                    : undefined
                }
                max={
                  field === 'fechaInicio' || field === 'fechaFin'
                    ? '2100-12-31'
                    : undefined
                }
                value={values[field] ?? ''}
                disabled={saving || correctionSaved !== null}
                onChange={(event) => setField(field, event.target.value)}
              />
              {(field === 'fechaInicio' || field === 'fechaFin') &&
                values[field] === '' && (
                  <small className="text-muted">
                    Valor guardado: {campaign[field] || 'vacío'}
                  </small>
                )}
            </label>
          ))}
        </div>

        {needsClassification && (
          <label className="campaign-correction__classification">
            <span>Clasificación para seguimiento</span>
            <select
              value={classification}
              disabled={saving || correctionSaved !== null}
              onChange={(event) =>
                setClassification(event.target.value as Classification | '')
              }
            >
              <option value="">— Selecciona —</option>
              <option value="institutional">Institucional</option>
              <option value="provider">Proveedor</option>
            </select>
          </label>
        )}

        <label className="campaign-correction__reason">
          <span>Motivo de la corrección</span>
          <textarea
            rows={3}
            value={reason}
            disabled={saving || correctionSaved !== null}
            placeholder="Ej. Error de captura en la fecha del calendario recibido"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        {error && (
          <div className="catalog__error" role="alert">
            {error}
          </div>
        )}

        {history.length > 0 && (
          <section className="campaign-correction__history">
            <h3>Historial de correcciones</h3>
            <ul>
              {history.map((event) => (
                <li key={event.id}>
                  <p>{event.comment}</p>
                  <small className="text-muted">
                    {new Date(event.at).toLocaleString('es-MX')}
                  </small>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="modal__actions">
          <button
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || (!correctionSaved && validation !== null)}
            aria-busy={saving}
          >
            {saving
              ? 'Guardando…'
              : correctionSaved
                ? 'Reintentar seguimiento'
                : 'Confirmar corrección'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CampaignDetail({
  campaign,
  issues,
  ekonNumber,
  ekonLinks,
  actor,
  onChanged,
  onClose,
}: {
  campaign: StoredCampaign;
  issues: ConsolidationIssue[];
  ekonNumber: number | null;
  ekonLinks: CampaignEkonLink[];
  actor: Actor;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const byStore = new Map<string, string>();
  const bySupport = new Map<string, string>();
  for (const i of issues) {
    if (i.store)
      byStore.set(`${normalizeSupport(i.support)}|${i.store}`, i.code);
    else bySupport.set(normalizeSupport(i.support), i.code);
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de campaña"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card" style={{ maxWidth: 720 }}>
        <h2 className="modal__title">{campaign.name}</h2>
        <p className="text-muted" style={{ marginTop: 0 }}>
          {campaign.tipo || 'Sin tipo'} ·{' '}
          {formatCivilString(campaign.fechaInicio)} –{' '}
          {formatCivilString(campaign.fechaFin)}
        </p>

        <EkonEditor
          campaign={campaign}
          ekonNumber={ekonNumber}
          ekonLinks={ekonLinks}
          actor={actor}
          onChanged={onChanged}
        />

        {campaign.supports.length === 0 && (
          <p className="text-muted">La campaña no tiene soportes asignados.</p>
        )}

        {campaign.supports.map((s, idx) => {
          const instore = isInStoreMediaSupport(s.support);
          const supNorm = normalizeSupport(s.support);
          return (
            <section key={idx} className="detail-support">
              <h3>
                {s.support}{' '}
                {instore ? (
                  <span className="badge badge-warning">
                    InStore (excluido)
                  </span>
                ) : (
                  <span className="badge badge-muted">Liverpool</span>
                )}
              </h3>
              {instore ? (
                <p className="text-muted" style={{ margin: 0 }}>
                  Excluido de la consolidación en esta etapa.
                </p>
              ) : effectiveCampaignSupportScope(s) === 'invalid' ? (
                <p style={{ margin: 0 }}>
                  Alcance de tiendas pendiente o inválido{' '}
                  <span className="badge badge-danger">Bloqueado</span>
                </p>
              ) : effectiveCampaignSupportScope(s) === 'all' ? (
                <p style={{ margin: 0 }}>
                  Todas las tiendas del soporte{' '}
                  {bySupport.has(supNorm) ? (
                    <span className="badge badge-warning">
                      {ISSUE_LABELS[
                        bySupport.get(supNorm) as keyof typeof ISSUE_LABELS
                      ] ?? 'incidencia'}
                    </span>
                  ) : (
                    <span className="badge badge-info">OK</span>
                  )}
                </p>
              ) : (
                <ul className="detail-stores">
                  {s.stores.map((st, j) => {
                    const code = byStore.get(
                      `${supNorm}|${normalizeStore(st.numero)}`,
                    );
                    return (
                      <li key={j}>
                        <span>
                          {st.numero} {st.nombre}
                        </span>
                        {code ? (
                          <span className="badge badge-warning">
                            {ISSUE_LABELS[code as keyof typeof ISSUE_LABELS] ??
                              'incidencia'}
                          </span>
                        ) : (
                          <span className="badge badge-info">OK</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        <div className="modal__actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editor de la asociación campaña ↔ número de campaña Ekon (dentro del modal).
 * Valida con `parseEkonNumber`, confirma antes de reemplazar la asociación
 * existente de esta campaña y —como un número puede compartirse entre varias
 * campañas— avisa y pide confirmación cuando el número ya está en otras
 * campañas (ver `otherCampaignsWithEkonNumber`). Delega la persistencia en el
 * servicio.
 */
function EkonEditor({
  campaign,
  ekonNumber,
  ekonLinks,
  actor,
  onChanged,
}: {
  campaign: StoredCampaign;
  ekonNumber: number | null;
  ekonLinks: CampaignEkonLink[];
  actor: Actor;
  onChanged: () => Promise<void>;
}) {
  const [value, setValue] = useState(
    ekonNumber != null ? String(ekonNumber) : '',
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setValue(ekonNumber != null ? String(ekonNumber) : '');
    setError(null);
    setStatus(null);
  }, [ekonNumber]);

  async function save() {
    setError(null);
    setStatus(null);
    const parsed = parseEkonNumber(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (ekonNumber != null && parsed.value === ekonNumber) {
      setStatus('Sin cambios: el número ya está asociado.');
      return;
    }
    if (
      ekonNumber != null &&
      !window.confirm(
        `Esta campaña ya tiene el número Ekon ${ekonNumber}. ¿Reemplazarlo por ${parsed.value}?`,
      )
    ) {
      return;
    }
    // Aviso: el número ya está en otras campañas. Se permite compartirlo, pero
    // se pide confirmación indicando en qué campañas ya está puesto.
    const others = otherCampaignsWithEkonNumber(
      ekonLinks,
      parsed.value,
      campaign.id,
    );
    if (others.length > 0) {
      const names = others.map((o) => `• ${o.campaignName}`).join('\n');
      if (
        !window.confirm(
          `El número Ekon ${parsed.value} ya está asignado a ${
            others.length === 1
              ? 'otra campaña'
              : `otras ${others.length} campañas`
          }:\n\n${names}\n\n¿Asignarlo también a "${campaign.name}"?`,
        )
      ) {
        return;
      }
    }
    setSaving(true);
    try {
      await saveEkonLink({
        campaignId: campaign.id,
        campaignNameKey: campaign.nameKey,
        campaignName: campaign.name,
        ekonCampaignNumber: parsed.value,
        actor,
      });
      await onChanged();
      setStatus('Asociación guardada.');
    } catch {
      setError('No se pudo guardar la asociación Ekon.');
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setError(null);
    setStatus(null);
    if (
      !window.confirm('¿Desvincular el número de campaña Ekon de esta campaña?')
    ) {
      return;
    }
    setSaving(true);
    try {
      await unlinkEkon({ campaignId: campaign.id, actor });
      await onChanged();
      setValue('');
      setStatus('Asociación eliminada.');
    } catch {
      setError('No se pudo desvincular la asociación Ekon.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ekon-editor">
      <label htmlFor="ekon-input" className="ekon-editor__label">
        # campaña Ekon
      </label>
      <div className="ekon-editor__row">
        <input
          id="ekon-input"
          className="catalog__search"
          type="text"
          inputMode="numeric"
          placeholder="Opcional (entero positivo)"
          value={value}
          disabled={saving}
          aria-invalid={error != null}
          aria-describedby="ekon-feedback"
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={() => void save()}
          disabled={saving}
          aria-busy={saving}
        >
          Guardar
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => void unlink()}
          disabled={saving || ekonNumber == null}
          aria-busy={saving}
        >
          Desvincular
        </button>
      </div>
      <div id="ekon-feedback" aria-live="polite">
        {error && (
          <p
            className="catalog__error"
            role="alert"
            style={{ margin: '0.4rem 0 0' }}
          >
            {error}
          </p>
        )}
        {status && !error && (
          <p className="text-muted" style={{ margin: '0.4rem 0 0' }}>
            {status}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Menú de **descargas** de una campaña (desglose Excel, ZIP de CSV y CSV por
 * resolución). Es un menú controlado por React que se renderiza mediante
 * `createPortal` hacia `document.body`, para no quedar recortado por el overflow
 * del contenedor desplazable de la tabla. Se coloca junto al botón con
 * `computeMenuPlacement` (abre hacia abajo o hacia arriba) y se cierra al pulsar
 * fuera, con Escape o al hacer scroll/resize.
 */
function CampaignDownloadsMenu({
  campaign,
  cons,
  open,
  zipBusy,
  excelBusy,
  onOpenChange,
  onDownloadExcel,
  onDownloadCsv,
  onDownloadZip,
}: {
  campaign: StoredCampaign;
  cons: Consolidation[];
  open: boolean;
  zipBusy: boolean;
  excelBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onDownloadExcel: () => void;
  onDownloadCsv: (cn: Consolidation) => void;
  onDownloadZip: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const panelId = `csv-menu-${campaign.id}`;

  const reposition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPlacement(
      computeMenuPlacement({
        anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        menuWidth: 240,
        estimatedHeight: Math.min(320, 64 + (cons.length + 1) * 38),
      }),
    );
  }, [cons.length]);

  useLayoutEffect(() => {
    if (open) reposition();
    else setPlacement(null);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const close = () => onOpenChange(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
        btnRef.current?.focus();
      }
    };
    const onPointerDown = (e: Event) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onOpenChange(false);
    };
    // Cerrar (en vez de recolocar) al desplazar o redimensionar: es preferible
    // cerrar de forma segura a dejar el panel desalineado.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onOpenChange]);

  const style: CSSProperties = placement
    ? {
        left: placement.left,
        ...(placement.top !== undefined ? { top: placement.top } : {}),
        ...(placement.bottom !== undefined ? { bottom: placement.bottom } : {}),
        ...(placement.maxHeight ? { maxHeight: placement.maxHeight } : {}),
        // El panel se alinea al borde derecho del botón; escala desde esa
        // esquina, arriba o abajo según hacia dónde abra.
        transformOrigin: placement.openUp ? 'bottom right' : 'top right',
      }
    : { visibility: 'hidden' };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn"
        aria-label={`Descargas de ${campaign.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => onOpenChange(!open)}
      >
        ⬇️
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            aria-label={`Descargas de ${campaign.name}`}
            className={
              placement
                ? 'csv-menu__panel csv-menu__panel--in'
                : 'csv-menu__panel'
            }
            style={style}
          >
            <button
              type="button"
              role="menuitem"
              className="csv-menu__item csv-menu__item--zip"
              disabled={excelBusy}
              aria-busy={excelBusy}
              onClick={() => onDownloadExcel()}
            >
              {excelBusy ? 'Generando Excel…' : 'Descargar desglose Excel'}
            </button>
            <div className="csv-menu__sep" role="separator" />
            {cons.length === 0 ? (
              <span
                className="csv-menu__empty text-muted"
                role="menuitem"
                aria-disabled="true"
              >
                Sin CSV
              </span>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="csv-menu__item csv-menu__item--zip"
                  disabled={zipBusy}
                  aria-busy={zipBusy}
                  onClick={() => onDownloadZip()}
                >
                  {zipBusy ? 'Generando ZIP…' : 'Descargar todos en ZIP'}
                </button>
                <div className="csv-menu__sep" role="separator" />
                {cons.map((cn, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    className="csv-menu__item"
                    onClick={() => onDownloadCsv(cn)}
                  >
                    {cn.resolution} — {cn.rows.length} filas
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
