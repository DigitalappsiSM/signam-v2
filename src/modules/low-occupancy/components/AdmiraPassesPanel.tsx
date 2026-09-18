import { useEffect, useMemo, useRef, useState } from 'react';
import { LoadingOverlay } from '@/components/LoadingOverlay';
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

/** Tarjetas del semáforo: nunca solo color (llevan símbolo + texto + cifra). */
const SEMAPHORE: {
  level: AdmiraRiskLevel;
  label: string;
  icon: string;
  hint: string;
}[] = [
  {
    level: 'critical',
    label: 'Críticos',
    icon: '▲',
    hint: 'Repetición alta o entrega mínima',
  },
  {
    level: 'warning',
    label: 'Alertas',
    icon: '△',
    hint: 'Variedad limitada por revisar',
  },
  {
    level: 'healthy',
    label: 'Saludables',
    icon: '✓',
    hint: 'Variedad suficiente',
  },
];

/** Etiqueta del estado global del reporte (pill del encabezado). */
const STATUS_LABEL: Record<AdmiraRiskLevel, string> = {
  critical: 'Requiere acción',
  warning: 'Con alertas',
  healthy: 'Saludable',
};

/** Icono decorativo del encabezado (pantalla/monitor). No aporta significado. */
function PanelIcon() {
  return (
    <svg
      className="occ-admira__banner-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M6.5 13l3-3 2.2 2.2L16 8" />
    </svg>
  );
}

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
  // Tarjeta del semáforo desplegada (acordeón). Solo una abierta a la vez.
  const [openLevel, setOpenLevel] = useState<AdmiraRiskLevel | null>(null);
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
  const unitsByLevel = useMemo(
    () => ({
      critical: units.filter((unit) => unit.level === 'critical'),
      warning: units.filter((unit) => unit.level === 'warning'),
      healthy: units.filter((unit) => unit.level === 'healthy'),
    }),
    [units],
  );
  const summary = useMemo(
    () => ({
      total: units.length,
      critical: unitsByLevel.critical.length,
      warning: unitsByLevel.warning.length,
      healthy: unitsByLevel.healthy.length,
      missingPlayers: units.filter((unit) => unit.catalogMatch !== 'exact')
        .length,
    }),
    [units, unitsByLevel],
  );
  // Estado global del reporte: manda el nivel más severo con unidades.
  const globalStatus: AdmiraRiskLevel =
    summary.critical > 0
      ? 'critical'
      : summary.warning > 0
        ? 'warning'
        : 'healthy';

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLoading('import');
    setError(null);
    setDetail(null);
    setOpenLevel(null);
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
      <div
        className={`occ-admira__banner occ-admira__banner--${stored && analysis ? globalStatus : 'neutral'}`}
      >
        <div className="occ-admira__banner-main">
          <span className="occ-admira__banner-badge" aria-hidden="true">
            <PanelIcon />
          </span>
          <div className="occ-admira__banner-copy">
            <h2 id="occ-admira-title" className="occ-admira__banner-title">
              Diagnóstico del reporte Admira
            </h2>
            <p className="text-muted occ-admira__description">
              Analiza la programación real por player y fecha. Ratio 1 se revisa
              por separado; si no existe, se evalúa la variedad de Ratio 3. El
              último resultado queda disponible para consulta.
            </p>
          </div>
        </div>
        <div className="occ-admira__banner-actions">
          {stored && analysis && (
            <span
              className={`occ-admira__status-pill occ-admira__status-pill--${globalStatus}`}
            >
              <span className="occ-admira__status-dot" aria-hidden="true" />
              {STATUS_LABEL[globalStatus]}
              <span className="occ-admira__status-date">{analysisDate}</span>
            </span>
          )}
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
      </div>

      {loading && (
        <LoadingOverlay
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
                  setOpenLevel(null);
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

          {(summary.critical > 0 || summary.missingPlayers > 0) && (
            <div
              className={`occ-admira__alert occ-admira__alert--${summary.critical > 0 ? 'critical' : 'info'}`}
              role="status"
            >
              <span className="occ-admira__alert-icon" aria-hidden="true">
                {summary.critical > 0 ? '▲' : 'ℹ'}
              </span>
              <p className="occ-admira__alert-text">
                {summary.critical > 0 && (
                  <>
                    <strong>
                      {summary.critical}{' '}
                      {summary.critical === 1
                        ? 'player crítico'
                        : 'players críticos'}
                    </strong>{' '}
                    para {analysisDate}. Abre la tarjeta «Críticos» para ver el
                    detalle.
                  </>
                )}
                {summary.critical > 0 && summary.missingPlayers > 0 && ' '}
                {summary.missingPlayers > 0 && (
                  <>
                    {summary.missingPlayers}{' '}
                    {summary.missingPlayers === 1
                      ? 'player sin coincidencia exacta en catálogo'
                      : 'players sin coincidencia exacta en catálogo'}
                    .
                  </>
                )}
              </p>
            </div>
          )}

          <div
            className="occ-admira__summary"
            aria-label="Resumen del reporte Admira"
          >
            <div className="occ-sem-cards">
              {SEMAPHORE.map(({ level, label, icon, hint }) => {
                const count = summary[level];
                const open = openLevel === level;
                return (
                  <div
                    key={level}
                    className={`occ-sem-card occ-sem-card--${level}${open ? ' is-open' : ''}`}
                  >
                    <button
                      type="button"
                      className="occ-sem-card__head"
                      aria-expanded={open}
                      aria-controls={`occ-sem-panel-${level}`}
                      disabled={count === 0}
                      onClick={() => setOpenLevel(open ? null : level)}
                    >
                      <span className="occ-sem-card__icon" aria-hidden="true">
                        {icon}
                      </span>
                      <span className="occ-sem-card__count">{count}</span>
                      <span className="occ-sem-card__label">{label}</span>
                      <span className="occ-sem-card__hint">{hint}</span>
                      <span className="occ-sem-card__chev" aria-hidden="true">
                        {count === 0 ? '' : open ? '▲' : '▼'}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="occ-sem-meta">
              <div className="occ-sem-meta__item">
                <span className="occ-sem-meta__value">{summary.total}</span>
                <span className="occ-sem-meta__label">Players evaluados</span>
              </div>
              <div className="occ-sem-meta__item">
                <span
                  className={`occ-sem-meta__value${summary.missingPlayers > 0 ? ' occ-sem-meta__value--warn' : ''}`}
                >
                  {summary.missingPlayers}
                </span>
                <span className="occ-sem-meta__label">
                  Problemas de catálogo
                </span>
              </div>
            </div>
          </div>

          {SEMAPHORE.map(({ level, label }) => {
            const list = unitsByLevel[level];
            return (
              <div key={level}>
                {openLevel === level && (
                  <div
                    id={`occ-sem-panel-${level}`}
                    className="occ-sem-card__panel"
                    role="region"
                    aria-label={`Players ${label}`}
                  >
                    {list.length === 0 ? (
                      <p className="text-muted occ-sem-card__empty">
                        Sin players en este nivel.
                      </p>
                    ) : (
                      <ul className="occ-sem-list">
                        {list.map((unit) => (
                          <li key={unit.key}>
                            <button
                              type="button"
                              className="occ-sem-list__item"
                              onClick={() => setDetail(unit)}
                            >
                              <span className="occ-sem-list__player">
                                {unit.player}
                              </span>
                              <span className="occ-sem-list__store text-muted">
                                {unit.storeNumber || '—'}
                                {unit.storeName ? ` · ${unit.storeName}` : ''}
                              </span>
                              <span className="occ-sem-list__reason text-muted">
                                {unit.reasons.join(' ') || '—'}
                              </span>
                              <span
                                className="occ-sem-list__go"
                                aria-hidden="true"
                              >
                                Ver detalle →
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div
            className={`occ-admira__workspace${detail ? ' occ-admira__workspace--detail' : ''}`}
          >
            <div
              className="diagnosis__table-wrap"
              role="region"
              aria-label="Resultados del reporte Admira"
              tabIndex={0}
            >
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
                              <span>
                                {passes(content.passes)} pases por hora
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
