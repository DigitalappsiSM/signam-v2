import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { listCampaigns } from '@/services/campaigns';
import { isInStoreMediaSupport } from '@/domain';
import type { StoredCampaign } from './campaignDiff';
import '@/modules/liverpool-import/ImportPage.css';
import '@/modules/admira-catalog/CatalogPage.css';

function normalize(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Módulo Campañas: lista las campañas guardadas en la base de datos. */
export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<StoredCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listCampaigns();
      list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setCampaigns(list);
    } catch {
      setError('No se pudieron cargar las campañas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    if (!q) return campaigns;
    return campaigns.filter((c) => normalize(c.name).includes(q));
  }, [campaigns, search]);

  function liverpoolSupports(c: StoredCampaign) {
    return c.supports.filter((s) => !isInStoreMediaSupport(s.support));
  }
  function storeCount(c: StoredCampaign) {
    return liverpoolSupports(c).reduce((n, s) => n + s.stores.length, 0);
  }

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Campañas guardadas en la base de datos (desde Importar Calendario). El cruce contra el catálogo y la generación de CSV se hacen en Exportación CSV."
        actions={
          <button className="btn btn-secondary" onClick={() => void reload()}>
            Actualizar
          </button>
        }
      />

      {error && (
        <div className="catalog__error" role="alert">
          {error}
        </div>
      )}

      <div className="catalog__filters">
        <input
          className="catalog__search"
          type="search"
          placeholder="Buscar campaña…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-muted" style={{ alignSelf: 'center' }}>
          {campaigns.length} campañas guardadas
        </span>
      </div>

      {loading ? (
        <p className="text-muted">Cargando campañas…</p>
      ) : campaigns.length === 0 ? (
        <div className="import__note">
          Aún no hay campañas en la base de datos. Ve a{' '}
          <strong>Importar Calendario</strong>, sube el archivo y pulsa{' '}
          <strong>“Aceptar y guardar cambios”</strong>.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="text-muted" style={{ margin: 0 }}>
            Ninguna campaña coincide con la búsqueda.
          </p>
        </div>
      ) : (
        <div className="diagnosis__table-wrap">
          <table className="catalog__table">
            <thead>
              <tr>
                <th>Campaña</th>
                <th>Inicio</th>
                <th>Fin</th>
                <th>Mes</th>
                <th>Soportes Liverpool</th>
                <th>Tiendas</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.fechaInicio}</td>
                  <td>{c.fechaFin}</td>
                  <td>{c.mes}</td>
                  <td>
                    {liverpoolSupports(c)
                      .map((s) => s.support)
                      .join(', ') || '—'}
                  </td>
                  <td>{storeCount(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
