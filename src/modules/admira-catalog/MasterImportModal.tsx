import { useState, type ChangeEvent } from 'react';
import { importMasterScreens } from '@/services/screens';
import { analyzeMaster, type MasterAnalysis } from './masterImport';
import { readWorkbook } from './readWorkbook';
import type { Actor } from './screenFactory';
import './CatalogPage.css';

type Phase = 'select' | 'analyzing' | 'preview' | 'importing';

/**
 * Flujo de importación del maestro (.xlsx): seleccionar archivo → analizar y
 * previsualizar (con incidencias) → confirmar → guardar en Firestore.
 */
export function MasterImportModal({
  actor,
  existingCount,
  onClose,
  onImported,
}: {
  actor: Actor;
  existingCount: number;
  onClose: () => void;
  onImported: (created: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>('select');
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<MasterAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPhase('analyzing');
    try {
      const sheets = await readWorkbook(file);
      setAnalysis(analyzeMaster(sheets));
      setPhase('preview');
    } catch {
      setError('No se pudo leer el archivo. ¿Es un Excel (.xlsx) válido?');
      setPhase('select');
    }
  }

  async function handleConfirm() {
    if (!analysis || !analysis.detectedSheet) return;
    setPhase('importing');
    setError(null);
    try {
      const created = await importMasterScreens(
        analysis.rows,
        { fileName, sheet: analysis.detectedSheet },
        actor,
      );
      onImported(created);
    } catch {
      setError('No se pudieron guardar las pantallas. Inténtalo de nuevo.');
      setPhase('preview');
    }
  }

  const blocking =
    analysis?.issues.filter((i) => i.severity === 'blocking') ?? [];
  const warnings =
    analysis?.issues.filter((i) => i.severity === 'warning') ?? [];

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Importar maestro"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card">
        <h2 className="modal__title">Importar maestro (.xlsx)</h2>

        {error && (
          <div className="catalog__error" role="alert">
            {error}
          </div>
        )}

        {phase === 'select' && (
          <>
            <p className="text-muted">
              Selecciona el archivo <strong>MAESTRO</strong>. Se detectará la
              hoja <code>Consolidado</code>, se validarán los encabezados y
              verás una vista previa antes de guardar.
            </p>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void handleFile(e)}
            />
          </>
        )}

        {phase === 'analyzing' && (
          <p className="text-muted">Analizando archivo…</p>
        )}

        {phase === 'preview' && analysis && (
          <>
            <dl className="import__summary">
              <div>
                <dt>Archivo</dt>
                <dd>{fileName}</dd>
              </div>
              <div>
                <dt>Hoja detectada</dt>
                <dd>{analysis.detectedSheet ?? '—'}</dd>
              </div>
              <div>
                <dt>Fila de encabezados</dt>
                <dd>{analysis.headerRow ?? '—'}</dd>
              </div>
              <div>
                <dt>Pantallas detectadas</dt>
                <dd>
                  <strong>{analysis.rows.length}</strong>
                </dd>
              </div>
            </dl>

            {existingCount > 0 && (
              <div className="import__note">
                El catálogo ya tiene <strong>{existingCount}</strong> pantallas.
                La importación <strong>agrega</strong> las nuevas (no reemplaza
                ni elimina las existentes).
              </div>
            )}

            {blocking.length > 0 && (
              <div className="import__issues import__issues--blocking">
                <h3>Errores que impiden importar</h3>
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

            {analysis.ok && blocking.length === 0 && (
              <p className="import__ok">
                Todo listo para importar {analysis.rows.length} pantallas.
              </p>
            )}
          </>
        )}

        {phase === 'importing' && (
          <p className="text-muted">Guardando pantallas en la base de datos…</p>
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={phase === 'importing'}
          >
            Cerrar
          </button>
          {phase === 'preview' && analysis?.ok && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleConfirm()}
            >
              Confirmar importación
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
