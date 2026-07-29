import { useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { analyzeCalendar, type CalendarAnalysis } from './calendarImport';
import { readCalendarWorkbook } from './readCalendarWorkbook';
import './ImportPage.css';

type Phase = 'idle' | 'analyzing' | 'done';

/** Importación del Calendario de Liverpool — paso 1: inspección/vista previa. */
export function ImportPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<CalendarAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPhase('analyzing');
    try {
      const data = await readCalendarWorkbook(file);
      setAnalysis(analyzeCalendar(data));
      setPhase('done');
    } catch {
      setError('No se pudo leer el archivo. ¿Es un Excel (.xlsx) válido?');
      setPhase('idle');
    }
  }

  function downloadDiagnosis() {
    if (!analysis) return;
    const blob = new Blob(
      [JSON.stringify({ fileName, ...analysis }, null, 2)],
      {
        type: 'application/json',
      },
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
            Seleccionar calendario (.xlsx)
          </span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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

      {phase === 'done' && analysis && (
        <Diagnosis analysis={analysis} onDownload={downloadDiagnosis} />
      )}
    </>
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
