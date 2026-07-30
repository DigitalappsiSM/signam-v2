import { useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ADMIRA_CSV_COLUMNS } from '@/domain';
import { listScreens } from '@/services/screens';
import { readCalendarWorkbook } from '@/modules/liverpool-import/readCalendarWorkbook';
import { parseCampaigns } from '@/modules/liverpool-import/campaignParse';
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

type Phase = 'idle' | 'working' | 'done';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Exportación CSV: cruza el calendario contra el catálogo y genera los CSV. */
export function ExportsPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<ConsolidationResult | null>(null);
  const [screensCount, setScreensCount] = useState(0);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPhase('working');
    try {
      const [data, screens] = await Promise.all([
        readCalendarWorkbook(file),
        listScreens(),
      ]);
      setScreensCount(screens.length);
      const parsed = parseCampaigns(data);
      setResult(consolidate(parsed.campaigns, screens));
      setPhase('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`No se pudo procesar. Detalle: ${detail}`);
      setPhase('idle');
    }
  }

  function downloadOne(c: Consolidation) {
    download(
      new Blob([consolidationCsv(c)], { type: 'text/csv;charset=utf-8' }),
      csvFileName(c),
    );
  }

  async function downloadZip() {
    if (!result) return;
    const blob = await buildZip(result.consolidations);
    download(blob, 'csv-admira.zip');
  }

  async function downloadPdf() {
    if (!result) return;
    const blob = await buildIssuesPdf(result, { calendarName: fileName });
    download(blob, 'reporte-incidencias-liverpool.pdf');
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
        description="Sube el Calendario de Liverpool: se cruza contra las pantallas activas del catálogo y se generan los CSV de Admira (uno por Campaña + Resolución)."
      />

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label className="import-file">
          <span className="btn btn-primary">
            Seleccionar calendario (.xlsx / .xls)
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => void handleFile(e)}
            hidden
          />
        </label>
        <p
          className="text-muted"
          style={{ fontSize: '0.85rem', marginBottom: 0 }}
        >
          Layout del CSV: <code>{ADMIRA_CSV_COLUMNS.join(',')}</code> ·
          RETAILERS = LIVERPOOL.
        </p>
      </div>

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {phase === 'working' && (
        <p className="text-muted">Cruzando calendario contra el catálogo…</p>
      )}

      {phase === 'done' && result && (
        <ResultView
          result={result}
          screensCount={screensCount}
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
  onDownloadOne,
  onDownloadZip,
  onDownloadIncidences,
  onDownloadPdf,
}: {
  result: ConsolidationResult;
  screensCount: number;
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
          No se generó ningún CSV. Revisa que el catálogo tenga la columna{' '}
          <strong>NORMALIZACION LIVERPOOL</strong> mapeada y las pantallas
          activas. Descarga las incidencias para ver el detalle.
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
