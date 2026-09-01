import { useState } from 'react';
import { LoadingState } from '@/components/LoadingState';
import type { AdmiraScreen } from '@/domain';
import {
  buildCatalogBlob,
  buildTemplateBlob,
  catalogExportFileName,
  TEMPLATE_FILE_NAME,
} from './masterExport';
import './CatalogPage.css';

/** Dispara la descarga de un `Blob` en el navegador. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Flujo de exportación del catálogo (operación inversa a importar el maestro):
 * descargar el catálogo actual en formato maestro `.xlsx`, o una plantilla con
 * los campos necesarios y su guía para quien no conoce el formato.
 */
export function MasterExportModal({
  screens,
  onClose,
}: {
  screens: readonly AdmiraScreen[];
  onClose: () => void;
}) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [includeMappingColumn, setIncludeMappingColumn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeCount = screens.filter((s) => s.metadata.active).length;
  const exportCount = includeInactive ? screens.length : activeCount;

  async function handleExportCatalog() {
    setBusy(true);
    setError(null);
    try {
      const blob = await buildCatalogBlob(screens, {
        includeInactive,
        includeMappingColumn,
      });
      download(blob, catalogExportFileName());
      onClose();
    } catch {
      setError(
        'No se pudo generar el archivo del catálogo. Inténtalo de nuevo.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleExportTemplate() {
    setBusy(true);
    setError(null);
    try {
      const blob = await buildTemplateBlob({ includeMappingColumn });
      download(blob, TEMPLATE_FILE_NAME);
      onClose();
    } catch {
      setError('No se pudo generar la plantilla. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Exportar catálogo"
    >
      <div className="modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="modal__card">
        <h2 className="modal__title">Exportar catálogo (.xlsx)</h2>

        {error && (
          <div className="catalog__error" role="alert">
            {error}
          </div>
        )}

        <p className="text-muted">
          Genera un archivo con la hoja <code>Consolidado</code> y los{' '}
          <strong>12 campos oficiales</strong> del maestro, en el mismo formato
          que la importación (puede volver a importarse). Los metadatos SIGNAM
          (estado, versión, autores, fechas) nunca se incluyen.
        </p>

        <fieldset className="import__mode">
          <legend>Opciones</legend>
          <label>
            <input
              type="checkbox"
              checked={includeInactive}
              disabled={busy}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            <span>
              Incluir pantallas <strong>inactivas</strong> (por defecto solo se
              exportan las activas).
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeMappingColumn}
              disabled={busy}
              onChange={(e) => setIncludeMappingColumn(e.target.checked)}
            />
            <span>
              Incluir la columna <strong>NORMALIZACIÓN LIVERPOOL</strong> (mapeo
              al calendario).
            </span>
          </label>
        </fieldset>

        <dl className="import__summary">
          <div>
            <dt>Pantallas a exportar</dt>
            <dd>
              <strong>{exportCount}</strong>
              {!includeInactive && screens.length > activeCount && (
                <span className="text-muted">
                  {' '}
                  (de {screens.length} en total)
                </span>
              )}
            </dd>
          </div>
        </dl>

        <p className="text-muted">
          ¿No conoces el formato? Descarga la <strong>plantilla</strong>: trae
          los encabezados, una fila de ejemplo y una hoja <em>Instrucciones</em>{' '}
          que describe cada campo.
        </p>

        {busy && (
          <LoadingState
            variant="process"
            title="Generando Excel…"
            description="Empaquetando el catálogo sin metadatos internos."
            compact
          />
        )}

        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cerrar
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleExportTemplate()}
            disabled={busy}
          >
            Descargar plantilla
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleExportCatalog()}
            disabled={busy || exportCount === 0}
          >
            {busy ? 'Generando…' : 'Exportar catálogo'}
          </button>
        </div>
      </div>
    </div>
  );
}
