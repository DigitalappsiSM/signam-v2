import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { NAV_ROUTES } from '@/app/routes';

/** Panel inicial: puntos de entrada a los módulos. */
export function DashboardPage() {
  const modules = NAV_ROUTES.filter((r) => r.path !== '/');

  return (
    <>
      <PageHeader
        title="Panel SIGNAM V2"
        description="Importa el calendario Liverpool, administra el catálogo Admira CSM, consolida por resolución y genera los CSV de programación de Admira."
      />

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
