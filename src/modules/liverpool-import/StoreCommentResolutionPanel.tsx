import { useMemo, useState } from 'react';
import type { AdmiraScreen } from '@/domain';
import type { AmbiguousStoreComment, StoreRef } from './campaignParse';
import {
  isStoreCommentResolutionComplete,
  storeOptionMatchesComment,
  storeOptionsForComment,
  type StoreCommentResolution,
  type StoreCommentResolutions,
  type StoreOption,
} from './storeCommentResolution';

interface Props {
  items: readonly AmbiguousStoreComment[];
  screens: readonly AdmiraScreen[];
  resolutions: StoreCommentResolutions;
  onChange: (
    id: string,
    resolution: StoreCommentResolution | undefined,
  ) => void;
}

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function toggleStore(
  stores: readonly StoreRef[],
  option: StoreOption,
  checked: boolean,
): StoreRef[] {
  if (checked) {
    return [
      ...stores.filter((store) => store.numero !== option.numero),
      { numero: option.numero, nombre: option.nombre },
    ];
  }
  return stores.filter((store) => store.numero !== option.numero);
}

function ResolutionItem({
  issue,
  screens,
  resolution,
  onChange,
}: {
  issue: AmbiguousStoreComment;
  screens: readonly AdmiraScreen[];
  resolution: StoreCommentResolution | undefined;
  onChange: (resolution: StoreCommentResolution | undefined) => void;
}) {
  const [search, setSearch] = useState('');
  const options = useMemo(
    () => storeOptionsForComment(issue, screens),
    [issue, screens],
  );
  const suggested = useMemo(
    () => options.filter((option) => storeOptionMatchesComment(issue, option)),
    [issue, options],
  );
  const filtered = useMemo(() => {
    const term = normalized(search.trim());
    return term === ''
      ? options
      : options.filter((option) => normalized(option.label).includes(term));
  }, [options, search]);
  const selected =
    resolution?.kind === 'selected' ? resolution.stores : ([] as StoreRef[]);
  const selectedNumbers = new Set(selected.map((store) => store.numero));
  const complete = isStoreCommentResolutionComplete(resolution);

  return (
    <article
      className={`store-resolution ${complete ? 'store-resolution--complete' : ''}`}
    >
      <div className="store-resolution__head">
        <div>
          <strong>{issue.campaignName}</strong>
          <div className="text-muted store-resolution__meta">
            {issue.sheet} · fila {issue.row} · celda {issue.address} ·{' '}
            {issue.support}
          </div>
        </div>
        <span
          className={`badge ${complete ? 'badge-success' : 'badge-warning'}`}
        >
          {complete ? 'Resuelto' : 'Pendiente'}
        </span>
      </div>

      <div className="store-resolution__comment">
        Comentario original: <strong>{issue.comment}</strong>
      </div>

      <label className="store-resolution__mode">
        <span>Alcance correcto</span>
        <select
          className="catalog__search"
          aria-label={`Resolver comentario ${issue.address} de ${issue.campaignName}`}
          value={resolution?.kind ?? ''}
          onChange={(event) => {
            if (event.target.value === 'all') onChange({ kind: 'all' });
            else if (event.target.value === 'selected') {
              onChange({ kind: 'selected', stores: [] });
            } else onChange(undefined);
          }}
        >
          <option value="">Selecciona…</option>
          <option value="selected">Tiendas específicas</option>
          <option value="all">Todas las tiendas del soporte</option>
        </select>
      </label>

      {resolution?.kind === 'selected' && (
        <div className="store-resolution__picker">
          <div className="store-resolution__picker-head">
            <label>
              <span>Buscar en el catálogo</span>
              <input
                className="catalog__search"
                type="search"
                value={search}
                placeholder="Número o nombre de tienda"
                aria-label={`Buscar tiendas para ${issue.address}`}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <span className="text-muted">
              {selected.length} seleccionada{selected.length === 1 ? '' : 's'}
            </span>
          </div>

          {suggested.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary store-resolution__suggest"
              onClick={() =>
                onChange({
                  kind: 'selected',
                  stores: suggested.map(({ numero, nombre }) => ({
                    numero,
                    nombre,
                  })),
                })
              }
            >
              Seleccionar {suggested.length}{' '}
              {suggested.length === 1
                ? 'coincidencia sugerida'
                : 'coincidencias sugeridas'}
            </button>
          )}

          {options.length === 0 ? (
            <div className="catalog__error" role="alert">
              El catálogo no tiene tiendas activas mapeadas a este soporte. No
              se puede resolver como selección específica.
            </div>
          ) : (
            <div className="store-resolution__options">
              {filtered.map((option) => (
                <label key={option.numero} className="store-resolution__option">
                  <input
                    type="checkbox"
                    aria-label={`${option.label} para ${issue.address}`}
                    checked={selectedNumbers.has(option.numero)}
                    onChange={(event) =>
                      onChange({
                        kind: 'selected',
                        stores: toggleStore(
                          selected,
                          option,
                          event.target.checked,
                        ),
                      })
                    }
                  />
                  <span>{option.label}</span>
                  {storeOptionMatchesComment(issue, option) && (
                    <span className="badge badge-info">Sugerida</span>
                  )}
                </label>
              ))}
              {filtered.length === 0 && (
                <span className="text-muted">Sin coincidencias.</span>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

export function StoreCommentResolutionPanel({
  items,
  screens,
  resolutions,
  onChange,
}: Props) {
  const sorted = [...items].sort((a, b) => {
    const aDone = isStoreCommentResolutionComplete(resolutions.get(a.id));
    const bDone = isStoreCommentResolutionComplete(resolutions.get(b.id));
    return Number(aDone) - Number(bDone) || a.row - b.row || a.col - b.col;
  });

  return (
    <div>
      <p className="import__note" style={{ marginTop: 0 }}>
        Estos comentarios contienen nombres o notas, pero no números de tienda.
        SIGNAM no los convertirá en circuito completo: confirma las tiendas del
        catálogo o selecciona “Todas” de forma explícita.
      </p>
      <div className="store-resolution-list">
        {sorted.map((issue) => (
          <ResolutionItem
            key={issue.id}
            issue={issue}
            screens={screens}
            resolution={resolutions.get(issue.id)}
            onChange={(resolution) => onChange(issue.id, resolution)}
          />
        ))}
      </div>
    </div>
  );
}
