import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ADMIRA_CSV_COLUMNS } from '@/domain';
import { listScreens } from '@/services/screens';
import { listCampaigns } from '@/services/campaigns';
import {
  consolidate,
  summarizeIssues,
  type ConsolidationResult,
} from '@/modules/consolidation/consolidate';
import { buildZip, consolidationCsv, csvFileName } from './csvExport';
import { buildIssuesPdf, ISSUE_LABELS } from './pdfReport';
import type { Consolidation } from '@/modules/consolidation/consolidate';
import '@/modules/liverpool-import/ImportPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

type Phase = 'loading' | 'done' | 'error';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exportación CSV: consolida las campañas guardadas en la base de datos contra
 * las pantallas activas del catálogo y genera los CSV de Admira.
 */
export function ExportsPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [result, setResult] = useState<ConsolidationResult | null>(null);
  const [screensCount, setScreensCount] = useState(0);
  const [campaignsCount, setCampaignsCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const [campaigns, screens] = await Promise.all([
        listCampaigns(),
        listScreens(),
      ]);
      setCampaignsCount(campaigns.length);
      setScreensCount(screens.length);
      setResult(consolidate(campaigns, screens));
      setPhase('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`No se pudo procesar. Detalle: ${detail}`);
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function downloadOne(c: Consolidation) {
    download(
      new Blob([consolidationCsv(c)], { type: 'text/csv;charset=utf-8' }),
      csvFileName(c),
    );
  }

  async function downloadZip() {
    if (!result) return;
    download(await buildZip(result.consolidations), 'csv-admira.zip');
  }

  async function downloadPdf() {
    if (!result) return;
    download(await buildIssuesPdf(result), 'reporte-incidencias-liverpool.pdf');
  }

  function downloadIncidences() {
    if (!result) return;
    download(
      new Blob(
        [
          JSON.stringify(
            {
              summary: summarizeIssues(result.issues),
              excludedInstore: result.excludedInstore,
              ismExcludedCount: result.ismExcludedCount,
              issues: result.issues,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
      'incidencias.json',
    );
  }

  return (
    <>
      <PageHeader
        title="Exportación CSV"
        description="Consolida las campañas guardadas (base de datos) contra las pantallas activas del catálogo y genera los CSV de Admira (uno por Campaña + Resolución)."
        actions={
          <button className="btn btn-secondary" onClick={() => void load()}>
            Actualizar
          </button>
        }
      />

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <p className="text-muted" style={{ margin: 0, fontSize: '0.85rem' }}>
          Layout del CSV: <code>{ADMIRA_CSV_COLUMNS.join(',')}</code> ·
          RETAILERS = LIVERPOOL. Las campañas provienen de la base de datos
          (impórtalas en <strong>Importar Calendario</strong>).
        </p>
      </div>

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {phase === 'loading' && (
        <p className="text-muted">Consolidando campañas contra el catálogo…</p>
      )}

      {phase === 'done' && result && campaignsCount === 0 && (
        <div className="import__note">
          No hay campañas guardadas. Ve a <strong>Importar Calendario</strong>,
          sube el archivo y guarda los cambios.
        </div>
      )}

      {phase === 'done' && result && (
        <ResultView
          result={result}
          screensCount={screensCount}
          campaignsCount={campaignsCount}
          onDownloadOne={downloadOne}
          onDownloadZip={() => void downloadZip()}
          onDownloadIncidences={downloadIncidences}
          onDownloadPdf={() => void downloadPdf()}
        />
      )}
    </>
  );
}

function ResultView({
  result,
  screensCount,
  campaignsCount,
  onDownloadOne,
  onDownloadZip,
  onDownloadIncidences,
  onDownloadPdf,
}: {
  result: ConsolidationResult;
  screensCount: number;
  campaignsCount: number;
  onDownloadOne: (c: Consolidation) => void;
  onDownloadZip: () => void;
  onDownloadIncidences: () => void;
  onDownloadPdf: () => void;
}) {
  const summary = summarizeIssues(result.issues);
  const topSupports = Object.entries(summary.bySupport).sort(
    (a, b) => b[1] - a[1],
  );
  const topCampaigns = Object.entries(summary.byCampaign).sort(
    (a, b) => b[1] - a[1],
  );
  return (
    <div className="diagnosis">
      <div className="diagnosis__head">
        <h2>Resultado</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="btn btn-secondary"
            onClick={onDownloadIncidences}
            disabled={
              result.issues.length === 0 && result.excludedInstore.length === 0
            }
          >
            Incidencias (JSON)
          </button>
          <button
            className="btn btn-secondary"
            onClick={onDownloadPdf}
            disabled={result.issues.length === 0}
          >
            Reporte PDF (Liverpool)
          </button>
          <button
            className="btn btn-primary"
            onClick={onDownloadZip}
            disabled={result.consolidations.length === 0}
          >
            Descargar todo (ZIP)
          </button>
        </div>
      </div>

      <dl className="import__summary">
        <div>
          <dt>Campañas (BD)</dt>
          <dd>{campaignsCount}</dd>
        </div>
        <div>
          <dt>CSV a generar</dt>
          <dd>
            <strong>{result.consolidations.length}</strong>
          </dd>
        </div>
        <div>
          <dt>Pantallas en catálogo</dt>
          <dd>{screensCount}</dd>
        </div>
        <div>
          <dt>Incidencias</dt>
          <dd>{result.issues.length}</dd>
        </div>
        <div>
          <dt>InStore excluidos</dt>
          <dd>{result.excludedInstore.length}</dd>
        </div>
        <div>
          <dt>Pantallas ISM excluidas</dt>
          <dd>{result.ismExcludedCount}</dd>
        </div>
      </dl>

      {topSupports.length > 0 && (
        <div className="import__note">
          <strong>Incidencias por soporte</strong> (revisa el mapeo{' '}
          <code>NORMALIZACION LIVERPOOL</code> de estos soportes en el
          catálogo):
          <ul style={{ margin: '0.4rem 0 0' }}>
            {topSupports.slice(0, 8).map(([support, n]) => (
              <li key={support}>
                {support}: <strong>{n}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      {topCampaigns.length > 0 && (
        <details className="diagnosis__section">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Detalle por campaña ({topCampaigns.length} con incidencias)
          </summary>
          <div
            className="diagnosis__table-wrap"
            style={{ marginTop: '0.5rem' }}
          >
            <table className="catalog__table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Incidencias</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map(([campaign, n]) => (
                  <tr key={campaign}>
                    <td>{campaign}</td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {result.issues.length > 0 && (
        <details className="diagnosis__section">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
            Detalle de incidencias ({result.issues.length})
          </summary>
          <div
            className="diagnosis__table-wrap"
            style={{ marginTop: '0.5rem' }}
          >
            <table className="catalog__table">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th>Soporte</th>
                  <th>Tienda</th>
                  <th>Tipo</th>
                </tr>
              </thead>
              <tbody>
                {result.issues.slice(0, 500).map((i, idx) => (
                  <tr key={idx}>
                    <td>{i.campaign}</td>
                    <td>{i.support}</td>
                    <td>{i.store ?? '—'}</td>
                    <td>{ISSUE_LABELS[i.code]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.issues.length > 500 && (
            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              Mostrando las primeras 500 de {result.issues.length}. El PDF
              incluye todas.
            </p>
          )}
        </details>
      )}

      {result.consolidations.length === 0 ? (
        <div className="import__note">
          No se generó ningún CSV. Verifica que haya campañas guardadas y que el
          catálogo tenga la columna <strong>NORMALIZACION LIVERPOOL</strong>{' '}
          mapeada en pantallas activas.
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Resolución</th>
                <th>Nombre Admira</th>
                <th>Filas</th>
                <th aria-label="Descargar" />
              </tr>
            </thead>
            <tbody>
              {result.consolidations.slice(0, 300).map((c, i) => (
                <tr key={`${c.campaignName}-${c.resolution}-${i}`}>
                  <td>{c.campaignName}</td>
                  <td>{c.resolution}</td>
                  <td>{c.admiraCampaignName}</td>
                  <td>{c.rows.length}</td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={() => onDownloadOne(c)}
                    >
                      CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
