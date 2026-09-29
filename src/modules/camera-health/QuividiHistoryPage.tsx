import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import {
  assignQuividiHistoryBinding,
  getQuividiHistoryOverview,
  startQuividiHistory,
  type QuividiHistoryOverview,
} from '@/services/quividi';
import './QuividiHistoryPage.css';

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

  const reload = useCallback(async () => {
    try {
      setOverview(await getQuividiHistoryOverview());
      setError('');
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo consultar el histórico.',
      );
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    if (!overview?.started) return;
    const timer = window.setInterval(() => {
      void reload();
    }, 30_000);
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
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo iniciar la carga.',
      );
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
      setNotice(
        'Asociación guardada. Los datos descargados se están vinculando a la tienda y soporte.',
      );
      await reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo conciliar la cámara.',
      );
    } finally {
      setBusy(false);
    }
  }

  const selected = overview?.locations.find(
    (item) => item.id === Number(locationId),
  );
  const selectedStore = overview?.stores?.find(
    (item) => item.storeId === storeId,
  );
  const pendingLocations =
    overview?.locations.filter((item) => item.hasPendingData) ?? [];
  const visibleLocations = showAllLocations
    ? (overview?.locations ?? [])
    : pendingLocations;

  useEffect(() => {
    if (
      !showAllLocations &&
      locationId &&
      !overview?.locations.some(
        (item) => item.id === Number(locationId) && item.hasPendingData,
      )
    ) {
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
        description="Network 3089. Cada cámara conserva su medición original; la tienda se asigna con vigencia comprobada."
      />
      {error && (
        <p className="quividi-history__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="quividi-history__notice" role="status">
          {notice}
        </p>
      )}

      {!overview ? (
        <p>Cargando estado del histórico…</p>
      ) : (
        <>
          <section className="quividi-history__panel">
            <h2>Carga histórica</h2>
            <p>
              Se consulta desde el 1 de enero de 2026. Para cada location, el
              histórico medido empieza en su primer día con datos; las
              respuestas anteriores vacías no cuentan como medición faltante. La
              captura diaria continúa automáticamente.
            </p>
            {!overview.started ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void start()}
              >
                {busy ? 'Verificando network…' : 'Iniciar carga de Liverpool'}
              </button>
            ) : (
              <div className="quividi-history__metrics">
                <span>
                  <strong>{overview.locations.length}</strong> locations
                </span>
                <span>
                  <strong>{overview.queued.toLocaleString('es-MX')}</strong>{' '}
                  consultas encoladas
                </span>
                <span>
                  <strong>{overview.completed.toLocaleString('es-MX')}</strong>{' '}
                  particiones guardadas
                </span>
                <span>
                  <strong>
                    {(overview.inferred ?? 0).toLocaleString('es-MX')}
                  </strong>{' '}
                  particiones asociadas por catálogo (inferidas)
                </span>
                <span>
                  <strong>
                    {overview.needsReview.toLocaleString('es-MX')}
                  </strong>{' '}
                  particiones sin tienda
                </span>
                <span>
                  <strong>{pendingLocations.length}</strong> locations por
                  conciliar
                </span>
                <span>
                  <strong>
                    {overview.unsupported.toLocaleString('es-MX')}
                  </strong>{' '}
                  consultas sin acceso o soporte
                </span>
                <span>
                  <strong>{overview.retrying.toLocaleString('es-MX')}</strong>{' '}
                  reintentando
                </span>
              </div>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => void reload()}
              disabled={busy}
            >
              Actualizar estado
            </button>
          </section>

          {overview.started && (
            <section className="quividi-history__panel">
              <h2>Conciliar tienda histórica</h2>
              <p>
                Por defecto se muestran solo las locations con al menos una
                partición de datos sin tienda. Las demás ya están asociadas o no
                tienen mediciones pendientes. Los números de arriba cuentan
                particiones por fecha, tipo y resolución; no cámaras. La
                importación continúa aunque pospongas esta conciliación.
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
                Mostrar todas las {overview.locations.length} locations para
                revisar o corregir una asociación
              </label>
              {!showAllLocations && pendingLocations.length === 0 && (
                <p role="status">
                  No hay locations con datos pendientes de tienda.
                </p>
              )}
              {visibleLocations.length > 0 && (
                <form
                  onSubmit={(event) => void assign(event)}
                  className="quividi-history__form"
                >
                  <label>
                    Location Quividi
                    <select
                      required
                      value={locationId}
                      onChange={(event) => selectLocation(event.target.value)}
                    >
                      <option value="">
                        Selecciona una location pendiente
                      </option>
                      {visibleLocations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label} · {item.id}
                          {showAllLocations
                            ? item.hasPendingData
                              ? ' · pendiente'
                              : ' · asociada/sin datos pendientes'
                            : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected && (
                    <p className="quividi-history__reference">
                      Catálogo actual: {selected.storeId ?? 'sin tienda'} ·{' '}
                      {selected.pointId ?? 'sin punto'}
                      {selected.validFrom
                        ? ` (observado desde ${selected.validFrom})`
                        : ''}
                      <br />
                      Primera medición encontrada:{' '}
                      {selected.firstMeasuredDate ?? 'aún sin datos medidos'}
                      {selected.storeId && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={useCurrentCatalog}
                        >
                          Copiar asignación actual
                        </button>
                      )}
                    </p>
                  )}
                  <label>
                    Tienda Liverpool
                    <select
                      required
                      value={storeId}
                      onChange={(event) => {
                        setStoreId(event.target.value);
                        setSupport('');
                        setPointId('');
                      }}
                    >
                      <option value="">Selecciona una tienda de Admira</option>
                      {(overview.stores ?? []).map((store) => (
                        <option key={store.storeId} value={store.storeId}>
                          {store.number} —{' '}
                          {store.name || 'Sin nombre en catálogo'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Soporte
                    <select
                      required
                      value={support}
                      disabled={!selectedStore}
                      onChange={(event) => {
                        setSupport(event.target.value);
                        setPointId('');
                      }}
                    >
                      <option value="">
                        Selecciona un soporte de esa tienda
                      </option>
                      {(selectedStore?.supports ?? []).map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p>
                    Si falta la tienda o el soporte, agrégalo al catálogo Admira
                    y vuelve a esta pantalla. La importación sigue aunque esta
                    cámara quede pendiente.
                  </p>
                  <label>
                    Punto SIGNAM (opcional)
                    <input
                      value={pointId}
                      onChange={(event) => setPointId(event.target.value)}
                      placeholder="LIV-007-MUPI-P1"
                    />
                  </label>
                  <label>
                    Desde (primera medición; ajustable si cambió de tienda)
                    <input
                      required
                      type="date"
                      value={validFrom}
                      onChange={(event) => setValidFrom(event.target.value)}
                    />
                  </label>
                  <label>
                    Hasta (opcional)
                    <input
                      type="date"
                      value={validTo}
                      onChange={(event) => setValidTo(event.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={
                      busy ||
                      !selectedStore?.supports.includes(support) ||
                      !locationId ||
                      !validFrom
                    }
                  >
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
