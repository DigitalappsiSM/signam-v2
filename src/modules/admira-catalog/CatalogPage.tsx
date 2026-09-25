import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { EntityAvatar } from '@/components/EntityAvatar';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from '@/components/filters';
import { useAuth } from '@/app/providers/AuthProvider';
import type { AdmiraScreen, AdmiraScreenOriginal } from '@/domain';
import {
  createScreen,
  deactivateScreen,
  deleteScreen,
  listScreens,
  reactivateScreen,
  updateScreen,
} from '@/services/screens';
import {
  EMPTY_FILTERS,
  filterScreens,
  uniqueValues,
  type ScreenFilters,
} from './screenFilter';
import { ScreenForm } from './ScreenForm';
import { MasterImportModal } from './MasterImportModal';
import { MasterExportModal } from './MasterExportModal';
import type { Actor } from './screenFactory';
import './CatalogPage.css';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; screen: AdmiraScreen };

/** Catálogo Admira: consulta, búsqueda, filtros y administración de pantallas. */
export function CatalogPage() {
  const { user } = useAuth();
  const actor: Actor = { uid: user?.uid ?? '', email: user?.email ?? '' };

  const [screens, setScreens] = useState<AdmiraScreen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ScreenFilters>(EMPTY_FILTERS);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setScreens(await listScreens());
    } catch {
      setError(
        'No se pudieron cargar las pantallas. Verifica que las reglas de Firestore estén desplegadas.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(
    () => filterScreens(screens, filters),
    [screens, filters],
  );

  const stores = useMemo(
    () => uniqueValues(screens, 'Numero de Tienda'),
    [screens],
  );
  const models = useMemo(() => uniqueValues(screens, 'Modelo'), [screens]);
  const resolutions = useMemo(
    () => uniqueValues(screens, 'RESOLUCION'),
    [screens],
  );

  const filterChips = compactChips([
    filters.search.trim() !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(filters.search),
      onRemove: () => setFilters((f) => ({ ...f, search: '' })),
    },
    filters.status !== 'all' && {
      key: 'status',
      label: 'Estado',
      value: filters.status === 'active' ? 'Activas' : 'Inactivas',
      onRemove: () => setFilters((f) => ({ ...f, status: 'all' })),
    },
    filters.store !== '' && {
      key: 'store',
      label: 'Tienda',
      value: filters.store,
      onRemove: () => setFilters((f) => ({ ...f, store: '' })),
    },
    filters.model !== '' && {
      key: 'model',
      label: 'Modelo',
      value: filters.model,
      onRemove: () => setFilters((f) => ({ ...f, model: '' })),
    },
    filters.resolution !== '' && {
      key: 'resolution',
      label: 'Resolución',
      value: filters.resolution,
      onRemove: () => setFilters((f) => ({ ...f, resolution: '' })),
    },
  ]);

  async function handleSubmit(
    original: AdmiraScreenOriginal,
    calendarSupport: string,
    quividiCameraName: string,
    quividiLocationId: number | null,
    quividiCameraName2: string,
    quividiLocationId2: number | null,
    measurementPointCode: string,
    measurementPointCode2: string,
  ) {
    setSaving(true);
    try {
      if (form.mode === 'create') {
        await createScreen(
          original,
          actor,
          calendarSupport,
          quividiCameraName,
          quividiLocationId,
          quividiCameraName2,
          quividiLocationId2,
          measurementPointCode,
          measurementPointCode2,
        );
      } else if (form.mode === 'edit') {
        await updateScreen(
          form.screen,
          original,
          actor,
          calendarSupport,
          quividiCameraName,
          quividiLocationId,
          quividiCameraName2,
          quividiLocationId2,
          measurementPointCode,
          measurementPointCode2,
        );
      }
      setForm({ mode: 'closed' });
      await reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'No se pudo guardar la pantalla. Inténtalo de nuevo.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(screen: AdmiraScreen) {
    const reason = window.prompt(
      'Motivo de inactivación (queda registrado en el historial):',
    );
    if (reason === null || reason.trim() === '') return;
    try {
      await deactivateScreen(screen, reason, actor);
      await reload();
    } catch {
      setError('No se pudo inactivar la pantalla.');
    }
  }

  async function handleReactivate(screen: AdmiraScreen) {
    try {
      await reactivateScreen(screen, actor);
      await reload();
    } catch {
      setError('No se pudo reactivar la pantalla.');
    }
  }

  async function handleDelete(screen: AdmiraScreen) {
    const name =
      screen.original['Nombre de tienda'] ||
      screen.original['Numero de Tienda'] ||
      'esta pantalla';
    const confirmed = window.confirm(
      `¿Eliminar permanentemente ${name}? Esta acción no se puede deshacer y no conserva historial. Si solo quieres sacarla de operación, usa “Inactivar”.`,
    );
    if (!confirmed) return;
    try {
      await deleteScreen(screen.id);
      setNotice('Pantalla eliminada.');
      await reload();
    } catch {
      setError('No se pudo eliminar la pantalla.');
    }
  }

  return (
    <>
      <PageHeader
        title="Catálogo Admira"
        description="Consulta, busca y administra las pantallas del catálogo Admira CSM. Los campos originales del maestro se conservan intactos."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={() => setExporting(true)}
            >
              Exportar catálogo
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setImporting(true)}
            >
              Importar maestro
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setForm({ mode: 'create' })}
            >
              + Agregar pantalla
            </button>
          </div>
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

      <FilterBar
        label="Filtros del catálogo"
        chips={filterChips}
        onClear={() => setFilters(EMPTY_FILTERS)}
      >
        <FilterSearch
          label="Buscar"
          placeholder="Buscar por tienda, modelo, artículo…"
          value={filters.search}
          onChange={(search) => setFilters((f) => ({ ...f, search }))}
        />
        <FilterSelect
          label="Estado"
          value={filters.status}
          active={filters.status !== 'all'}
          onChange={(status) =>
            setFilters((f) => ({
              ...f,
              status: status as ScreenFilters['status'],
            }))
          }
        >
          <option value="all">Todas</option>
          <option value="active">Activas</option>
          <option value="inactive">Inactivas</option>
        </FilterSelect>
        <FilterSelect
          label="Tienda"
          value={filters.store}
          onChange={(store) => setFilters((f) => ({ ...f, store }))}
        >
          <option value="">Todas las tiendas</option>
          {stores.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Modelo"
          value={filters.model}
          onChange={(model) => setFilters((f) => ({ ...f, model }))}
        >
          <option value="">Todos los modelos</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Resolución"
          value={filters.resolution}
          onChange={(resolution) => setFilters((f) => ({ ...f, resolution }))}
        >
          <option value="">Todas las resoluciones</option>
          {resolutions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </FilterSelect>
      </FilterBar>

      {loading ? (
        <LoadingOverlay
          variant="process"
          title="Cargando pantallas…"
          description="Sincronizando el catálogo Admira."
        />
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            {screens.length === 0
              ? 'Aún no hay pantallas en el catálogo. Usa “Agregar pantalla” para crear la primera.'
              : 'Ninguna pantalla coincide con los filtros.'}
          </p>
        </div>
      ) : (
        <div className="catalog__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Tienda</th>
                <th>Nombre de tienda</th>
                <th>Modelo</th>
                <th>Resolución</th>
                <th>Normalización Liverpool</th>
                <th>Quividi</th>
                <th>Estado</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((screen) => (
                <tr
                  key={screen.id}
                  className={screen.metadata.active ? '' : 'catalog__row--off'}
                >
                  <td>
                    <EntityAvatar
                      label={String(screen.original['Numero de Tienda'] ?? '—')}
                      color={
                        screen.metadata.active
                          ? 'var(--cls-inst)'
                          : 'var(--color-text-muted)'
                      }
                      title={`Tienda ${screen.original['Numero de Tienda'] ?? ''}`}
                    />
                  </td>
                  <td>{screen.original['Nombre de tienda']}</td>
                  <td>{screen.original.Modelo}</td>
                  <td>{screen.original.RESOLUCION}</td>
                  <td>
                    {screen.metadata.calendarSupport || (
                      <span className="text-muted">— sin mapear —</span>
                    )}
                  </td>
                  <td>
                    {screen.metadata.quividiLocationId != null ? (
                      <div className="catalog__quividi">
                        <strong>
                          {screen.metadata.measurementPointId ||
                            `ID ${screen.metadata.quividiLocationId}`}
                        </strong>
                        <span title={screen.metadata.quividiCameraName ?? ''}>
                          {screen.metadata.quividiCameraName ||
                            'Alias pendiente'}
                        </span>
                      </div>
                    ) : screen.metadata.quividiCameraName ? (
                      <div className="catalog__quividi">
                        <span className="badge badge-muted">Alias legacy</span>
                        <span title={screen.metadata.quividiCameraName}>
                          {screen.metadata.quividiCameraName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {screen.metadata.quividiLocationId2 != null ? (
                      <div className="catalog__quividi">
                        <strong>
                          {screen.metadata.measurementPointId2 ||
                            `ID ${screen.metadata.quividiLocationId2}`}
                        </strong>
                        <span title={screen.metadata.quividiCameraName2 ?? ''}>
                          {screen.metadata.quividiCameraName2 ||
                            'Alias pendiente'}
                        </span>
                      </div>
                    ) : (
                      screen.metadata.quividiCameraName2 && (
                        <div className="catalog__quividi">
                          <span className="badge badge-muted">
                            Alias legacy
                          </span>
                          <span title={screen.metadata.quividiCameraName2}>
                            {screen.metadata.quividiCameraName2}
                          </span>
                        </div>
                      )
                    )}
                  </td>
                  <td>
                    {screen.metadata.active ? (
                      <span className="badge badge-info">Activa</span>
                    ) : (
                      <span className="badge badge-muted">Inactiva</span>
                    )}
                  </td>
                  <td className="catalog__actions">
                    <button
                      className="btn btn-secondary"
                      onClick={() => setForm({ mode: 'edit', screen })}
                    >
                      Editar
                    </button>
                    {screen.metadata.active ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => void handleDeactivate(screen)}
                      >
                        Inactivar
                      </button>
                    ) : (
                      <button
                        className="btn btn-secondary"
                        onClick={() => void handleReactivate(screen)}
                      >
                        Reactivar
                      </button>
                    )}
                    <button
                      className="btn btn-danger"
                      onClick={() => void handleDelete(screen)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form.mode !== 'closed' && (
        <ScreenForm
          title={
            form.mode === 'create' ? 'Agregar pantalla' : 'Editar pantalla'
          }
          initial={form.mode === 'edit' ? form.screen.original : undefined}
          initialCalendarSupport={
            form.mode === 'edit' ? form.screen.metadata.calendarSupport : ''
          }
          initialQuividiCameraName={
            form.mode === 'edit'
              ? (form.screen.metadata.quividiCameraName ?? '')
              : ''
          }
          initialQuividiLocationId={
            form.mode === 'edit'
              ? (form.screen.metadata.quividiLocationId ?? null)
              : null
          }
          initialQuividiCameraName2={
            form.mode === 'edit'
              ? (form.screen.metadata.quividiCameraName2 ?? '')
              : ''
          }
          initialQuividiLocationId2={
            form.mode === 'edit'
              ? (form.screen.metadata.quividiLocationId2 ?? null)
              : null
          }
          initialMeasurementPointCode={
            form.mode === 'edit'
              ? (form.screen.metadata.measurementPointCode ?? '')
              : ''
          }
          initialMeasurementPointCode2={
            form.mode === 'edit'
              ? (form.screen.metadata.measurementPointCode2 ?? '')
              : ''
          }
          submitting={saving}
          onSubmit={handleSubmit}
          onCancel={() => setForm({ mode: 'closed' })}
        />
      )}

      {exporting && (
        <MasterExportModal
          screens={screens}
          onClose={() => setExporting(false)}
        />
      )}

      {importing && (
        <MasterImportModal
          actor={actor}
          existingCount={screens.length}
          onClose={() => setImporting(false)}
          onImported={(created, message) => {
            setImporting(false);
            setNotice(
              message ?? `Se importaron ${created} pantallas del maestro.`,
            );
            void reload();
          }}
        />
      )}
    </>
  );
}
