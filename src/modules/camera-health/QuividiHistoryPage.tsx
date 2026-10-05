import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import {
  assignQuividiHistoryBinding,
  exploreQuividiHistory,
  getQuividiHistoryOverview,
  startQuividiHistory,
  type QuividiHistoryExplorerResult,
  type QuividiHistoryOverview,
} from '@/services/quividi';
import './QuividiHistoryPage.css';

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function defaultExplorerRange(): { startDate: string; endDate: string } {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 6);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function csvCell(value: unknown): string {
  const text = displayValue(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

function downloadCsv(result: QuividiHistoryExplorerResult) {
  const columns = result.columns;
  const lines = [
    columns.map(csvCell).join(','),
    ...result.rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `quividi-signam_${result.startDate}_${result.endDate}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function QuividiHistoryPage() {
  const [overview, setOverview] = useState<QuividiHistoryOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [locationId, setLocationId] = useState('');
  const [storeId, setStoreId] = useState('');
  const [support, setSupport] = useState('');
  const [pointId, setPointId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validTo, setValidTo] = useState('');
  const [showAllLocations, setShowAllLocations] = useState(false);

  const initialRange = useMemo(defaultExplorerRange, []);
  const [explorerStart, setExplorerStart] = useState(initialRange.startDate);
  const [explorerEnd, setExplorerEnd] = useState(initialRange.endDate);
  const [explorerLocation, setExplorerLocation] = useState('');
  const [explorerType, setExplorerType] = useState('');
  const [explorerResolution, setExplorerResolution] = useState('');
  const [explorerStore, setExplorerStore] = useState('');
  const [explorerSupport, setExplorerSupport] = useState('');
  const [explorerStatus, setExplorerStatus] = useState('');
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [explorerError, setExplorerError] = useState('');
  const [explorer, setExplorer] = useState<QuividiHistoryExplorerResult | null>(null);

  const reload = useCallback(async () => {
    try {
      setOverview(await getQuividiHistoryOverview());
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo consultar el histórico.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!overview?.started) return;
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(timer);
  }, [overview?.started, reload]);

  async function start() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await startQuividiHistory();
      setNotice('Inventario verificado. La carga histórica quedó encolada.');
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo iniciar la carga.');
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!selectedStore || !selectedStore.supports.includes(support)) {
        throw new Error('Selecciona tienda y soporte del catálogo Admira.');
      }
      await assignQuividiHistoryBinding({
        locationId: Number(locationId),
        storeId,
        storeName: selectedStore.name,
        support,
        pointId: pointId.trim() || null,
        validFrom,
        validTo: validTo || null,
      });
      setNotice('Asociación guardada. Los datos descargados se están vinculando a la tienda y soporte.');
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo conciliar la cámara.');
    } finally {
      setBusy(false);
    }
  }

  async function runExplorer(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setExplorerBusy(true);
    setExplorerError('');
    try {
      const result = await exploreQuividiHistory({
        startDate: explorerStart,
        endDate: explorerEnd,
        ...(explorerLocation ? { locationId: Number(explorerLocation) } : {}),
        ...(explorerType ? { type: explorerType } : {}),
        ...(explorerResolution ? { resolution: explorerResolution } : {}),
        ...(explorerStore ? { storeId: explorerStore } : {}),
        ...(explorerSupport ? { support: explorerSupport } : {}),
        ...(explorerStatus ? { status: explorerStatus } : {}),
      });
      setExplorer(result);
    } catch (reason) {
      setExplorerError(reason instanceof Error ? reason.message : 'No se pudo consultar el histórico guardado.');
    } finally {
      setExplorerBusy(false);
    }
  }

  const selected = overview?.locations.find((item) => item.id === Number(locationId));
  const selectedStore = overview?.stores?.find((item) => item.storeId === storeId);
  const pendingLocations = overview?.locations.filter((item) => item.hasPendingData) ?? [];
  const visibleLocations = showAllLocations ? (overview?.locations ?? []) : pendingLocations;
  const rawColumns = explorer?.columns ?? [];

  useEffect(() => {
    if (!showAllLocations && locationId && !overview?.locations.some(
      (item) => item.id === Number(locationId) && item.hasPendingData,
    )) {
      setLocationId('');
    }
  }, [overview, showAllLocations, locationId]);

  function selectLocation(id: string) {
    setLocationId(id);
    const current = overview?.locations.find((item) => item.id === Number(id));
    setValidFrom(current?.firstMeasuredDate ?? '');
    setValidTo('');
    setStoreId(current?.storeId ?? '');
    setSupport(current?.support ?? '');
    setPointId(current?.pointId ?? '');
  }

  function useCurrentCatalog() {
    if (!selected?.storeId) return;
    setStoreId(selected.storeId);
    setSupport(selected.support);
    setPointId(selected.pointId ?? '');
  }

  return (
    <div className="quividi-history">
      <PageHeader
        title="Histórico Quividi · Liverpool"
        description="Network 3089. Control de ingestión, conciliación de cámaras y exploración de datos persistidos para cotejo contra VidiCenter."
      />

      {error && <p className="quividi-history__error" role="alert">{error}</p>}
      {notice && <p className="quividi-history__notice" role="status">{notice}</p>}

      {!overview ? (
        <p>Cargando estado del histórico…</p>
      ) : (
        <>
          <section className="quividi-history__panel">
            <h2>Carga histórica</h2>
            <p>
              El histórico se conserva por día, location, tipo de dato y resolución.
              La ingesta puede consultar Quividi en bloques mayores, pero el modelo persistido
              sigue siendo diario para permitir auditoría y conciliación exactas.
            </p>
            {!overview.started ? (
              <button className="btn btn-primary" disabled={busy} onClick={() => void start()}>
                {busy ? 'Verificando network…' : 'Iniciar carga de Liverpool'}
              </button>
            ) : (
              <div className="quividi-history__metrics">
                <span><strong>{overview.locations.length}</strong> locations</span>
                <span><strong>{overview.queued.toLocaleString('es-MX')}</strong> consultas encoladas</span>
                <span><strong>{overview.completed.toLocaleString('es-MX')}</strong> particiones guardadas</span>
                <span><strong>{(overview.inferred ?? 0).toLocaleString('es-MX')}</strong> asociadas por catálogo</span>
                <span><strong>{overview.needsReview.toLocaleString('es-MX')}</strong> sin tienda</span>
                <span><strong>{overview.unsupported.toLocaleString('es-MX')}</strong> sin acceso/soporte</span>
                <span><strong>{overview.retrying.toLocaleString('es-MX')}</strong> reintentando</span>
              </div>
            )}
            <button className="btn btn-secondary" onClick={() => void reload()} disabled={busy}>
              Actualizar estado
            </button>
          </section>

          {overview.started && (
            <section className="quividi-history__panel quividi-history__explorer">
              <div className="quividi-history__section-heading">
                <div>
                  <span>Conciliación</span>
                  <h2>Explorador de datos persistidos</h2>
                </div>
                <p>
                  Esta consulta lee Firestore/Storage de SIGNAM. No llama a la API de Quividi.
                  Las columnas originales se conservan tal cual; las columnas auxiliares de SIGNAM
                  comienzan con <code>_</code>.
                </p>
              </div>

              <form className="quividi-history__filters" onSubmit={(event) => void runExplorer(event)}>
                <label>
                  Desde
                  <input type="date" required value={explorerStart} onChange={(event) => setExplorerStart(event.target.value)} />
                </label>
                <label>
                  Hasta
                  <input type="date" required value={explorerEnd} onChange={(event) => setExplorerEnd(event.target.value)} />
                </label>
                <label>
                  Location
                  <select value={explorerLocation} onChange={(event) => setExplorerLocation(event.target.value)}>
                    <option value="">Todas</option>
                    {overview.locations.map((item) => (
                      <option key={item.id} value={item.id}>{item.label} · {item.id}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Tipo de dato
                  <select value={explorerType} onChange={(event) => setExplorerType(event.target.value)}>
                    <option value="">Todos</option>
                    {(explorer?.filters.types ?? []).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  Resolución
                  <select value={explorerResolution} onChange={(event) => setExplorerResolution(event.target.value)}>
                    <option value="">Todas</option>
                    {(explorer?.filters.resolutions ?? []).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  Tienda
                  <select value={explorerStore} onChange={(event) => setExplorerStore(event.target.value)}>
                    <option value="">Todas</option>
                    {(explorer?.filters.stores ?? []).map((item) => (
                      <option key={item.storeId} value={item.storeId}>
                        {item.storeId} · {item.storeName || 'Sin nombre'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Soporte
                  <select value={explorerSupport} onChange={(event) => setExplorerSupport(event.target.value)}>
                    <option value="">Todos</option>
                    {(explorer?.filters.supports ?? []).map((item) => <option key={item}>{item}</option>)}
                  </select>
                </label>
                <label>
                  Estado
                  <select value={explorerStatus} onChange={(event) => setExplorerStatus(event.target.value)}>
                    <option value="">Todos</option>
                    <option value="complete">Complete</option>
                    <option value="retrying">Retrying</option>
                    <option value="unsupported">Unsupported</option>
                  </select>
                </label>
                <button className="btn btn-primary" type="submit" disabled={explorerBusy}>
                  {explorerBusy ? 'Consultando histórico…' : 'Consultar histórico'}
                </button>
              </form>

              {explorerError && <p className="quividi-history__error" role="alert">{explorerError}</p>}

              {explorer && (
                <>
                  <div className="quividi-history__metrics">
                    <span><strong>{explorer.summary.partitions.toLocaleString('es-MX')}</strong> particiones</span>
                    <span><strong>{explorer.summary.complete.toLocaleString('es-MX')}</strong> completas</span>
                    <span><strong>{explorer.summary.sourceRows.toLocaleString('es-MX')}</strong> filas fuente</span>
                    <span><strong>{explorer.summary.locations}</strong> locations</span>
                    <span><strong>{explorer.summary.empty.toLocaleString('es-MX')}</strong> vacías</span>
                    <span><strong>{explorer.summary.retrying.toLocaleString('es-MX')}</strong> retrying</span>
                    <span><strong>{explorer.summary.unsupported.toLocaleString('es-MX')}</strong> unsupported</span>
                  </div>

                  {(explorer.summary.truncatedPartitions || explorer.truncatedRows) && (
                    <p className="quividi-history__warning">
                      La vista alcanzó el límite de seguridad de la consulta. Reduce el rango o aplica
                      filtros antes de exportar para una conciliación completa.
                    </p>
                  )}

                  <div className="quividi-history__export-row">
                    <div>
                      <strong>RAW disponible para cotejo</strong>
                      <span>{explorer.rows.length.toLocaleString('es-MX')} filas cargadas en la vista</span>
                    </div>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={explorer.rows.length === 0}
                      onClick={() => downloadCsv(explorer)}
                    >
                      Exportar CSV visible
                    </button>
                  </div>

                  <div className="quividi-history__table-wrap">
                    <table className="quividi-history__table">
                      <thead>
                        <tr>
                          <th>Fecha</th><th>Location</th><th>Tipo</th><th>Resolución</th>
                          <th>Estado</th><th>Filas</th><th>Tienda</th><th>Soporte</th><th>Hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {explorer.partitions.map((item) => (
                          <tr key={item.id}>
                            <td>{item.date}</td>
                            <td>{item.locationId}</td>
                            <td>{item.type}</td>
                            <td>{item.resolution}</td>
                            <td>{item.status}</td>
                            <td>{item.rowCount.toLocaleString('es-MX')}</td>
                            <td>{item.storeId ?? '—'}</td>
                            <td>{item.support ?? '—'}</td>
                            <td><code title={item.currentHash ?? ''}>{item.currentHash?.slice(0, 10) ?? '—'}</code></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <details className="quividi-history__raw" open={explorer.rows.length > 0 && explorer.rows.length <= 100}>
                    <summary>Detalle RAW ({explorer.rows.length.toLocaleString('es-MX')} filas)</summary>
                    {explorer.rows.length === 0 ? (
                      <p>No hay filas RAW para los filtros seleccionados.</p>
                    ) : (
                      <div className="quividi-history__table-wrap">
                        <table className="quividi-history__table quividi-history__table--raw">
                          <thead>
                            <tr>{rawColumns.map((column) => <th key={column}>{column}</th>)}</tr>
                          </thead>
                          <tbody>
                            {explorer.rows.map((row, index) => (
                              <tr key={index}>
                                {rawColumns.map((column) => <td key={column}>{displayValue(row[column])}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </details>
                </>
              )}
            </section>
          )}

          {overview.started && (
            <section className="quividi-history__panel">
              <h2>Conciliar tienda histórica</h2>
              <p>
                La importación continúa aunque una location quede pendiente de tienda. Usa esta sección
                para asignar evidencia histórica con vigencia sin modificar los valores medidos.
              </p>
              <label className="quividi-history__toggle">
                <input
                  type="checkbox"
                  checked={showAllLocations}
                  onChange={(event) => {
                    setShowAllLocations(event.target.checked);
                    setLocationId('');
                  }}
                />
                Mostrar todas las {overview.locations.length} locations
              </label>
              {!showAllLocations && pendingLocations.length === 0 && <p role="status">No hay locations con datos pendientes de tienda.</p>}
              {visibleLocations.length > 0 && (
                <form onSubmit={(event) => void assign(event)} className="quividi-history__form">
                  <label>
                    Location Quividi
                    <select required value={locationId} onChange={(event) => selectLocation(event.target.value)}>
                      <option value="">Selecciona una location</option>
                      {visibleLocations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} · {item.id}{showAllLocations ? (item.hasPendingData ? ' · pendiente' : ' · asociada') : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && (
                    <p className="quividi-history__reference">
                      Catálogo actual: {selected.storeId ?? 'sin tienda'} · {selected.pointId ?? 'sin punto'}<br />
                      Primera medición: {selected.firstMeasuredDate ?? 'aún sin datos medidos'}
                      {selected.storeId && (
                        <button type="button" className="btn btn-secondary" onClick={useCurrentCatalog}>
                          Copiar asignación actual
                        </button>
                      )}
                    </p>
                  )}
                  <label>
                    Tienda Liverpool
                    <select required value={storeId} onChange={(event) => {
                      setStoreId(event.target.value);
                      setSupport('');
                      setPointId('');
                    }}>
                      <option value="">Selecciona una tienda</option>
                      {(overview.stores ?? []).map((store) => (
                        <option key={store.storeId} value={store.storeId}>
                          {store.number} — {store.name || 'Sin nombre'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Soporte
                    <select required value={support} disabled={!selectedStore} onChange={(event) => {
                      setSupport(event.target.value);
                      setPointId('');
                    }}>
                      <option value="">Selecciona un soporte</option>
                      {(selectedStore?.supports ?? []).map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <label>
                    Punto SIGNAM (opcional)
                    <input value={pointId} onChange={(event) => setPointId(event.target.value)} placeholder="LIV-007-MUPI-P1" />
                  </label>
                  <label>
                    Desde
                    <input required type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} />
                  </label>
                  <label>
                    Hasta (opcional)
                    <input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} />
                  </label>
                  <button className="btn btn-primary" type="submit" disabled={
                    busy || !selectedStore?.supports.includes(support) || !locationId || !validFrom
                  }>
                    {busy ? 'Guardando…' : 'Guardar asignación histórica'}
                  </button>
                </form>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
