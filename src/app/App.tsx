import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { ImportPage } from '@/modules/liverpool-import/ImportPage';
import { CatalogPage } from '@/modules/admira-catalog/CatalogPage';
import { CampaignsPage } from '@/modules/campaigns/CampaignsPage';
import { ExportsPage } from '@/modules/exports/ExportsPage';
import { AuditPage } from '@/modules/audit/AuditPage';
import { NotFoundPage } from '@/modules/NotFoundPage';

/** Componente raíz: define el enrutamiento dentro del marco de la aplicación. */
export function App() {
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/importar" element={<ImportPage />} />
        <Route path="/catalogo" element={<CatalogPage />} />
        <Route path="/campanas" element={<CampaignsPage />} />
        <Route path="/exportar" element={<ExportsPage />} />
        <Route path="/historial" element={<AuditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}
