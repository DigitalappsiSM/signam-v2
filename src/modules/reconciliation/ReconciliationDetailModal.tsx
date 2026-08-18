import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { reconciliationStatusLabel } from '@/domain/ekon';
import type {
  StoreReconciliationDetail,
  StoreReconciliationStatus,
} from '@/domain/ekon';
import { formatCivilString } from '@/modules/operational-tracking/businessDays';
import type { ReconciliationRow } from './reconciliationView';

type StoreFilter = StoreReconciliationStatus | 'all';

interface Props {
  row: ReconciliationRow;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

/** Detalle operativo de conciliación, sin escrituras ni correcciones automáticas. */
export function ReconciliationDetailModal({
  row,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: Props) {
  const r = row.result;
  const differences = r.stores.details.filter(
    (store) => store.status !== 'matched',
  );
  const hasStoreSupportMismatch = differences.some(
    (store) => store.status === 'support-mismatch',
  );
  const copyableCampaignIssues = r.issues.filter(
    (issue) =>
      issue.code !== 'diferencia-tiendas' &&
      issue.code !== 'diferencia-tienda-soporte' &&
      !(
        hasStoreSupportMismatch &&
        (issue.code === 'circuito-no-compatible' ||
          issue.code === 'soporte-liverpool-sin-circuito')
      ),
  );
  const [scope, setScope] = useState<'differences' | 'all'>(
    differences.length > 0 ? 'differences' : 'all',
  );
  const [filter, setFilter] = useState<StoreFilter>('all');
  const [search, setSearch] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );

  useEffect(() => {
    setScope(differences.length > 0 ? 'differences' : 'all');
    setFilter('all');
    setSearch('');
    setCopyState('idle');
  }, [row.campaign.id, differences.length]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const visibleStores = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    return r.stores.details.filter((store) => {
      if (scope === 'differences' && store.status === 'matched') return false;
      if (filter !== 'all' && store.status !== filter) return false;
      if (!needle) return true;
      return [
        store.storeNumber,
        ...store.liverpool.names,
        ...store.liverpool.supports,
        ...store.ekon.names,
        ...store.ekon.circuits,
      ]
        .join(' ')
        .toLocaleLowerCase('es')
        .includes(needle);
    });
  }, [filter, r.stores.details, scope, search]);

