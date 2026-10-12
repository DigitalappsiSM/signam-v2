import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  getQuividiCommercialAudit,
  type QuividiCommercialAuditResult,
} from '@/services/quividi';
import { listScreens } from '@/services/screens';
import type { AdmiraScreen } from '@/domain/models';
import {
  consistencyLabel,
  pointLabel,
  statusLabel,
  zoneSplitLabel,
} from './commercialAuditView';
import {
  COMMERCIAL_SUPPORTS,
  buildStoreOptions,
  filterStoreOptions,
  resolveStoreOption,
  type CommercialStoreOption,
  type CommercialSupport,
} from './storeOptions';
import './CommercialIntelligencePage.css';

function formatNumber(value: number): string {
  return new Intl.NumberFormat('es-MX').format(Math.round(value));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Inteligencia Comercial (Fase 3) — sub-fase 3a: visor de auditoría.
 *
 * Solo lectura: compara, para una Tienda+Soporte+rango de fechas, el crudo ya
 * guardado por Fase 2 contra el rollup comercial (`quividiCommercialDaily`) y,
 * si se indica una campaña, la cifra ya publicada por Fase 1. Nunca corrige
 * datos ni dispara alertas. El reporte builder y los agentes llegan en
 * sub-fases posteriores (ver docs/QUIVIDI_PHASE_3.md).
 */
export function CommercialIntelligencePage() {
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [support, setSupport] = useState<CommercialSupport>(
    COMMERCIAL_SUPPORTS[0],
  );
  const [storeQuery, setStoreQuery] = useState('');
  const [selectedStore, setSelectedStore] =
    useState<CommercialStoreOption | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuividiCommercialAuditResult | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    listScreens()
      .then((list) => {
        if (!cancelled) setScreens(list);
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogError(
            'No se pudo leer el Catálogo Admira para sugerir tiendas.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storeOptions = useMemo(
    () => buildStoreOptions(screens, support),
    [screens, support],
  );
  const suggestions = useMemo(
    () => filterStoreOptions(storeOptions, storeQuery),
    [storeOptions, storeQuery],
  );

  function selectStore(option: CommercialStoreOption) {
    setSelectedStore(option);
    setStoreQuery(option.label);
    setShowSuggestions(false);
    setActiveIndex(-1);
  }

  function handleStoreKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (suggestions.length === 0) return;
      event.preventDefault();
      setShowSuggestions(true);
      const down = event.key === 'ArrowDown';
      const last = suggestions.length - 1;
      setActiveIndex((current) => {
        // Sin opción activa: abajo va a la primera, arriba a la última.
        if (current < 0) return down ? 0 : last;
        return down
          ? (current + 1) % suggestions.length
          : (current - 1 + suggestions.length) % suggestions.length;
      });
    } else if (event.key === 'Enter') {
      const option = showSuggestions ? suggestions[activeIndex] : undefined;
      if (option) {
        // Enter elige la sugerencia activa en vez de enviar el formulario.
        event.preventDefault();
        selectStore(option);
      }
    } else if (event.key === 'Escape') {
      setShowSuggestions(false);
      setActiveIndex(-1);
    }
  }

  function changeSupport(next: CommercialSupport) {
    setSupport(next);
    if (!selectedStore) return;
    // Se reemplaza por la opción del nuevo soporte (que lleva SU nombre de
    // catálogo): conservar la anterior enviaría el soporte viejo. Si la tienda
    // no tiene cámara en el nuevo soporte, se limpia.
    const match = buildStoreOptions(screens, next).find(
      (option) => option.storeNumber === selectedStore.storeNumber,
    );
    setSelectedStore(match ?? null);
    setStoreQuery(match?.label ?? '');
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const store = selectedStore ?? resolveStoreOption(storeOptions, storeQuery);
    if (!store) {
      setError(
        `Elige una tienda con cámara Quividi en ${support} de la lista de sugerencias.`,
      );
      return;
    }
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) {
      setError('Captura un rango de fechas válido.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const audit = await getQuividiCommercialAudit({
        storeNumber: store.storeNumber,
        support: store.support,
        startDate,
        endDate,
        campaignId: campaignId.trim() || undefined,
      });
      setResult(audit);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo consultar la auditoría comercial.',
      );
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="commercial-intel">
      <PageHeader
        title="Inteligencia Comercial"
        description="Auditoría de consistencia entre el histórico Quividi guardado, la capa comercial derivada y el reporte por campaña de Fase 1. Solo lectura: no corrige datos ni dispara alertas."
      />

      {loading && (
        <LoadingOverlay
          title="Consultando auditoría comercial"
          description="Leyendo el histórico y el rollup ya guardados, sin llamar a Quividi."
        />
      )}

      <form className="commercial-intel__form" onSubmit={handleSubmit}>
        <label>
          <span className="text-muted">Soporte</span>
          <select
            value={support}
            onChange={(e) => changeSupport(e.target.value as CommercialSupport)}
          >
            {COMMERCIAL_SUPPORTS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="commercial-intel__store">
          <span className="text-muted">Tienda (nombre o número)</span>
          <input
            value={storeQuery}
            onChange={(e) => {
              setStoreQuery(e.target.value);
              setSelectedStore(null);
              setShowSuggestions(true);
              setActiveIndex(-1);
            }}
            onKeyDown={handleStoreKeyDown}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setShowSuggestions(false)}
            placeholder="Escribe el nombre de la tienda"
            role="combobox"
            aria-expanded={showSuggestions && suggestions.length > 0}
            aria-controls="commercial-intel-store-list"
            aria-autocomplete="list"
            aria-activedescendant={
              showSuggestions && activeIndex >= 0
                ? `commercial-intel-store-${activeIndex}`
                : undefined
            }
            autoComplete="off"
          />
          {showSuggestions && suggestions.length > 0 && (
            <ul
              id="commercial-intel-store-list"
              className="commercial-intel__suggestions"
              role="listbox"
            >
              {suggestions.map((option, index) => (
                <li
                  key={option.storeNumber}
                  id={`commercial-intel-store-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  // mousedown en vez de click: se dispara antes del blur del input.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectStore(option);
                  }}
                  // click: lo que disparan los lectores de pantalla al activar.
                  onClick={() => selectStore(option)}
                >
                  {option.label}
                </li>
              ))}
            </ul>
          )}
          {showSuggestions &&
            storeQuery.trim() !== '' &&
            suggestions.length === 0 && (
              <small className="commercial-intel__hint">
                Sin tiendas con cámara Quividi en {support} que coincidan.
              </small>
            )}
        </label>
        <label>
          <span className="text-muted">Desde</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted">Hasta</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted">Campaña Fase 1 (opcional)</span>
          <input
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            placeholder="ID de campaña con snapshot"
          />
        </label>
        <button type="submit" className="btn btn-primary">
          Auditar
        </button>
      </form>

      {catalogError && (
        <div className="commercial-intel__error" role="alert">
          {catalogError}
        </div>
      )}

      {error && (
        <div className="commercial-intel__error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <>
          <p className="text-muted commercial-intel__store-label">
            <strong>
              Tienda {result.storeNumber}
              {result.storeName ? ` — ${result.storeName}` : ''}
            </strong>{' '}
            · {result.support}
          </p>
          <div className="commercial-intel__table-wrap">
            <table className="commercial-intel__table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Crudo (por punto)</th>
                  <th>Comercial</th>
                  <th>Fase 1</th>
                  <th>Consistencia</th>
                </tr>
              </thead>
              <tbody>
                {result.days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>
                      {day.raw.length === 0 && (
                        <small>Sin puntos configurados</small>
                      )}
                      {day.raw.map((point, index) => (
                        <span key={point.locationId}>
                          {pointLabel(point.pointId, index)}:{' '}
                          {point.measured
                            ? `${formatNumber(point.ots)} OTS · ${formatNumber(point.watchers)} watchers`
                            : 'sin medición'}
                        </span>
                      ))}
                    </td>
                    <td>
                      {day.commercial ? (
                        <>
                          <span>
                            {formatNumber(day.commercial.publishedOts)} OTS
                            publicados ·{' '}
                            {formatNumber(day.commercial.publishedWatchers)}{' '}
                            watchers
                          </span>
                          <small>
                            Combinado: {formatNumber(day.commercial.ots)} OTS ·{' '}
                            {formatNumber(day.commercial.watchers)} watchers
                          </small>
                          <small>{statusLabel(day.commercial.status)}</small>
                          <small>
                            {zoneSplitLabel(day.commercial.zoneSplit)}
                          </small>
                        </>
                      ) : (
                        <small>Sin rollup guardado</small>
                      )}
                    </td>
                    <td>
                      {day.fase1 ? (
                        <>
                          <span>
                            {formatNumber(day.fase1.publishedOts)} OTS
                            publicados ·{' '}
                            {formatNumber(day.fase1.publishedWatchers)} watchers
                          </span>
                          <small>{zoneSplitLabel(day.fase1.zoneSplit)}</small>
                        </>
                      ) : (
                        <small>—</small>
                      )}
                    </td>
                    <td>
                      <span
                        className={`commercial-intel__flag commercial-intel__flag--${day.consistency}`}
                      >
                        {consistencyLabel(day.consistency)}
                      </span>
                    </td>
                  </tr>
                ))}
                {result.days.length === 0 && (
                  <tr>
                    <td colSpan={5} className="commercial-intel__empty">
                      Sin fechas en el rango seleccionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
