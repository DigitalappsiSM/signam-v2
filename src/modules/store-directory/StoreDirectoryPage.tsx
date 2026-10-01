import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from '@/components/filters';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import {
  MEXICAN_STATES,
  STORE_ZONES,
  catalogCoverage,
  normalizeStoreNumber,
  type StoreDirectoryEntry,
} from '@/domain/stores';
import type { AdmiraScreen } from '@/domain';
import { listScreens } from '@/services/screens';
import {
  listStoreDirectory,
  saveStoreEntry,
  type StoredDirectoryEntry,
} from '@/services/storeDirectory';
import type { Actor } from '@/modules/admira-catalog/screenFactory';
import {
  EMPTY_DIRECTORY_FILTERS,
  filterDirectory,
  locationLabel,
  mapsUrl,
  summarizeDirectory,
  type DirectoryFilters,
} from './directoryView';
import { DirectoryImportModal } from './DirectoryImportModal';
import { StoreEntryForm } from './StoreEntryForm';
import '@/modules/admira-catalog/CatalogPage.css';
import './StoreDirectoryPage.css';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; entry: StoredDirectoryEntry };

const LOCATION_LABEL: Record<DirectoryFilters['location'], string> = {
  all: 'Todas',
  gps: 'Con GPS',
  'no-gps': 'Sin coordenadas',
  'no-postal': 'Sin código postal',
};

/**
 * Directorio de tiendas: ubicación (dirección, CP, estado, zona y GPS) de cada
 * tienda Liverpool. Alimenta la columna de ubicación del catálogo Admira y
 * será la base del mapa del panel; no interviene en consolidación ni CSV.
 */
