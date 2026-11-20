import { useCallback, useEffect, useState } from 'react';
import { FilterBar, FilterSelect } from '@/components/filters';
import { LoadingOverlay } from '@/components/LoadingOverlay';
import { PageHeader } from '@/components/PageHeader';
import {
  getChedrauiCameraHealth,
  type ChedrauiHealthSnapshot,
} from '@/services/quividi';
import { formatHealthDate } from './cameraHealthView';

const formatCaptureTime = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

export function ChedrauiCameraHealth() {
  const [history, setHistory] = useState<ChedrauiHealthSnapshot[]>([]);
  const [date, setDate] = useState('');
  const [canRefresh, setCanRefresh] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (refresh = false) => {
    setError('');
    setRefreshing(refresh);
    try {
      const result = await getChedrauiCameraHealth(refresh);
      setHistory(result.history);
      setCanRefresh(result.canRefresh);
      if (refresh) setDate('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'No se pudo consultar la red de Chedraui.',
      );
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const snapshot = history.find((item) => item.date === date) ?? history[0];
  return (
    <div className="camera-health">
      <PageHeader
        title="Salud de cámaras · Chedraui OUT"
        description="Última comunicación reportada por Quividi para las cámaras vinculadas al catálogo Grassfish. Red 3365."
        actions={
          canRefresh && (
            <button
              className="btn btn-primary"
              disabled={refreshing}
              onClick={() => void load(true)}
            >
              {refreshing ? 'Consultando Quividi…' : 'Actualizar desde Quividi'}
            </button>
          )
        }
      />
      {error && (
        <div className="camera-health__error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <LoadingOverlay variant="process" title="Cargando salud de cámaras…" />
      ) : snapshot ? (
        <>
          <FilterBar label="Historial de lecturas" sticky={false}>
            <FilterSelect label="Lectura" value={date} onChange={setDate}>
              <option value="">Última lectura</option>
              {history.map((item) => (
                <option key={item.date} value={item.date}>
                  {formatHealthDate(item.date)}
                </option>
              ))}
            </FilterSelect>
          </FilterBar>
          <p className="text-muted">
            Consulta del {formatCaptureTime.format(snapshot.observedAt)} · hora
            de Ciudad de México
          </p>
          {snapshot.cameras.length ? (
            <div className="camera-health__table-wrap">
              <table className="camera-health__table">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Box-ID</th>
                    <th scope="col">Cámara</th>
                    <th scope="col">Location ID</th>
                    <th scope="col">Última señal en Quividi</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.cameras.map((camera) => (
                    <tr key={`${camera.boxId}-${camera.camera}`}>
                      <td>{camera.player}</td>
                      <td>{camera.boxId}</td>
                      <td>{camera.camera}</td>
                      <td>{camera.locationId}</td>
                      <td>
                        {camera.inNetwork
                          ? (camera.lastSeen?.replace('T', ' ') ??
                            'Sin señal registrada')
                          : 'Location ID fuera de la red'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="card">
              No hay cámaras vinculadas en esta lectura.
            </div>
          )}
        </>
      ) : (
        !error && (
          <div className="card">
            El historial empieza con la primera lectura de Quividi.
          </div>
        )
      )}
    </div>
  );
}
