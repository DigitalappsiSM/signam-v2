import { useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { analyzeCalendar, type CalendarAnalysis } from './calendarImport';
import {
  parseCampaigns,
  type CampaignParseResult,
  type ParsedCampaign,
} from './campaignParse';
import { readCalendarWorkbook } from './readCalendarWorkbook';
import {
  diffCampaigns,
  type CampaignDiff,
} from '@/modules/campaigns/campaignDiff';
import { applyCampaignChanges, listCampaigns } from '@/services/campaigns';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import './ImportPage.css';

type Phase = 'idle' | 'analyzing' | 'done';

/** Importación del Calendario de Liverpool — inspección + campañas + guardado. */
export function ImportPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<CalendarAnalysis | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignParseResult | null>(null);
  const [parsedList, setParsedList] = useState<ParsedCampaign[]>([]);
  const [diff, setDiff] = useState<CampaignDiff | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setSaveNotice(null);
    setDiff(null);
    setPhase('analyzing');
    try {
      const data = await readCalendarWorkbook(file);
      setAnalysis(analyzeCalendar(data));
      const parsed = parseCampaigns(data);
      setCampaigns(parsed);
      setParsedList(parsed.campaigns);
      const storedCampaigns = await listCampaigns();
      setDiff(diffCampaigns(parsed.campaigns, storedCampaigns));
      setPhase('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(
        `No se pudo leer el archivo. Detalle: ${detail}. Si el problema persiste, intenta abrirlo en Excel y "Guardar como" → Libro de Excel (.xlsx).`,
      );
      setPhase('idle');
    }
  }

  async function saveChanges() {
    if (!diff || !diff.hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      const res = await applyCampaignChanges(diff, actor);
      const stored = await listCampaigns();
      setDiff(diffCampaigns(parsedList, stored));
      setSaveNotice(
        `Guardado: ${res.added} nuevas, ${res.modified} modificadas, ${res.removed} eliminadas.`,
      );
    } catch {
      setError('No se pudieron guardar los cambios de campañas.');
    } finally {
      setSaving(false);
    }
  }

  function downloadDiagnosis() {
    if (!analysis) return;
    const blob = new Blob(
      [JSON.stringify({ fileName, analysis, campaigns }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `diagnostico-${fileName || 'calendario'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Importar Calendario"
        description="Paso 1 — Inspección: sube el Calendario de Liverpool y revisa la estructura detectada (hojas, columnas, comentarios y soportes) antes de definir la validación y el mapeo a campañas."
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
        {fileName && (
          <span className="text-muted import-file__name">{fileName}</span>
        )}
      </div>

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {phase === 'analyzing' && (
        <p className="text-muted">Analizando archivo…</p>
      )}

      {saveNotice && (
        <div className="catalog__notice" role="status">
          {saveNotice}
        </div>
      )}

      {phase === 'done' && diff && (
        <CampaignChangesPanel
          diff={diff}
          saving={saving}
          onSave={() => void saveChanges()}
        />
      )}

      {phase === 'done' && campaigns && <CampaignsView result={campaigns} />}

      {phase === 'done' && analysis && (
        <Diagnosis analysis={analysis} onDownload={downloadDiagnosis} />
      )}
    </>
  );
}

function CampaignChangesPanel({
  diff,
  saving,
  onSave,
}: {
  diff: CampaignDiff;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div className="diagnosis" style={{ marginBottom: '1.5rem' }}>
      <div className="diagnosis__head">
        <h2>Cambios en campañas (base de datos)</h2>
        {diff.hasChanges ? (
          <button
            className="btn btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Aceptar y guardar cambios'}
          </button>
        ) : (
          <span className="badge badge-info">Sin cambios</span>
        )}
      </div>

      {!diff.hasChanges ? (
        <p className="text-muted">
          Las campañas del calendario coinciden con la base de datos. No se
          reescribe nada.
        </p>
      ) : (
        <>
          <dl className="import__summary">
            <div>
              <dt>Nuevas</dt>
              <dd>
                <strong>{diff.added.length}</strong>
              </dd>
            </div>
            <div>
              <dt>Modificadas</dt>
              <dd>
                <strong>{diff.modified.length}</strong>
              </dd>
            </div>
            <div>
              <dt>Eliminadas</dt>
              <dd>{diff.removed.length}</dd>
            </div>
            <div>
              <dt>Sin cambios</dt>
              <dd>{diff.unchanged}</dd>
            </div>
          </dl>

          <p className="import__note" style={{ marginTop: 0 }}>
            Revisa los cambios y pulsa{' '}
            <strong>“Aceptar y guardar cambios”</strong> para escribirlos en la
            base de datos.
          </p>

          {diff.added.length > 0 && (
            <details className="diagnosis__section">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Nuevas ({diff.added.length})
              </summary>
              <ul className="text-muted">
                {diff.added.slice(0, 100).map((c) => (
                  <li key={c.name}>{c.name}</li>
                ))}
              </ul>
            </details>
          )}

          {diff.modified.length > 0 && (
            <details className="diagnosis__section" open>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Modificadas ({diff.modified.length})
              </summary>
              <div
                className="diagnosis__table-wrap"
                style={{ marginTop: '0.5rem' }}
              >
                <table className="catalog__table">
                  <thead>
                    <tr>
                      <th>Campaña</th>
                      <th>Cambios</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.modified.slice(0, 200).map((m) => (
                      <tr key={m.campaign.name}>
                        <td>{m.campaign.name}</td>
                        <td>{m.changes.join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {diff.removed.length > 0 && (
            <details className="diagnosis__section">
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Eliminadas ({diff.removed.length})
              </summary>
              <ul className="text-muted">
                {diff.removed.slice(0, 100).map((c) => (
                  <li key={c.id}>{c.name}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function CampaignsView({ result }: { result: CampaignParseResult }) {
  const liverpoolStores = (c: CampaignParseResult['campaigns'][number]) =>
    c.supports
      .filter((s) => s.owner === 'liverpool')
      .reduce((n, s) => n + s.stores.length, 0);

  return (
    <div className="diagnosis" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1.2rem' }}>Campañas detectadas</h2>

      <dl className="import__summary">
        <div>
          <dt>Campañas</dt>
          <dd>
            <strong>{result.totalCampaigns}</strong>
          </dd>
        </div>
        <div>
          <dt>Soportes Liverpool</dt>
          <dd>{result.liverpoolSupports.length}</dd>
        </div>
        <div>
          <dt>Soportes InStore (excluidos)</dt>
          <dd>{result.instoreSupports.length}</dd>
        </div>
      </dl>

      <div className="import__note">
        <strong>Soportes Liverpool:</strong>{' '}
        {result.liverpoolSupports.join(' · ') || '—'}
        <br />
        <strong>InStore Media (Muppi’s / Pendón, excluidos):</strong>{' '}
        {result.instoreSupports.join(' · ') || '—'}
      </div>

      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Campaña</th>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Soportes Liverpool</th>
              <th>Tiendas</th>
            </tr>
          </thead>
          <tbody>
            {result.campaigns.slice(0, 100).map((c) => (
              <tr key={c.row}>
                <td>{c.name}</td>
                <td>{c.fechaInicio}</td>
                <td>{c.fechaFin}</td>
                <td>
                  {c.supports
                    .filter((s) => s.owner === 'liverpool')
                    .map((s) => s.support)
                    .join(', ') || '—'}
                </td>
                <td>{liverpoolStores(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.campaigns.length > 100 && (
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          Mostrando las primeras 100 de {result.campaigns.length} campañas.
        </p>
      )}
    </div>
  );
}

function Diagnosis({
  analysis,
  onDownload,
}: {
  analysis: CalendarAnalysis;
  onDownload: () => void;
}) {
  const blocking = analysis.issues.filter((i) => i.severity === 'blocking');
  const warnings = analysis.issues.filter((i) => i.severity === 'warning');

  return (
    <div className="diagnosis">
      <div className="diagnosis__head">
        <h2>Diagnóstico</h2>
        <button className="btn btn-secondary" onClick={onDownload}>
          Descargar diagnóstico (JSON)
        </button>
      </div>

      <dl className="import__summary">
        <div>
          <dt>Hoja operativa</dt>
          <dd>{analysis.operativeSheet ?? '—'}</dd>
        </div>
        <div>
          <dt>Fila de encabezados</dt>
          <dd>{analysis.headerRow ?? '—'}</dd>
        </div>
        <div>
          <dt>Columnas detectadas</dt>
          <dd>{analysis.headers.filter((h) => h !== '').length}</dd>
        </div>
        <div>
          <dt>Filas de datos</dt>
          <dd>
            <strong>{analysis.dataRowCount}</strong>
          </dd>
        </div>
        <div>
          <dt>Comentarios de celda</dt>
          <dd>{analysis.comments.length}</dd>
        </div>
      </dl>

      {blocking.length > 0 && (
        <div className="import__issues import__issues--blocking">
          <h3>Errores</h3>
          <ul>
            {blocking.map((i, idx) => (
              <li key={idx}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="import__issues import__issues--warning">
          <h3>Advertencias</h3>
          <ul>
            {warnings.map((i, idx) => (
              <li key={idx}>{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="diagnosis__section">
        <h3>Hojas del archivo</h3>
        <ul className="text-muted">
          {analysis.sheets.map((s) => (
            <li key={s.name}>
              <strong>{s.name}</strong> — {s.rows} filas × {s.cols} columnas
              {s.name === analysis.operativeSheet ? ' (operativa)' : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="diagnosis__section">
        <h3>Soportes InStore Media detectados (Muppi’s / Pendón)</h3>
        {analysis.instoreSupports.length === 0 ? (
          <p className="text-muted">Ninguno.</p>
        ) : (
          <ul>
            {analysis.instoreSupports.map((s) => (
              <li key={s.value}>
                <span className="badge badge-warning">{s.value}</span> ×{' '}
                {s.count}
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>
          En esta etapa Muppi’s y Pendón se detectan pero se excluyen de la
          consolidación.
        </p>
      </section>

      {analysis.headers.length > 0 && (
        <section className="diagnosis__section">
          <h3>Vista previa</h3>
          <div className="diagnosis__table-wrap">
            <table className="catalog__table">
              <thead>
                <tr>
                  {analysis.headers.map((h, i) => (
                    <th key={i}>{h || `(col ${i + 1})`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.previewRows.map((row, r) => (
                  <tr key={r}>
                    {analysis.headers.map((_, c) => (
                      <td key={c}>{row[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {analysis.comments.length > 0 && (
        <section className="diagnosis__section">
          <h3>Comentarios de celda</h3>
          <div className="diagnosis__table-wrap">
            <table className="catalog__table">
              <thead>
                <tr>
                  <th>Celda</th>
                  <th>Comentario</th>
                </tr>
              </thead>
              <tbody>
                {analysis.comments.slice(0, 50).map((c, i) => (
                  <tr key={i}>
                    <td>{c.address}</td>
                    <td>{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
