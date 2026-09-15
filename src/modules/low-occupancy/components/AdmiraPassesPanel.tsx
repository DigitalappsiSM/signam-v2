import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingState } from '@/components/LoadingState';
import type { AdmiraScreen } from '@/domain';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  getCurrentAdmiraPassAnalysis,
  saveCurrentAdmiraPassAnalysis,
  type StoredAdmiraPassAnalysis,
} from '@/services/admiraPassAnalysis';
import { analyzeAdmiraPasses } from '../admiraPasses';
import type { AdmiraPassAnalysisUnit, AdmiraRiskLevel } from '../admiraPasses';
import { readAdmiraPassesWorkbook } from '../readAdmiraPassesWorkbook';

const LEVEL_LABELS: Record<AdmiraRiskLevel, string> = {
  critical: 'Crítico',
  warning: 'Alerta',
  healthy: 'Saludable',
};

const CATALOG_LABELS: Record<AdmiraPassAnalysisUnit['catalogMatch'], string> = {
  exact: 'Exacto',
  duplicate: 'Duplicado',
  inactive: 'Inactivo',
  missing: 'Sin coincidencia',
};

function percentage(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function passes(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function dateTime(value: number): string {
  return value ? new Date(value).toLocaleString('es-MX') : '—';
}

export function AdmiraPassesPanel({
  screens,
  actor,
  analysisDate,
  onDateChange,
}: {
  screens: AdmiraScreen[];
  actor: Actor;
  analysisDate: string;
  onDateChange: (date: string) => void;
}) {
  const [stored, setStored] = useState<StoredAdmiraPassAnalysis | null>(null);
  const [loading, setLoading] = useState<'saved' | 'import' | null>('saved');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdmiraPassAnalysisUnit | null>(null);
  const initialAnalysisDate = useRef(analysisDate);

  useEffect(() => {
    let active = true;
    void getCurrentAdmiraPassAnalysis()
      .then((result) => {
        if (!active) return;
        setStored(result);
        const dates = result?.analysis.dates ?? [];
        const selectedDate = dates.includes(initialAnalysisDate.current)
          ? initialAnalysisDate.current
          : dates[0];
        if (selectedDate) onDateChange(selectedDate);
      })
      .catch(() => {
        if (active)
          setError('No se pudo cargar el último análisis guardado de Admira.');
      })
      .finally(() => {
        if (active) setLoading(null);
      });
    return () => {
      active = false;
    };
  }, [onDateChange]);

  const analysis = stored?.analysis ?? null;
  const units = useMemo(
    () => analysis?.units.filter((unit) => unit.date === analysisDate) ?? [],
    [analysis, analysisDate],
  );
  const summary = useMemo(
    () => ({
      total: units.length,
      critical: units.filter((unit) => unit.level === 'critical').length,
      warning: units.filter((unit) => unit.level === 'warning').length,
      healthy: units.filter((unit) => unit.level === 'healthy').length,
      missingPlayers: units.filter((unit) => unit.catalogMatch !== 'exact')
        .length,
    }),
    [units],
  );

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLoading('import');
    setError(null);
    setDetail(null);
    try {
      const result = await readAdmiraPassesWorkbook(file);
      if (result.headerRow === null || result.rows.length === 0) {
        throw new Error(
          result.issues[0]?.message || 'El archivo no tiene datos.',
        );
      }
      const nextAnalysis = analyzeAdmiraPasses(result.rows, screens);
      let saved: StoredAdmiraPassAnalysis;
      try {
        saved = await saveCurrentAdmiraPassAnalysis({
          fileName: file.name,
          sheetName: result.sheetName ?? '',
          validRows: result.rows.length,
          omittedRows: result.issues.length,
          playerCount: result.players.length,
          analysis: nextAnalysis,
          actor,
        });
      } catch {
        throw new Error(
          'El reporte se analizó, pero no se pudo guardar. El diagnóstico anterior continúa vigente.',
        );
      }
      setStored(saved);
      const nextDate = result.dates.includes(analysisDate)
        ? analysisDate
        : result.dates[0];
      if (nextDate) onDateChange(nextDate);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'No se pudo leer el reporte de Admira.',
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="occ-admira" aria-labelledby="occ-admira-title">
      <div className="occ-admira__head">
        <div>
          <h2 id="occ-admira-title" className="occ-section-title">
            Diagnóstico del reporte Admira
          </h2>
          <p className="text-muted occ-admira__description">
            Analiza la programación real por player y fecha. Ratio 1 se revisa
            por separado; si no existe, se evalúa la variedad de Ratio 3. El
            último resultado queda disponible para consulta.
          </p>
        </div>
        <label className="import-file">
          <span className="btn btn-primary">Importar y guardar reporte</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            hidden
            disabled={loading !== null}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
      </div>

      {loading && (
        <LoadingState
          variant={loading === 'import' ? 'import' : 'process'}
          title={
            loading === 'import'
              ? 'Analizando y guardando reporte Admira…'
              : 'Cargando el último análisis…'
          }
          description={
            loading === 'import'
              ? 'Cruzando players, fechas, ratios, campañas y pases.'
              : 'Recuperando el diagnóstico vigente para consulta.'
          }
          compact
        />
      )}
      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {!loading && !stored && !error && (
        <div className="card occ-admira__empty">
          <strong>Aún no hay un análisis guardado.</strong>
          <span className="text-muted">
            Importa el archivo de pases; el resultado reemplazará al anterior.
          </span>
        </div>
      )}

      {stored && analysis && (
        <>
          <div className="occ-admira__meta card">
            <div>
              <span className="text-muted">Archivo</span>
              <strong>{stored.metadata.fileName}</strong>
            </div>
            <div>
              <span className="text-muted">Hoja</span>
              <strong>{stored.metadata.sheetName || '—'}</strong>
            </div>
            <div>
              <span className="text-muted">Filas válidas</span>
              <strong>{stored.metadata.validRows}</strong>
            </div>
            <div>
              <span className="text-muted">Players</span>
              <strong>{stored.metadata.playerCount}</strong>
            </div>
            <div>
              <span className="text-muted">Fechas</span>
              <strong>{stored.metadata.dates.length}</strong>
            </div>
            <div>
              <span className="text-muted">Guardado</span>
              <strong>{dateTime(stored.metadata.createdAt)}</strong>
            </div>
            <div>
              <span className="text-muted">Importado por</span>
              <strong>{stored.metadata.createdByEmail || '—'}</strong>
            </div>
            <label>
              <span className="text-muted">Fecha analizada</span>
              <select
                aria-label="Fecha del reporte Admira"
                value={analysisDate}
                onChange={(event) => {
                  setDetail(null);
                  onDateChange(event.target.value);
                }}
              >
                {stored.metadata.dates.map((date) => (
                  <option key={date} value={date}>
                    {date}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {stored.metadata.omittedRows > 0 && (
            <div className="catalog__notice" role="status">
              {stored.metadata.omittedRows}{' '}
              {stored.metadata.omittedRows === 1
                ? 'fila fue omitida'
                : 'filas fueron omitidas'}{' '}
              por datos incompletos o inválidos.
            </div>
          )}

          <div
            className="occ-admira__summary"
            aria-label="Resumen del reporte Admira"
          >
            <div className="occ-admira__metric occ-admira__metric--critical">
              <strong>{summary.critical}</strong>
              <span>Críticos</span>
            </div>
            <div className="occ-admira__metric occ-admira__metric--warning">
              <strong>{summary.warning}</strong>
              <span>Alertas</span>
            </div>
            <div className="occ-admira__metric occ-admira__metric--healthy">
              <strong>{summary.healthy}</strong>
              <span>Saludables</span>
            </div>
            <div className="occ-admira__metric">
              <strong>{summary.total}</strong>
              <span>Players evaluados</span>
            </div>
            <div className="occ-admira__metric">
              <strong>{summary.missingPlayers}</strong>
              <span>Problemas de catálogo</span>
            </div>
          </div>

          <div className="diagnosis__table-wrap">
            <table className="catalog__table occ-admira__table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Tienda</th>
                  <th>Catálogo</th>
                  <th>R1</th>
                  <th>R3</th>
                  <th>Ratio evaluado</th>
                  <th>Mayor participación</th>
                  <th>Pases por contenido</th>
                  <th>Estado</th>
                  <th>Motivo</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <tr key={unit.key}>
                    <td>{unit.player}</td>
                    <td>
                      {unit.storeNumber || '—'}{' '}
                      {unit.storeName ? `· ${unit.storeName}` : ''}
                    </td>
                    <td>{CATALOG_LABELS[unit.catalogMatch]}</td>
                    <td>{unit.ratio1Contents.length}</td>
                    <td>{unit.ratio3Contents.length}</td>
                    <td>
                      {unit.evaluatedRatio
                        ? `Ratio ${unit.evaluatedRatio}`
                        : '—'}
                    </td>
                    <td>{percentage(unit.maximumShare)}</td>
                    <td>
                      {unit.contentCount
                        ? `${passes(unit.minimumPasses)}–${passes(unit.maximumPasses)}`
                        : '—'}
                    </td>
                    <td>
                      <span
                        className={`occ-admira__status occ-admira__status--${unit.level}`}
                      >
                        {LEVEL_LABELS[unit.level]}
                      </span>
                    </td>
                    <td>{unit.reasons.join(' ')}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => setDetail(unit)}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {detail && (
            <div className="card occ-admira__detail">
              <div className="occ-admira__detail-head">
                <div>
                  <h3>{detail.player}</h3>
                  <p className="text-muted">
                    {detail.date} ·{' '}
                    {detail.storeName || 'Tienda no identificada'}
                  </p>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => setDetail(null)}
                >
                  Cerrar
                </button>
              </div>
              {[detail.ratio1Contents, detail.ratio3Contents].map(
                (contents, index) => (
                  <div key={index} className="occ-admira__ratio-detail">
                    <h4>Publicidad Tipo {index === 0 ? '1' : '3'}</h4>
                    {contents.length === 0 ? (
                      <p className="text-muted">Sin contenidos.</p>
                    ) : (
                      <ul>
                        {contents.map((content) => (
                          <li key={content.key}>
                            <strong>{content.campaign}</strong>
                            <span>{content.content}</span>
                            <span>{passes(content.passes)} pases por hora</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
