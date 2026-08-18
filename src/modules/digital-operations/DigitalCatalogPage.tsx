import { useEffect, useState } from 'react';
import { useAuth } from '@/app/providers/AuthProvider';
import { can } from '@/app/permissions';
import { PageHeader } from '@/components/PageHeader';
import type { DigitalSupportProfile } from '@/domain/digital-operations';
import {
  listDigitalProfiles,
  saveDigitalProfile,
  seedDigitalProfiles,
} from '@/services/digitalCatalog';
import '../digital-import/digital.css';
export function DigitalCatalogPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<DigitalSupportProfile[]>([]);
  const actor = { uid: user?.uid ?? '', email: user?.email ?? '' },
    manage = !!user && can(user.role, 'digitalCatalog.manage');
  async function load() {
    setProfiles(await listDigitalProfiles());
  }
  useEffect(() => {
    void load();
  }, []);
  async function seed() {
    await seedDigitalProfiles(actor);
    await load();
  }
  async function toggle(p: DigitalSupportProfile) {
    await saveDigitalProfile({ ...p, active: !p.active }, actor);
    await load();
  }
  return (
    <section>
      <PageHeader
        title="Catálogo de soportes digitales"
        description="Perfiles exactos autorizados para el flujo multirretailer."
      />
      {profiles.length === 0 && (
        <button disabled={!manage} onClick={() => void seed()}>
          Crear perfiles iniciales
        </button>
      )}
      <div className="digital-table-wrap">
        <table className="digital-table">
          <thead>
            <tr>
              <th>Retailer</th>
              <th>Artículo / soporte</th>
              <th>Alias retailer</th>
              <th>Alias artículo</th>
              <th>CMS</th>
              <th>Estado</th>
              <th>Última edición</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>{p.retailerLabel}</td>
                <td>{p.supportLabel}</td>
                <td>{p.retailerAliases.join(', ')}</td>
                <td>{p.articleAliases.join(', ')}</td>
                <td>{p.cmsName ?? 'CMS externo'}</td>
                <td>
                  <button disabled={!manage} onClick={() => void toggle(p)}>
                    {p.active ? 'Activo' : 'Inactivo'}
                  </button>
                </td>
                <td>{p.updatedByEmail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
