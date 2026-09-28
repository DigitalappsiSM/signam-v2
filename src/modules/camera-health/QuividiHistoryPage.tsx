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
  const [storeNumber, setStoreNumber] = useState('');
  const [storeName, setStoreName] = useState('');
  const [support, setSupport] = useState('');
  const [pointId, setPointId] = useState('');
  const [validFrom, setValidFrom] = useState('2026-01-01');
  const [validTo, setValidTo] = useState('');

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
      const storeId = `LIV-${storeNumber.trim().padStart(3, '0')}`;
      await assignQuividiHistoryBinding({
        locationId: Number(locationId),
        storeId,
        storeName,
        support,
        pointId: pointId.trim(),
        validFrom,
        validTo: validTo || null,
      });
      setNotice(
        'Vigencia guardada. SIGNAM está reasociando los índices; el RAW no cambia.',
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

  function selectLocation(id: string) {
    setLocationId(id);
    const current = overview?.locations.find((item) => item.id === Number(id));
    if (current?.validFrom) {
      const end = new Date(`${current.validFrom}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() - 1);
      setValidTo(end.toISOString().slice(0, 10));
    } else setValidTo('');
  }

  function useCurrentCatalog() {
    if (!selected?.storeId || !selected.pointId) return;
    setStoreNumber(selected.storeId.replace(/^LIV-/, ''));
    setStoreName(selected.storeName);
    setSupport(selected.support);
    setPointId(selected.pointId);
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
              Desde el 1 de enero de 2026 hasta el último día completo
              disponible. La captura diaria continúa automáticamente.
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
                    {overview.needsReview.toLocaleString('es-MX')}
                  </strong>{' '}
                  pendientes de tienda
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
                La asignación actual del catálogo es solo una referencia. Indica
                la tienda, el punto SIGNAM y las fechas que puedas comprobar.
                Los periodos sin evidencia permanecen pendientes.
              </p>
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
                    <option value="">Selecciona una cámara</option>
                    {overview.locations.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label} · {item.id}
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
                    {selected.storeId && selected.pointId && (
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
                  Número de tienda Liverpool
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]+"
                    value={storeNumber}
                    onChange={(event) => setStoreNumber(event.target.value)}
                    placeholder="007"
                  />
                </label>
                <label>
                  Nombre de tienda
                  <input
                    value={storeName}
                    onChange={(event) => setStoreName(event.target.value)}
                  />
                </label>
                <label>
                  Soporte
                  <input
                    required
                    value={support}
                    onChange={(event) => setSupport(event.target.value)}
                    placeholder="MEGA MUPI DIGITAL"
                  />
                </label>
                <label>
                  Punto SIGNAM
                  <input
                    required
                    value={pointId}
                    onChange={(event) => setPointId(event.target.value)}
                    placeholder="LIV-007-MUPI-P1"
                  />
                </label>
                <label>
                  Desde
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
                  disabled={busy}
                >
                  {busy ? 'Guardando…' : 'Guardar asignación histórica'}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
