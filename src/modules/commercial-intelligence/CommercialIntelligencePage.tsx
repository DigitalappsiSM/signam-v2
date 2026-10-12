import { useState, type FormEvent } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  getQuividiCommercialAudit,
  type QuividiCommercialAuditResult,
} from '@/services/quividi';
import {
  consistencyLabel,
  statusLabel,
  zoneSplitLabel,
} from './commercialAuditView';
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
  const [storeNumber, setStoreNumber] = useState('');
  const [support, setSupport] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuividiCommercialAuditResult | null>(
    null,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (
      !storeNumber.trim() ||
      !support.trim() ||
      !isIsoDate(startDate) ||
      !isIsoDate(endDate) ||
      endDate < startDate
    ) {
      setError('Captura tienda, soporte y un rango de fechas válido.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const audit = await getQuividiCommercialAudit({
        storeNumber: storeNumber.trim(),
        support: support.trim(),
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
          <span className="text-muted">Tienda (Numero de Tienda)</span>
          <input
            value={storeNumber}
            onChange={(e) => setStoreNumber(e.target.value)}
            placeholder="199"
          />
        </label>
        <label>
          <span className="text-muted">Soporte</span>
          <input
            value={support}
            onChange={(e) => setSupport(e.target.value)}
            placeholder="BANNER DIGITAL"
          />
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
                      {day.raw.map((point) => (
                        <span key={point.locationId}>
                          {point.pointId ?? `Location ${point.locationId}`}:{' '}
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
