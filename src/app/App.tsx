import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatusScreen } from '@/components/StatusScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { LoginPage } from '@/modules/auth/LoginPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { ImportPage } from '@/modules/liverpool-import/ImportPage';
import { CatalogPage } from '@/modules/admira-catalog/CatalogPage';
import { CampaignsPage } from '@/modules/campaigns/CampaignsPage';
import { OperationalTrackingPage } from '@/modules/operational-tracking/OperationalTrackingPage';
import { LowOccupancyPage } from '@/modules/low-occupancy/LowOccupancyPage';
import { AuditPage } from '@/modules/audit/AuditPage';
import { UsersPage } from '@/modules/users/UsersPage';
import { NotFoundPage } from '@/modules/NotFoundPage';

/**
 * Componente raíz. Controla el acceso:
 * - mientras se resuelve la sesión, muestra un estado de carga;
 * - si Firebase no está configurado, lo informa;
 * - si no hay sesión, muestra el inicio de sesión;
 * - con sesión activa, muestra la app y su enrutamiento.
 */
export function App() {
  const { user, loading, configured } = useAuth();

  if (loading) {
    return <StatusScreen title="Cargando…" />;
  }

  if (!configured) {
    return (
      <StatusScreen title="Firebase no está configurado">
        Faltan las variables <code>VITE_FIREBASE_*</code>. Revisa la
        configuración del despliegue.
      </StatusScreen>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/importar" element={<ImportPage />} />
        <Route path="/catalogo" element={<CatalogPage />} />
        <Route path="/campanas" element={<CampaignsPage />} />
        <Route path="/seguimiento" element={<OperationalTrackingPage />} />
        <Route path="/alertas-ocupacion" element={<LowOccupancyPage />} />
        <Route path="/usuarios" element={<UsersPage />} />
        <Route path="/historial" element={<AuditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}
