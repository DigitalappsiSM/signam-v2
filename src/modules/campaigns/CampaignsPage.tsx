import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { listCampaigns } from '@/services/campaigns';
import { listScreens } from '@/services/screens';
import {
  consolidate,
  normalizeStore,
  type Consolidation,
  type ConsolidationIssue,
  type ConsolidationResult,
} from '@/modules/consolidation/consolidate';
import { consolidationCsv, csvFileName } from '@/modules/exports/csvExport';
import { buildIssuesPdf, ISSUE_LABELS } from '@/modules/exports/pdfReport';
import { isInStoreMediaSupport, normalizeSupport } from '@/domain';
import type { AdmiraScreen } from '@/domain';
import type { StoredCampaign } from './campaignDiff';
import '@/modules/liverpool-import/ImportPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

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

/**
 * Módulo Campañas (vista consolidada): lista las campañas guardadas y, por cada
 * una, permite exportar el PDF de errores, ver el detalle (soportes + tiendas +
 * estado) y descargar sus CSV.
 */
export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<StoredCampaign | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, s] = await Promise.all([listCampaigns(), listScreens()]);
      c.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setCampaigns(c);
      setScreens(s);
    } catch {
      setError('No se pudieron cargar las campañas o el catálogo.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const result: ConsolidationResult = useMemo(
    () => consolidate(campaigns, screens),
    [campaigns, screens],
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

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (!q) return campaigns;
    return campaigns.filter((c) => normalize(c.name).includes(q));
  }, [campaigns, search]);

  // Mapa pantalla → número de tienda normalizado, para contar tiendas reales.
  const screenStore = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of screens) {
      m.set(s.id, normalizeStore(s.original['Numero de Tienda']));
    }
    return m;
  }, [screens]);

  // Tiendas distintas realmente incluidas tras la consolidación (cubre el caso
  // "Asignada sin comentario", donde las tiendas provienen del catálogo).
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

  async function downloadPdf(c: StoredCampaign) {
    const res: ConsolidationResult = {
      consolidations: [],
      issues: issuesByCampaign.get(c.name) ?? [],
      excludedInstore: result.excludedInstore.filter(
        (e) => e.campaign === c.name,
      ),
      ismExcludedCount: 0,
    };
    download(await buildIssuesPdf(res), `errores-${safeName(c.name)}.pdf`);
  }

  function downloadCsvFor(cons: Consolidation) {
    download(
      new Blob([consolidationCsv(cons)], { type: 'text/csv;charset=utf-8' }),
      csvFileName(cons),
    );
  }

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Campañas guardadas y su cruce contra el catálogo. Por cada campaña puedes exportar el PDF de errores, ver el detalle (soportes y tiendas) y descargar sus CSV."
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

      <div className="catalog__filters">
        <input
          className="catalog__search"
          type="search"
          placeholder="Buscar campaña…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          {campaigns.length} campañas · {result.consolidations.length} CSV ·{' '}
          {result.issues.length} incidencias
        </span>
      </div>

      {loading ? (
        <p className="text-muted">Cargando…</p>
      ) : campaigns.length === 0 ? (
        <div className="import__note">
          Aún no hay campañas en la base de datos. Ve a{' '}
          <strong>Importar Calendario</strong>, sube el archivo y pulsa{' '}
          <strong>“Aceptar y guardar cambios”</strong>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Ninguna campaña coincide con la búsqueda.
          </p>
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Tipo de campaña</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Contenido</th>
                <th>Tiendas</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const cons = consByCampaign.get(c.name) ?? [];
                const nIssues = (issuesByCampaign.get(c.name) ?? []).length;
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.tipo || '—'}</td>
                    <td>{c.fechaInicio}</td>
                    <td>{c.fechaFin}</td>
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
                          title="Exportar PDF de errores"
                          disabled={nIssues === 0}
                          onClick={() => void downloadPdf(c)}
                        >
                          📄
                        </button>
                        <button
                          className="icon-btn"
                          title="Ver detalle (soportes y tiendas)"
                          onClick={() => setDetail(c)}
                        >
                          👁️
                        </button>
                        <details className="csv-menu">
                          <summary className="icon-btn" title="Descargar CSV">
                            ⬇️
                          </summary>
                          <div className="csv-menu__panel">
                            {cons.length === 0 ? (
                              <span className="text-muted">Sin CSV</span>
                            ) : (
                              cons.map((cn, i) => (
                                <button
                                  key={i}
                                  className="csv-menu__item"
                                  onClick={() => downloadCsvFor(cn)}
                                >
                                  {cn.resolution} — {cn.rows.length} filas
                                </button>
                              ))
                            )}
                          </div>
                        </details>
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
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}

function CampaignDetail({
  campaign,
  issues,
  onClose,
}: {
  campaign: StoredCampaign;
  issues: ConsolidationIssue[];
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
          {campaign.tipo || 'Sin tipo'} · {campaign.fechaInicio} –{' '}
          {campaign.fechaFin}
        </p>

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
              ) : s.stores.length === 0 ? (
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
