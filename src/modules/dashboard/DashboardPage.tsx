import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { NAV_ROUTES } from '@/app/routes';
import { useAuth } from '@/app/providers/AuthProvider';

/** Panel inicial: puntos de entrada a los módulos y estado de configuración. */
export function DashboardPage() {
  const { configured } = useAuth();
  const modules = NAV_ROUTES.filter((r) => r.path !== '/');

  return (
    <>
      <PageHeader
        title="Panel SIGNAM V2"
        description="Importa el calendario Liverpool, administra el catálogo Admira CSM, consolida por resolución y genera los CSV de programación de Admira."
      />

      {!configured && (
        <div
          className="card"
          style={{
            borderColor: '#f4d7a8',
            background: '#fff9ef',
            marginBottom: '1.5rem',
          }}
        >
          <span className="badge badge-warning">Configuración pendiente</span>
          <p style={{ marginBottom: 0 }}>
            Firebase no está configurado. Copia <code>.env.example</code> a{' '}
            <code>.env</code> y define las variables{' '}
            <code>VITE_FIREBASE_*</code> (o usa la Emulator Suite) para
            habilitar autenticación, catálogo e historial.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}
      >
        {modules.map((route) => (
          <Link
            key={route.path}
            to={route.path}
            className="card"
            style={{ color: 'inherit', display: 'block' }}
          >
            <div style={{ fontSize: '1.6rem' }} aria-hidden="true">
              {route.icon}
            </div>
            <h2 style={{ fontSize: '1.05rem', marginTop: '0.5rem' }}>
              {route.label}
            </h2>
            <p className="text-muted" style={{ margin: 0 }}>
              {route.description}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
