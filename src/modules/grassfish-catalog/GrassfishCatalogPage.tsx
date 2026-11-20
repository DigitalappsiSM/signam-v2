import { useEffect, useState } from 'react';
import { can } from '@/app/permissions';
import { useAuth } from '@/app/providers/AuthProvider';
import { PageHeader } from '@/components/PageHeader';
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

function cameraLabel(camera: GrassfishCamera | null) {
  return camera ? `Loc ${camera.locationId}` : '—';
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
  const visible = players.filter((player) =>
    [player.name, player.boxId, player.storeKey].some((value) =>
      value?.toLocaleLowerCase('es').includes(query),
    ),
  );

  return (
    <>
      <PageHeader
        title="Catálogo Grassfish"
        description="Chedraui OUT · Inventario manual. El estado en línea estará disponible cuando se conecte la API de Grassfish."
      />
      {error && (
        <p className="catalog__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="catalog__notice" role="status">
          {notice}
        </p>
      )}
      {canImport && (
        <div className="catalog__notice">
          <label>
            Seleccionar CSV de inventario{' '}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy || loading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void prepare(file);
              }}
            />
          </label>
          {pending.length > 0 && (
            <p>
              El archivo contiene {pending.length} players. Coincidencias por
              Box-ID se actualizarán.{' '}
              {pendingLocationIds.length > 0 && (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void validateLocations()}
                  >
                    Validar cámaras en Quividi
                  </button>{' '}
                </>
              )}
              <button
                type="button"
                className="btn btn--primary"
                disabled={busy}
                onClick={() => void importPlayers()}
              >
                Confirmar carga
              </button>{' '}
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setPending([])}
              >
                Cancelar
              </button>
            </p>
          )}
        </div>
      )}
      {loading && <p role="status">Cargando catálogo…</p>}
      {!loading && !players.length && !error && (
        <p>El catálogo aún no tiene players.</p>
      )}
      {players.length > 0 && (
        <>
          <label>
            Buscar por player, Box-ID o tienda{' '}
            <input
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
          </label>
          <p>
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
                    <td>{player.storeKey ?? 'Pendiente'}</td>
                    <td>{player.displayCount}</td>
                    <td>{cameraLabel(player.camera1)}</td>
                    <td>{cameraLabel(player.camera2)}</td>
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