export function StoreDirectoryPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };
  const editable = !!user && can(user.role, 'catalog.write');

  const [entries, setEntries] = useState<StoredDirectoryEntry[]>([]);
  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filters, setFilters] = useState<DirectoryFilters>(
    EMPTY_DIRECTORY_FILTERS,
  );
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [directory, catalog] = await Promise.all([
        listStoreDirectory(),
        listScreens(),
      ]);
      setEntries(directory);
      setScreens(catalog);
    } catch {
      setError(
        'No se pudo cargar el directorio. Verifica que las reglas de Firestore estén desplegadas.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(
    () => filterDirectory(entries, filters),
    [entries, filters],
  );
  const summary = useMemo(() => summarizeDirectory(entries), [entries]);
  const coverage = useMemo(
    () =>
      catalogCoverage(
        entries,
        screens.map((s) => ({
          storeNumber: s.original['Numero de Tienda'],
          storeName: s.original['Nombre de tienda'],
          active: s.metadata.active,
        })),
      ),
    [entries, screens],
  );
  const screensByStore = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of screens) {
      if (!s.metadata.active) continue;
      const n = normalizeStoreNumber(s.original['Numero de Tienda']);
      m.set(n, (m.get(n) ?? 0) + 1);
    }
    return m;
  }, [screens]);
  const usedStates = useMemo(
    () => MEXICAN_STATES.filter((s) => entries.some((e) => e.state === s)),
    [entries],
  );

  const chips = compactChips([
    filters.search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(filters.search),
      onRemove: () => setFilters((f) => ({ ...f, search: '' })),
    },
    filters.status !== 'all' && {
      key: 'status',
      label: 'Estatus',
      value: filters.status === 'active' ? 'Activas' : 'Inactivas',
      onRemove: () => setFilters((f) => ({ ...f, status: 'all' })),
    },
    filters.state !== '' && {
      key: 'state',
      label: 'Estado',
      value: filters.state,
      onRemove: () => setFilters((f) => ({ ...f, state: '' })),
    },
    filters.zone !== '' && {
      key: 'zone',
      label: 'Zona',
      value: filters.zone,
      onRemove: () => setFilters((f) => ({ ...f, zone: '' })),
    },
    filters.location !== 'all' && {
      key: 'location',
      label: 'Ubicación',
      value: LOCATION_LABEL[filters.location],
      onRemove: () => setFilters((f) => ({ ...f, location: 'all' })),
    },
  ]);

  async function handleSave(entry: StoreDirectoryEntry) {
    setSaving(true);
    try {
      await saveStoreEntry(
        entry,
        form.mode === 'edit' ? form.entry : null,
        actor,
      );
      setForm({ mode: 'closed' });
      setNotice(`Tienda ${entry.storeNumber} guardada.`);
      await reload();
    } catch {
      setError('No se pudo guardar la tienda. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  const tiles: {
    label: string;
    value: number;
    tone?: string;
    detail: string;
  }[] = [
    {
      label: 'Tiendas',
      value: summary.total,
      detail: `${summary.active} activas · ${summary.states} estados`,
    },
    {
      label: 'Con GPS',
      value: summary.withGps,
      tone: 'success',
      detail: 'Se pintan en su punto exacto del mapa',
    },
    {
      label: 'Activas sin coordenadas',
      value: summary.withoutGps,
      tone: summary.withoutGps ? 'warning' : 'success',
      detail: 'El mapa las ubica por municipio',
    },
    {
      label: 'Catálogo sin ficha',
      value: coverage.catalogWithoutDirectory.length,
      tone: coverage.catalogWithoutDirectory.length ? 'danger' : 'success',
      detail: 'Tiendas con pantallas que faltan aquí',
    },
  ];

  return (
    <>
      <PageHeader
        title="Directorio de tiendas"
        description="Dirección, código postal, estado, zona y coordenadas de cada tienda. Es la fuente de ubicación del catálogo Admira y del futuro mapa del panel; no cambia el maestro ni el CSV."
        actions={
          editable ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setImporting(true)}
              >
                Importar Excel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setForm({ mode: 'create' })}
              >
                + Agregar tienda
              </button>
            </div>
          ) : undefined
        }
      />

      {notice && (
        <div className="catalog__notice" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      {!loading && (
        <section
          className="store-dir__tiles"
          aria-label="Resumen del directorio"
        >
          {tiles.map((t) => (
            <article
              key={t.label}
              className={`card store-dir__tile${t.tone ? ` store-dir__tile--${t.tone}` : ''}`}
            >
              <span className="store-dir__tile-label">{t.label}</span>
              <strong className="tabnum">{t.value}</strong>
              <small>{t.detail}</small>
            </article>
          ))}
        </section>
      )}

      {!loading &&
        (coverage.catalogWithoutDirectory.length > 0 ||
          coverage.directoryWithoutScreens.length > 0) &&
        entries.length > 0 && (
          <section
            className="card store-dir__coverage"
            aria-label="Cruce con el catálogo"
          >
            {coverage.catalogWithoutDirectory.length > 0 && (
              <div>
                <h2>Tiendas del catálogo sin ficha en el directorio</h2>
                <ul>
                  {coverage.catalogWithoutDirectory.map((s) => (
                    <li key={s.storeNumber}>
                      <strong className="tabnum">{s.storeNumber}</strong>{' '}
                      {s.storeName || 'Sin nombre'}{' '}
                      <span className="text-muted">
                        · {s.screens}{' '}
                        {s.screens === 1 ? 'pantalla' : 'pantallas'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {coverage.directoryWithoutScreens.length > 0 && (
              <div>
                <h2>Tiendas activas sin pantallas en el catálogo</h2>
                <ul>
                  {coverage.directoryWithoutScreens.map((e) => (
                    <li key={e.storeNumber}>
                      <strong className="tabnum">{e.storeNumber}</strong>{' '}
                      {e.name}
                      <span className="text-muted">
                        {' '}
                        · {e.state ?? 'sin estado'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

      <FilterBar
        label="Filtros del directorio"
        chips={chips}
        onClear={() => setFilters(EMPTY_DIRECTORY_FILTERS)}
      >
        <FilterSearch
          label="Buscar"
          placeholder="Número, nombre, municipio o CP…"
          value={filters.search}
          onChange={(search) => setFilters((f) => ({ ...f, search }))}
        />
        <FilterSelect
          label="Estatus"
          value={filters.status}
          active={filters.status !== 'all'}
          onChange={(status) =>
            setFilters((f) => ({
              ...f,
              status: status as DirectoryFilters['status'],
            }))
          }
        >
          <option value="all">Todas</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </FilterSelect>
        <FilterSelect
          label="Estado"
          value={filters.state}
          onChange={(state) => setFilters((f) => ({ ...f, state }))}
        >
          <option value="">Todos los estados</option>
          {usedStates.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Zona"
          value={filters.zone}
          onChange={(zone) => setFilters((f) => ({ ...f, zone }))}
        >
          <option value="">Todas las zonas</option>
          {STORE_ZONES.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Ubicación"
          value={filters.location}
          active={filters.location !== 'all'}
          onChange={(location) =>
            setFilters((f) => ({
              ...f,
              location: location as DirectoryFilters['location'],
            }))
          }
        >
          {Object.entries(LOCATION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      {loading ? (
        <LoadingOverlay
          variant="process"
          title="Cargando directorio…"
          description="Leyendo tiendas y pantallas."
        />
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            {entries.length === 0
              ? editable
                ? 'El directorio está vacío. Usa «Importar Excel» con el directorio de Liverpool y el archivo Ekon para cargar las tiendas.'
                : 'El directorio está vacío. Un administrador debe importarlo.'
              : 'Ninguna tienda coincide con los filtros.'}
          </p>
        </div>
      ) : (
        <div className="catalog__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Tienda</th>
                <th>Nombre</th>
                <th>Municipio</th>
                <th>Estado</th>
                <th>Zona</th>
                <th>CP</th>
                <th>Ubicación</th>
                <th>Pantallas</th>
                <th>Estatus</th>
                {editable && <th aria-label="Acciones" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const url = mapsUrl(e);
                const count = screensByStore.get(e.storeNumber) ?? 0;
                return (
                  <tr
                    key={e.storeNumber}
                    className={e.status === 'active' ? '' : 'catalog__row--off'}
                  >
                    <td className="tabnum">{e.storeNumber}</td>
                    <td>{e.name}</td>
                    <td>
                      {e.municipality || <span className="text-muted">—</span>}
                    </td>
                    <td>{e.state ?? <span className="text-muted">—</span>}</td>
                    <td>{e.zone ?? <span className="text-muted">—</span>}</td>
                    <td className="tabnum">
                      {e.postalCode ?? <span className="text-muted">—</span>}
                    </td>
                    <td>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`badge ${e.coordinateSource === 'manual' ? 'badge-warning' : 'badge-success'}`}
                          title={`${e.lat}, ${e.lng}`}
                        >
                          {locationLabel(e)}
                        </a>
                      ) : (
                        <span className="badge badge-muted">
                          {locationLabel(e)}
                        </span>
                      )}
                    </td>
                    <td className="tabnum">
                      {count || <span className="text-muted">0</span>}
                    </td>
                    <td>
                      {e.status === 'active' ? (
                        <span className="badge badge-info">Activa</span>
                      ) : (
                        <span className="badge badge-muted">Inactiva</span>
                      )}
                    </td>
                    {editable && (
                      <td className="catalog__actions">
                        <button
                          className="btn btn-secondary"
                          onClick={() => setForm({ mode: 'edit', entry: e })}
                        >
                          Editar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {importing && (
        <DirectoryImportModal
          actor={actor}
          stored={entries}
          onClose={() => setImporting(false)}
          onImported={(message) => {
            setImporting(false);
            setNotice(message);
            void reload();
          }}
        />
      )}

      {form.mode !== 'closed' && (
        <StoreEntryForm
          previous={form.mode === 'edit' ? form.entry : null}
          takenNumbers={new Set(entries.map((e) => e.storeNumber))}
          submitting={saving}
          onSubmit={(entry) => void handleSave(entry)}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}
    </>
  );
}