  const copyDifferences = async () => {
    const lines = [
      [
        'Campaña',
        'Número Ekon',
        'Tienda',
        'Liverpool / SIGNAM',
        'Ekon',
        'Motivo',
      ].join('\t'),
      ...differences.map((store) =>
        [
          row.campaign.name,
          row.ekonNumber,
          store.storeNumber,
          sourceText(store.liverpool.names, store.liverpool.supports),
          sourceText(store.ekon.names, store.ekon.circuits),
          storeReason(store),
        ].join('\t'),
      ),
      ...copyableCampaignIssues.map((issue) =>
        [row.campaign.name, row.ekonNumber, '—', '—', '—', issue.message].join(
          '\t',
        ),
      ),
    ];
    try {
      await copyText(lines.join('\n'));
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <div
      className="recon-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recon-detail-title"
    >
      <div
        className="recon-modal__backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <section className="recon-modal__card">
        <header className="recon-modal__header">
          <div>
            <h2 id="recon-detail-title">{row.campaign.name}</h2>
            <p>
              Ekon {row.ekonNumber} ·{' '}
              {formatCivilString(row.campaign.fechaInicio)} –{' '}
              {formatCivilString(row.campaign.fechaFin)}
            </p>
          </div>
          <button
            type="button"
            className="recon-modal__close"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            ✕
          </button>
        </header>

        <div className="recon-modal__summary">
          <span className={`badge ${statusTone(r.status)}`}>
            {reconciliationStatusLabel(r.status)}
          </span>
          <span>
            Conciliadas:{' '}
            <strong>{countStatus(r.stores.details, 'matched')}</strong>
          </span>
          <span>
            Solo Liverpool:{' '}
            <strong>{countStatus(r.stores.details, 'liverpool-only')}</strong>
          </span>
          <span>
            Solo Ekon:{' '}
            <strong>{countStatus(r.stores.details, 'ekon-only')}</strong>
          </span>
          <span>
            Incompatibles:{' '}
            <strong>{countStatus(r.stores.details, 'support-mismatch')}</strong>
          </span>
        </div>

        {r.administrativeScope ? (
          <div className="recon-modal__empty">
            Centro Administrativo: la conciliación de tiendas no aplica.
          </div>
        ) : (
          <>
            <div className="recon-modal__toolbar">
              <div
                className="recon-tabs"
                role="group"
                aria-label="Alcance de tiendas"
              >
                <button
                  type="button"
                  className={scope === 'differences' ? 'is-active' : ''}
                  onClick={() => setScope('differences')}
                >
                  Diferencias de tiendas ({differences.length})
                </button>
                <button
                  type="button"
                  className={scope === 'all' ? 'is-active' : ''}
                  onClick={() => setScope('all')}
                >
                  Todas ({r.stores.details.length})
                </button>
              </div>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar tienda, soporte o circuito…"
                aria-label="Buscar en detalle"
              />
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as StoreFilter)
                }
                aria-label="Filtrar tiendas por resultado"
              >
                <option value="all">Todos los resultados</option>
                <option value="liverpool-only">Solo Liverpool</option>
                <option value="ekon-only">Solo Ekon</option>
                <option value="support-mismatch">Soporte incompatible</option>
                <option value="matched">Conciliadas</option>
              </select>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  differences.length + copyableCampaignIssues.length === 0
                }
                onClick={() => void copyDifferences()}
              >
                Copiar diferencias
              </button>
              <span className="recon-copy-status" role="status">
                {copyState === 'copied'
                  ? 'Copiadas'
                  : copyState === 'error'
                    ? 'No se pudo copiar'
                    : ''}
              </span>
            </div>

            <div className="recon-modal__table-wrap">
              <table className="catalog__table recon-store-table">
                <thead>
                  <tr>
                    <th>Tienda</th>
                    <th>Liverpool / SIGNAM</th>
                    <th>Ekon</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleStores.map((store) => (
                    <StoreRow key={store.storeNumber} store={store} />
                  ))}
                  {visibleStores.length === 0 && (
                    <tr>
                      <td colSpan={4} className="recon-modal__empty">
                        No hay tiendas para los filtros seleccionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {r.issues.length > 0 && (
          <div className="recon-modal__issues">
            <strong>Incidencias de campaña</strong>
            <ul>
              {r.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <footer className="recon-modal__footer">
          <div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!hasPrevious}
              onClick={onPrevious}
            >
              ← Campaña anterior
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={!hasNext}
              onClick={onNext}
            >
              Campaña siguiente →
            </button>
          </div>
          <div>
            <Link className="btn btn-secondary" to="/campanas">
              Ir a campañas
            </Link>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Cerrar
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function StoreRow({ store }: { store: StoreReconciliationDetail }) {
  return (
    <tr className={store.status === 'matched' ? '' : 'recon-store-row--issue'}>
      <td>
        <strong>#{store.storeNumber}</strong>
      </td>
      <td>
        <SourceCell
          present={store.liverpool.present}
          names={store.liverpool.names}
          values={store.liverpool.supports}
          unmatched={store.liverpool.unmatchedSupports}
        />
      </td>
      <td>
        <SourceCell
          present={store.ekon.present}
          names={store.ekon.names}
          values={store.ekon.circuits}
          unmatched={store.ekon.unmatchedCircuits}
        />
      </td>
      <td>
        <span className={`recon-result recon-result--${store.status}`}>
          {storeStatusLabel(store.status)}
        </span>
        {store.status !== 'matched' && (
          <small className="recon-store-reason">{storeReason(store)}</small>
        )}
      </td>
    </tr>
  );
}

function SourceCell({
  present,
  names,
  values,
  unmatched,
}: {
  present: boolean;
  names: string[];
  values: string[];
  unmatched: string[];
}) {
  if (!present)
    return <span className="recon-source-missing">— No incluida</span>;
  return (
    <div className="recon-source">
      {names.length > 0 && <span>{names.join(' · ')}</span>}
      <div className="recon-source__tags">
        {values.map((value) => (
          <span
            key={value}
            className={unmatched.includes(value) ? 'is-unmatched' : ''}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function storeStatusLabel(status: StoreReconciliationStatus): string {
  switch (status) {
    case 'matched':
      return 'Conciliada';
    case 'liverpool-only':
      return 'Falta en Ekon';
    case 'ekon-only':
      return 'Falta en Liverpool';
    case 'support-mismatch':
      return 'Soporte incompatible';
  }
}

function storeReason(store: StoreReconciliationDetail): string {
  if (store.status === 'liverpool-only')
    return 'La tienda sólo existe en Liverpool.';
  if (store.status === 'ekon-only') return 'La tienda sólo existe en Ekon.';
  if (store.status === 'matched')
    return 'Todos los soportes y circuitos coinciden.';
  const parts: string[] = [];
  if (store.liverpool.unmatchedSupports.length > 0) {
    parts.push(
      `Sin circuito Ekon: ${store.liverpool.unmatchedSupports.join(', ')}`,
    );
  }
  if (store.ekon.unmatchedCircuits.length > 0) {
    parts.push(
      `Sin soporte Liverpool: ${store.ekon.unmatchedCircuits.join(', ')}`,
    );
  }
  return parts.join(' · ');
}

function sourceText(names: string[], values: string[]): string {
  if (names.length === 0 && values.length === 0) return 'No incluida';
  return [...names, ...values].join(' · ');
}

function countStatus(
  stores: StoreReconciliationDetail[],
  status: StoreReconciliationStatus,
): number {
  return stores.filter((store) => store.status === status).length;
}

function statusTone(status: ReconciliationRow['result']['status']): string {
  if (status === 'conciliada' || status === 'centro-administrativo')
    return 'badge-success';
  if (status === 'conciliada-con-advertencias') return 'badge-warning';
  return 'badge-danger';
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard no disponible.');
}
