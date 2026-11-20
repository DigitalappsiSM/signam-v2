import { useEffect, useRef, useState } from 'react';
import { can } from '@/app/permissions';
import { useAuth } from '@/app/providers/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import {
  FilterBar,
  FilterSearch,
  FilterSelect,
  compactChips,
  formatFilterSearch,
} from '@/components/filters';
import {
  parseGrassfishCatalog,
  type GrassfishCamera,
  type GrassfishPlayer,
} from '@/domain/grassfish';
import {
  listGrassfishPlayers,
  saveGrassfishPlayers,
  validateChedrauiLocations,
} from '@/services/grassfishCatalog';
import '@/modules/admira-catalog/CatalogPage.css';

function CameraLocation({ camera }: { camera: GrassfishCamera | null }) {
  return camera ? (
    <div className="catalog__quividi">
      <strong>ID {camera.locationId}</strong>
    </div>
  ) : (
    <span className="text-muted">—</span>
  );
}

export function GrassfishCatalogPage() {
  const { user } = useAuth();
  const canImport = !!user && can(user.role, 'catalog.write');
  const [players, setPlayers] = useState<GrassfishPlayer[]>([]);
  const [pending, setPending] = useState<GrassfishPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [cameraFilter, setCameraFilter] = useState('all');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    listGrassfishPlayers()
      .then((data) => {
        if (active) setPlayers(data);
      })
      .catch(() => {
        if (active) setError('No se pudo consultar el catálogo.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function prepare(file: File) {
    setBusy(true);
    setPending([]);
    setError('');
    setNotice('');
    try {
      setPending(parseGrassfishCatalog(await file.text()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pendingLocationIds = pending.flatMap(({ camera1, camera2 }) =>
    [camera1, camera2].flatMap((camera) => (camera ? [camera.locationId] : [])),
  );

  async function validateLocations() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const missing = await validateChedrauiLocations(pendingLocationIds);
      if (missing.length) {
        setError(
          `Location ID fuera del inventario de la red 3365: ${missing.join(', ')}.`,
        );
      } else {
        setNotice(
          `${pendingLocationIds.length} Location ID confirmados en la red 3365 de Chedraui.`,
        );
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'No se pudo validar la red 3365.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function importPlayers() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await saveGrassfishPlayers(pending);
      setNotice(`${pending.length} players guardados.`);
      setPending([]);
      setPlayers(await listGrassfishPlayers());
    } catch {
      setError(
        'No se pudo completar la carga o actualizar la vista. Revisa la conexión y los permisos.',
      );
    } finally {
      setBusy(false);
    }
  }

  const query = search.trim().toLocaleLowerCase('es');
  const visible = players.filter((player) => {
    const hasCamera = player.camera1 !== null || player.camera2 !== null;
    const matchesCameras =
      cameraFilter === 'all' || hasCamera === (cameraFilter === 'linked');
    return (
      matchesCameras &&
      [
        player.name,
        player.boxId,
        player.storeKey,
        player.camera1?.locationId,
        player.camera2?.locationId,
      ].some((value) =>
        String(value ?? '')
          .toLocaleLowerCase('es')
          .includes(query),
      )
    );
  });
  const filterChips = compactChips([
    query !== '' && {
      key: 'search',
      label: 'Búsqueda',
      value: formatFilterSearch(search),
      onRemove: () => setSearch(''),
    },
    cameraFilter !== 'all' && {
      key: 'cameras',
      label: 'Quividi',
      value: cameraFilter === 'linked' ? 'Con cámara' : 'Sin cámara',
      onRemove: () => setCameraFilter('all'),
    },
  ]);

  return (
    <>
      <PageHeader
        title="Catálogo Grassfish"
        description="Consulta y administra los players, mupis y cámaras Quividi de Chedraui OUT."
        actions={
          canImport && (
            <>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy || loading}
                onClick={() => fileInput.current?.click()}
              >
                Importar catálogo
              </button>
              <input
                ref={fileInput}
                type="file"
                hidden
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void prepare(file);
                }}
              />
            </>
          )
        }
      />
      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="catalog__notice" role="status">
          {notice}
        </div>
      )}
      {pending.length > 0 && (
        <section className="card" aria-label="Importar catálogo">
          <p>
            El archivo contiene {pending.length} players. Las coincidencias por
            Box-ID se actualizarán.
          </p>
          <div className="catalog__actions">
            {pendingLocationIds.length > 0 && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void validateLocations()}
              >
                Validar cámaras en Quividi
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void importPlayers()}
            >
              Confirmar carga
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setPending([])}
            >
              Cancelar
            </button>
          </div>
        </section>
      )}
      <FilterBar
        label="Filtros del catálogo"
        chips={filterChips}
        onClear={() => {
          setSearch('');
          setCameraFilter('all');
        }}
      >
        <FilterSearch
          label="Buscar"
          placeholder="Buscar por player, Box-ID, tienda o Location ID…"
          value={search}
          onChange={setSearch}
        />
        <FilterSelect
          label="Quividi"
          value={cameraFilter}
          active={cameraFilter !== 'all'}
          onChange={setCameraFilter}
        >
          <option value="all">Todos los players</option>
          <option value="linked">Con cámara</option>
          <option value="unlinked">Sin cámara</option>
        </FilterSelect>
      </FilterBar>
      {loading ? (
        <LoadingOverlay
          variant="process"
          title="Cargando players…"
          description="Sincronizando el catálogo Grassfish."
        />
      ) : visible.length === 0 ? (
        <div className="card">
          {!error && (
            <p className="text-muted" style={{ margin: 0 }}>
              {players.length === 0
                ? 'El catálogo aún no tiene players.'
                : 'Ningún player coincide con los filtros.'}
            </p>
          )}
        </div>
      ) : (
        <>
          <p className="text-muted">
            {visible.length} de {players.length} players
          </p>
          <div className="catalog__table-wrap">
            <table className="catalog__table">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col">Box-ID</th>
                  <th scope="col">Clave de tienda</th>
                  <th scope="col">Mupis</th>
                  <th scope="col">Cámara 1</th>
                  <th scope="col">Cámara 2</th>
                  <th scope="col">Total de audiencia</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((player) => (
                  <tr key={player.boxId}>
                    <td>{player.name}</td>
                    <td>{player.boxId}</td>
                    <td>
                      {player.storeKey ?? (
                        <span className="badge badge-muted">Pendiente</span>
                      )}
                    </td>
                    <td>{player.displayCount}</td>
                    <td>
                      <CameraLocation camera={player.camera1} />
                    </td>
                    <td>
                      <CameraLocation camera={player.camera2} />
                    </td>
                    <td>
                      {player.camera1
                        ? player.audienceMode === 'both'
                          ? 'Ambas'
                          : 'Cámara 1'
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
