import { Navigate, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { StatusScreen } from '@/components/StatusScreen';
import { useAuth } from '@/app/providers/AuthProvider';
import { LoginPage } from '@/modules/auth/LoginPage';
import { DashboardPage } from '@/modules/dashboard/DashboardPage';
import { ImportPage } from '@/modules/liverpool-import/ImportPage';
import { CatalogPage } from '@/modules/admira-catalog/CatalogPage';
import { EkonImportPage } from '@/modules/ekon-import/EkonImportPage';
import { CampaignsPage } from '@/modules/campaigns/CampaignsPage';
import { ReconciliationPage } from '@/modules/reconciliation/ReconciliationPage';
import { OperationalTrackingPage } from '@/modules/operational-tracking/OperationalTrackingPage';
import { LowOccupancyPage } from '@/modules/low-occupancy/LowOccupancyPage';
import { AuditPage } from '@/modules/audit/AuditPage';
import { UsersPage } from '@/modules/users/UsersPage';
import { NotFoundPage } from '@/modules/NotFoundPage';
import { DigitalImportPage } from '@/modules/digital-import/DigitalImportPage';
import { DigitalOperationsPage } from '@/modules/digital-operations/DigitalOperationsPage';
import { DigitalCatalogPage } from '@/modules/digital-operations/DigitalCatalogPage';
import { ReportingPage } from '@/modules/reporting/ReportingPage';
import { CameraHealthPage } from '@/modules/camera-health/CameraHealthPage';
import { canAccessRoute, routeByPath } from './routes';

function RouteAccess({
  path,
  children,
}: {
  path: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const route = routeByPath(path);
  if (!user || !route || !canAccessRoute(user.role, route)) {
    return <Navigate to="/" replace />;
  }
  return children;
}

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
    return (
      <StatusScreen
        title="Preparando SIGNAM…"
        loadingVariant="system"
        loadingDescription="Encendiendo píxeles y verificando tu sesión."
      />
    );
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
        <Route path="/" element={<DashboardPage role={user.role} />} />
        <Route
          path="/importar"
          element={
            <RouteAccess path="/importar">
              <ImportPage />
            </RouteAccess>
          }
        />
        <Route
          path="/catalogo"
          element={
            <RouteAccess path="/catalogo">
              <CatalogPage />
            </RouteAccess>
          }
        />
        <Route
          path="/importar-ekon"
          element={
            <RouteAccess path="/importar-ekon">
              <EkonImportPage />
            </RouteAccess>
          }
        />
        <Route
          path="/importar-digital"
          element={
            <RouteAccess path="/importar-digital">
              <DigitalImportPage />
            </RouteAccess>
          }
        />
        <Route
          path="/operacion-digital"
          element={
            <RouteAccess path="/operacion-digital">
              <DigitalOperationsPage />
            </RouteAccess>
          }
        />
        <Route
          path="/catalogo-digital"
          element={
            <RouteAccess path="/catalogo-digital">
              <DigitalCatalogPage />
            </RouteAccess>
          }
        />
        <Route path="/campanas" element={<CampaignsPage />} />
        <Route
          path="/conciliacion"
          element={
            <RouteAccess path="/conciliacion">
              <ReconciliationPage />
            </RouteAccess>
          }
        />
        <Route path="/seguimiento" element={<OperationalTrackingPage />} />
        <Route
          path="/reporting"
          element={
            <RouteAccess path="/reporting">
              <ReportingPage />
            </RouteAccess>
          }
        />
        <Route
          path="/alertas-ocupacion"
          element={
            <RouteAccess path="/alertas-ocupacion">
              <LowOccupancyPage />
            </RouteAccess>
          }
        />
        <Route
          path="/salud-camaras"
          element={
            <RouteAccess path="/salud-camaras">
              <CameraHealthPage />
            </RouteAccess>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RouteAccess path="/usuarios">
              <UsersPage />
            </RouteAccess>
          }
        />
        <Route
          path="/historial"
          element={
            <RouteAccess path="/historial">
              <AuditPage />
            </RouteAccess>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}
