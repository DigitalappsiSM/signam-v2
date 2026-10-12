import { useState } from 'react';
import {
  exportQuividiHistoryCoverage,
  scanQuividiHistoryGaps,
  type QuividiHistoryGapResult,
} from '@/services/quividi';
import { gapResultSummary, previousMonth, totalGaps } from './historyGapsView';

function downloadText(fileName: string, text: string) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Huecos del histórico (solo admin, igual que el resto de la página):
 * revisar un mes no consume API; «Recargar faltantes» vuelve a pedir a
 * Quividi solo lo que falta, lo que no terminó y lo guardado vacío en series
 * de medición. La revisión diaria automática cubre D-2…D-8.
 */
export function HistoryGapsPanel() {
  const [month, setMonth] = useState(() => previousMonth(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<QuividiHistoryGapResult | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo completar la acción.',
      );
    } finally {
      setBusy(false);
    }
  }

  const scan = () =>
    run(async () =>
      setResult(await scanQuividiHistoryGaps({ month, reload: false })),
    );

  const reload = () => {
    if (
      !window.confirm(
        `Se volverán a pedir a Quividi (API de pago) los huecos de ${month}. ¿Continuar?`,
      )
    ) {
      return;
    }
    void run(async () =>
      setResult(await scanQuividiHistoryGaps({ month, reload: true })),
    );
  };

  const coverage = () =>
    run(async () => {
      const { csv } = await exportQuividiHistoryCoverage(month);
      downloadText(`quividi-cobertura_${month}.csv`, csv);
    });

  return (
    <section className="quividi-history__panel">
      <div className="quividi-history__section-heading">
        <div>
          <span>Cobertura</span>
          <h2>Huecos del histórico</h2>
        </div>
        <p>
          Revisar no consume API. «Recargar faltantes» vuelve a pedir a Quividi
          solo lo que falta, lo que no terminó y lo guardado vacío en OTS,
          watchers y demografía. Cada día se revisan solos los últimos 7 días
          (D-2 a D-8).
        </p>
      </div>
      <div className="quividi-history__filters">
        <label>
          <span>Mes</span>
          <input
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void scan()}
          disabled={busy || !month}
        >
          Revisar huecos
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={reload}
          disabled={
            busy || !month || (result !== null && totalGaps(result) === 0)
          }
        >
          Recargar faltantes
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void coverage()}
          disabled={busy || !month}
        >
          Descargar cobertura (CSV)
        </button>
      </div>
      {busy && <p>Procesando…</p>}
      {error && (
        <p className="quividi-history__error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div role="status">
          <p>{gapResultSummary(result)}</p>
          {result.datesWithMeasurementGaps.length > 0 && (
            <p>
              Días con huecos en OTS/watchers:{' '}
              {result.datesWithMeasurementGaps.join(', ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
