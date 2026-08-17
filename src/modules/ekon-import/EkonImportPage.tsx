import { useMemo, useState, type ChangeEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/app/providers/AuthProvider';
import { isFirebaseConfigured } from '@/services/firebase';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import { readEkonWorkbook } from './readEkonWorkbook';
import {
  analyzeEkonGrid,
  previewDiff,
  type DiffPreview,
  type EkonFileAnalysis,
} from './ekonImportFlow';
import {
  activateBatch,
  createPendingBatch,
  findCompletedBatchByHash,
  listBatches,
  type EkonBatchSummary,
} from '@/services/ekonImports';
import { listAllAssignments } from '@/services/ekonAssignments';
import type { StoredEkonAssignment } from '@/domain/ekon';

type Phase = 'idle' | 'analyzing' | 'review' | 'saving' | 'done';

/** Importación Ekon: flujo por etapas (validar → alcance → diff → persistir). */
export function EkonImportPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };
  const configured = isFirebaseConfigured();

  const [phase, setPhase] = useState<Phase>('idle');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<EkonFileAnalysis | null>(null);
  const [previous, setPrevious] = useState<StoredEkonAssignment[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [batches, setBatches] = useState<EkonBatchSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setNotice(null);
    setPhase('analyzing');
    try {
      const grid = await readEkonWorkbook(file);
      const result = analyzeEkonGrid(grid);
      setAnalysis(result);
      // Alcance propuesto: todos los periodos detectados quedan preseleccionados.
      setConfirmedIds(new Set(result.periods.periods.map((p) => p.idPeriodo)));
      if (configured) {
        const [prev, existing] = await Promise.all([
          listAllAssignments(),
          listBatches(),
        ]);
        setPrevious(prev);
        setBatches(existing);
      }
      setPhase('review');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`No se pudo leer el archivo Ekon. Detalle: ${detail}.`);
      setPhase('idle');
    }
  }

  const preview: DiffPreview | null = useMemo(() => {
    if (!analysis) return null;
    return previewDiff(
      analysis.assignments,
      previous,
      [...confirmedIds],
      analysis.periods,
    );
  }, [analysis, previous, confirmedIds]);

  function togglePeriod(id: string) {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirmImport() {
    if (!analysis || !configured) return;
    setPhase('saving');
    setError(null);
    try {
      const confirmed = [...confirmedIds];
      // Idempotencia: si ya existe un lote completado con el mismo hash y alcance,
      // no se vuelve a importar.
      const duplicate = await findCompletedBatchByHash(
        analysis.contentHash,
        confirmed,
      );
      if (duplicate) {
        setNotice(
          `Este archivo y alcance ya se importaron (lote ${duplicate.id}). No se duplicó nada.`,
        );
        setBatches(await listBatches());
        setPhase('done');
        return;
      }
      const batchId = await createPendingBatch({
        fileName,
        contentHash: analysis.contentHash,
        rowCount: analysis.parse.totalRows,
        detectedPeriods: analysis.periods.periods,
        coverage: analysis.periods.coverage,
        warnings: buildWarnings(analysis),
        actor,
      });
      const result = await activateBatch({
        batchId,
        assignments: analysis.assignments,
        confirmedPeriodIds: confirmed,
        totals: {
          totalRows: analysis.metrics.totalRows,
          validRows: analysis.metrics.validRows,
          rejectedRows: analysis.metrics.rejectedRows,
          distinctCampaigns: analysis.metrics.distinctCampaigns,
          distinctLines: analysis.metrics.distinctLines,
          distinctDeterminantes: analysis.metrics.distinctDeterminantes,
          periods: confirmed.length,
        },
        actor,
      });
      setNotice(
        `Importación completada: ${result.totals.nuevas} nuevas, ${result.totals.modificadas} modificadas, ${result.totals.noIncluidas} no incluidas, ${result.totals.restauradas} restauradas, ${result.totals.conflictos} conflictos.`,
      );
      setBatches(await listBatches());
      setPrevious(await listAllAssignments());
      setPhase('done');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const hint = /permission|insufficient|PERMISSION_DENIED/i.test(detail)
        ? ' Parece un problema de permisos: verifica que las reglas de Firestore de las colecciones Ekon estén desplegadas.'
        : /index/i.test(detail)
          ? ' Falta un índice de Firestore: despliega firestore.indexes.json.'
          : '';
      setError(
        `No se pudo completar la importación. El lote no quedó como completado. Detalle: ${detail}.${hint}`,
      );
      setPhase('review');
    }
  }

  return (
    <>
      <PageHeader
        title="Importación Ekon"
        description="Importa la extracción Ekon (Datos Tienda), confirma los periodos detectados y revisa el diff contra la última importación antes de persistir. No toca Liverpool, el Master ni el seguimiento."
      />

      {!configured && (
        <div className="catalog__notice" role="status">
          Firebase no está configurado (modo degradado): puedes analizar el
          archivo, pero la importación no se persistirá.
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label className="import-file">
          <span className="btn btn-primary">
            Seleccionar archivo Ekon (.xlsx)
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => void handleFile(e)}
            hidden
            disabled={phase === 'analyzing' || phase === 'saving'}
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
      {notice && (
        <div className="catalog__notice" role="status">
          {notice}
        </div>
      )}
      {phase === 'analyzing' && (
        <p className="text-muted">Analizando archivo Ekon…</p>
      )}
      {phase === 'saving' && (
        <p className="text-muted">Persistiendo importación…</p>
      )}

      {analysis && (phase === 'review' || phase === 'done') && (
        <>
          <MetricsPanel analysis={analysis} />
          {analysis.parse.headerIssues.missing.length > 0 && (
            <div className="catalog__error" role="alert">
              Faltan encabezados requeridos:{' '}
              {analysis.parse.headerIssues.missing.join(', ')}.
            </div>
          )}
          <ScopePanel
            analysis={analysis}
            confirmedIds={confirmedIds}
            onToggle={togglePeriod}
          />
          {preview && <DiffPanel preview={preview} />}
          {analysis.parse.errors.length > 0 && (
            <ErrorsPanel analysis={analysis} />
          )}

          {phase === 'review' && (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <button
                className="btn btn-primary"
                onClick={() => void confirmImport()}
                disabled={
                  !configured ||
                  confirmedIds.size === 0 ||
                  analysis.parse.headerIssues.missing.length > 0
                }
                title={
                  confirmedIds.size === 0
                    ? 'Confirma al menos un periodo'
                    : undefined
                }
              >
                Confirmar e importar {confirmedIds.size} periodo(s)
              </button>
            </div>
          )}
        </>
      )}

      {batches.length > 0 && <HistoryPanel batches={batches} />}
    </>
  );
}

function buildWarnings(analysis: EkonFileAnalysis): string[] {
  const w: string[] = [];
  if (analysis.periods.gaps.length > 0) {
    w.push(`${analysis.periods.gaps.length} hueco(s) entre periodos.`);
  }
  if (analysis.periods.inconsistentPeriodIds.length > 0) {
    w.push(
      `Periodos con fechas incompatibles: ${analysis.periods.inconsistentPeriodIds.join(', ')}.`,
    );
  }
  if (analysis.metrics.conflicts > 0) {
    w.push(`${analysis.metrics.conflicts} asignación(es) en conflicto.`);
  }
  if (analysis.parse.headerIssues.unknown.length > 0) {
    w.push(
      `Encabezados desconocidos: ${analysis.parse.headerIssues.unknown.join(', ')}.`,
    );
  }
  return w;
}

function MetricsPanel({ analysis }: { analysis: EkonFileAnalysis }) {
  const m = analysis.metrics;
  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Alcance detectado</h2>
      <dl className="import__summary">
        <div>
          <dt>Filas leídas</dt>
          <dd>
            <strong>{m.totalRows}</strong>
          </dd>
        </div>
        <div>
          <dt>Válidas</dt>
          <dd>{m.validRows}</dd>
        </div>
        <div>
          <dt>Rechazadas</dt>
          <dd>{m.rejectedRows}</dd>
        </div>
        <div>
          <dt>Campañas Ekon</dt>
          <dd>{m.distinctCampaigns}</dd>
        </div>
        <div>
          <dt>Líneas/asignaciones</dt>
          <dd>{m.distinctLines}</dd>
        </div>
        <div>
          <dt>Determinantes</dt>
          <dd>{m.distinctDeterminantes}</dd>
        </div>
        <div>
          <dt>Periodos</dt>
          <dd>{m.periods}</dd>
        </div>
        <div>
          <dt>Cobertura</dt>
          <dd>
            {analysis.periods.coverage.min
              ? formatCivilString(analysis.periods.coverage.min)
              : '—'}
            {' – '}
            {analysis.periods.coverage.max
              ? formatCivilString(analysis.periods.coverage.max)
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Conflictos</dt>
          <dd>{m.conflicts}</dd>
        </div>
      </dl>
    </div>
  );
}

function ScopePanel({
  analysis,
  confirmedIds,
  onToggle,
}: {
  analysis: EkonFileAnalysis;
  confirmedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Confirmación de periodos</h2>
      <p className="import__note" style={{ marginTop: 0 }}>
        La app propone los periodos realmente presentes en el archivo. Confirma
        o desmarca los que quieras importar. Las ausencias solo se interpretan
        como <strong>No incluida</strong> dentro de este alcance.
      </p>
      {analysis.periods.gaps.length > 0 && (
        <p className="badge badge-warning">
          {analysis.periods.gaps.length} hueco(s) entre periodos detectados.
        </p>
      )}
      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Importar</th>
              <th>Periodo</th>
              <th>Inicio</th>
              <th>Fin</th>
            </tr>
          </thead>
          <tbody>
            {analysis.periods.periods.map((p) => (
              <tr key={p.idPeriodo}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Confirmar periodo ${p.idPeriodo}`}
                    checked={confirmedIds.has(p.idPeriodo)}
                    onChange={() => onToggle(p.idPeriodo)}
                  />
                </td>
                <td>{p.idPeriodo}</td>
                <td>{p.inicio ? formatCivilString(p.inicio) : '—'}</td>
                <td>{p.fin ? formatCivilString(p.fin) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DiffPanel({ preview }: { preview: DiffPreview }) {
  const c = preview.counts;
  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>Vista previa del diff</h2>
      <p className="import__note" style={{ marginTop: 0 }}>
        Comparación contra la última importación completada. No se escribe nada
        hasta confirmar.
      </p>
      <dl className="import__summary">
        <div>
          <dt>Nuevas</dt>
          <dd>
            <strong>{c.nueva}</strong>
          </dd>
        </div>
        <div>
          <dt>Modificadas</dt>
          <dd>{c.modificada}</dd>
        </div>
        <div>
          <dt>Sin cambios</dt>
          <dd>{c['sin-cambios']}</dd>
        </div>
        <div>
          <dt>No incluidas</dt>
          <dd>{c['no-incluida']}</dd>
        </div>
        <div>
          <dt>Restauradas</dt>
          <dd>{c.restaurada}</dd>
        </div>
        <div>
          <dt>Conflictos</dt>
          <dd>{c.conflicto}</dd>
        </div>
        <div>
          <dt>Resaltados</dt>
          <dd>{preview.highlights}</dd>
        </div>
      </dl>
    </div>
  );
}

function ErrorsPanel({ analysis }: { analysis: EkonFileAnalysis }) {
  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <h2 style={{ marginTop: 0 }}>
        Filas rechazadas ({analysis.parse.errors.length})
      </h2>
      <div
        className="diagnosis__table-wrap"
        style={{ maxHeight: 320, overflowY: 'auto' }}
      >
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Fila</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {analysis.parse.errors.slice(0, 200).map((e) => (
              <tr key={e.sourceRow}>
                <td>{e.sourceRow}</td>
                <td>{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryPanel({ batches }: { batches: EkonBatchSummary[] }) {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Historial de importaciones</h2>
      <div className="diagnosis__table-wrap">
        <table className="catalog__table">
          <thead>
            <tr>
              <th>Archivo</th>
              <th>Estado</th>
              <th>Periodos</th>
              <th>Nuevas</th>
              <th>Modif.</th>
              <th>No incl.</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {batches.slice(0, 50).map((b) => (
              <tr key={b.id}>
                <td>{b.fileName}</td>
                <td>{b.status}</td>
                <td>{b.confirmedPeriodIds.length}</td>
                <td>{b.totals.nuevas}</td>
                <td>{b.totals.modificadas}</td>
                <td>{b.totals.noIncluidas}</td>
                <td>{new Date(b.createdAt).toLocaleString('es-MX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
