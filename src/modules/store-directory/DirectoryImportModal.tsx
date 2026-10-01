import { useState, type ChangeEvent } from 'react';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  buildDirectory,
  diffDirectory,
  readDirectorySheets,
  type DirectoryDiff,
  type DirectoryField,
  type DirectoryIssue,
} from '@/domain/stores';
import { readWorkbook } from '@/modules/admira-catalog/readWorkbook';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  saveStoreDirectory,
  type StoredDirectoryEntry,
} from '@/services/storeDirectory';

type Phase = 'select' | 'analyzing' | 'preview' | 'saving';

const FIELD_LABEL: Record<DirectoryField, string> = {
  name: 'nombre',
  status: 'estatus',
  street: 'calle',
  neighborhood: 'colonia',
  municipality: 'municipio',
  state: 'estado',
  zone: 'zona',
  postalCode: 'CP',
  lat: 'latitud',
  lng: 'longitud',
  coordinateSource: 'fuente GPS',
};

const ISSUE_PREVIEW = 12;

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: DirectoryIssue[];
  tone: 'blocking' | 'warning';
}) {
  if (issues.length === 0) return null;
  return (
    <div className={`import__issues import__issues--${tone}`}>
      <h3>
        {title} ({issues.length})
      </h3>
      <ul>
        {issues.slice(0, ISSUE_PREVIEW).map((i, n) => (
          <li key={n}>
            {i.storeNumber ? <strong>Tienda {i.storeNumber}: </strong> : null}
            {i.message}
            {i.row ? (
              <span className="text-muted">
                {' '}
                ({i.sheet}, fila {i.row})
              </span>
            ) : null}
          </li>
        ))}
        {issues.length > ISSUE_PREVIEW && (
          <li>…y {issues.length - ISSUE_PREVIEW} más.</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Importación del directorio de tiendas: uno o varios Excel (directorio de
 * Liverpool y/o archivo Ekon con la hoja «Centros») → vista previa con
 * diferencias e incidencias → confirmar → guardar solo nuevas y modificadas.
 */
export function DirectoryImportModal({
  actor,
  stored,
  onClose,
  onImported,
}: {
  actor: Actor;
  stored: readonly StoredDirectoryEntry[];
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>('select');
  const [files, setFiles] = useState<string[]>([]);
  const [diff, setDiff] = useState<DirectoryDiff | null>(null);
  const [issues, setIssues] = useState<DirectoryIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const list = [...(event.target.files ?? [])];
    if (list.length === 0) return;
    setFiles(list.map((f) => f.name));
    setError(null);
    setPhase('analyzing');
    try {
      const sheets = (
        await Promise.all(
          list.map(async (file) =>
            (await readWorkbook(file)).map((s) => ({
              name: list.length > 1 ? `${file.name} · ${s.name}` : s.name,
              rows: s.rows,
            })),
          ),
        )
      ).flat();
      const read = readDirectorySheets(sheets);
      const built = buildDirectory(read.rows);
      setIssues([...read.issues, ...built.issues]);
      setDiff(diffDirectory(stored, built.entries));
      setPhase('preview');
    } catch {
      setError('No se pudo leer el archivo. ¿Es un Excel (.xlsx) válido?');
      setPhase('select');
    }
  }

  async function handleConfirm() {
    if (!diff) return;
    setPhase('saving');
    try {
      const toSave = [...diff.created, ...diff.changed.map((c) => c.after)];
      const saved = await saveStoreDirectory(toSave, stored, actor);
      onImported(
        saved === 0
          ? 'El directorio ya estaba al día; no hubo cambios.'
          : `Directorio actualizado: ${diff.created.length} tiendas nuevas y ${diff.changed.length} modificadas.`,
      );
    } catch {
      setError(
        'No se pudo guardar el directorio. Verifica tu conexión y que las reglas de Firestore estén desplegadas.',
      );
      setPhase('preview');
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter(
    (i) => i.severity === 'warning' && i.code !== 'missing-coordinates',
  );
  const missingCoords = issues.filter((i) => i.code === 'missing-coordinates');
  const pending = diff ? diff.created.length + diff.changed.length : 0;
  const nothingRead =
    diff !== null &&
    diff.created.length + diff.changed.length + diff.unchanged.length === 0;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Importar directorio de tiendas"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card store-dir__import">
        <h2 className="modal__title">Importar directorio de tiendas</h2>
        {error && (
          <div className="catalog__error" role="alert">
            {error}
          </div>
        )}

        {phase === 'select' && (
          <>
            <p className="text-muted">
              Sube el directorio de Liverpool (número de sucursal, dirección,
              zona, estado y código postal) y, si lo tienes, el archivo Ekon con
              la hoja «Centros» para tomar latitud y longitud. Puedes elegir
              ambos a la vez.
            </p>
            <input
              type="file"
              accept=".xlsx"
              multiple
              aria-label="Archivos Excel del directorio"
              onChange={(e) => void handleFiles(e)}
            />
          </>
        )}

        {phase === 'analyzing' && (
          <LoadingOverlay
            variant="process"
            title="Analizando archivos…"
            description={files.join(', ')}
          />
        )}

        {(phase === 'preview' || phase === 'saving') && diff && (
          <>
            <dl className="import__summary">
              <div>
                <dt>Nuevas</dt>
                <dd>{diff.created.length}</dd>
              </div>
              <div>
                <dt>Con cambios</dt>
                <dd>{diff.changed.length}</dd>
              </div>
              <div>
                <dt>Sin cambios</dt>
                <dd>{diff.unchanged.length}</dd>
              </div>
              <div>
                <dt>Guardadas que no vienen</dt>
                <dd>{diff.notInFile.length}</dd>
              </div>
            </dl>

            {diff.notInFile.length > 0 && (
              <p className="import__note">
                {diff.notInFile.length} tiendas guardadas no vienen en el
                archivo; se conservan sin cambios. Para sacar una tienda de
                operación, márcala como inactiva.
              </p>
            )}

            {diff.changed.length > 0 && (
              <div className="store-dir__changes">
                <h3>Cambios</h3>
                <ul>
                  {diff.changed.slice(0, ISSUE_PREVIEW).map((c) => (
                    <li key={c.storeNumber}>
                      <strong>
                        {c.storeNumber} · {c.after.name || c.before.name}
                      </strong>
                      : {c.fields.map((f) => FIELD_LABEL[f]).join(', ')}
                    </li>
                  ))}
                  {diff.changed.length > ISSUE_PREVIEW && (
                    <li>…y {diff.changed.length - ISSUE_PREVIEW} más.</li>
                  )}
                </ul>
              </div>
            )}

            <IssueList title="Filas omitidas" issues={errors} tone="blocking" />
            <IssueList
              title="Revisar en el Excel"
              issues={warnings}
              tone="warning"
            />
            {missingCoords.length > 0 && (
              <p className="text-muted">
                {missingCoords.length} tiendas activas quedan sin coordenadas;
                el mapa las ubicará por municipio hasta que se capturen.
              </p>
            )}
            {nothingRead ? (
              <p className="import__note">
                No se encontró ninguna tienda en los archivos.
              </p>
            ) : (
              pending === 0 && (
                <p className="import__ok">
                  El directorio ya coincide con los archivos.
                </p>
              )
            )}
          </>
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={phase === 'saving'}
          >
            {pending === 0 && phase === 'preview' ? 'Cerrar' : 'Cancelar'}
          </button>
          {phase !== 'select' && phase !== 'analyzing' && pending > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleConfirm()}
              disabled={phase === 'saving'}
            >
              {phase === 'saving' ? 'Guardando…' : `Guardar ${pending} tiendas`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
